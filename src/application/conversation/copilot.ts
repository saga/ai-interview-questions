// Copilot 通道（ADR-064 §5/§7）：负责「用户想知道什么」，不改任何训练状态。
//
// 与 commandDetector 的分工：
//   command  → 改训练状态（出题 / 下一题 / 开始面试 / 结束 / 重新评分）
//   copilot  → 解释、提示、比较、追问、知识问答；副作用为零
//
// 流程固定为 retrieve → assemble → LLM → citations：
//   - 检索在调用模型之前完成，检索失败只降级为无依据问答，不阻断对话；
//   - 是否暴露真值由 knowledgeCapability 的答案安全模式决定，不交给模型自己判断。

import type { InterviewSession } from '../../schemas/session';
import type { ConversationContext } from '../../schemas/conversation';
import type { LearnerProfile } from '../../schemas/learner';
import type { Question } from '../../schemas/question';
import type { AnswerValue } from '../../types';
import type { EvaluationResult } from '../../schemas/evaluation';
import type { KnowledgeEvidence, RetrievalMode } from '../../domain/knowledge/types';
import { knowledgeCitations, retrieveForCopilot, combineFollowUp, detectQueryTopic } from './knowledgeCapability';
import { routeUserMessage } from './commandDetector';
import { initialConversationContext } from './conversationSession';
import { buildCopilotSystemPrompt } from './copilotPrompt';
import { WEAK_AVG } from '../../domain/learner';

/** 用户实际作答与评分诊断（ADR-065 P0-2）：让 Copilot 从"泛知识解释器"升级为"个性化教练"。 */
export interface AnswerContext {
  /** 用户作答：选择题为选项索引数组，开放/编程题为文本。 */
  answer: AnswerValue;
  /** 该题评分诊断（可能尚未评分时为 null）。 */
  evaluation?: EvaluationResult | null;
}

export interface CopilotTurnInput {
  /** 本轮用户消息原文。 */
  message: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  profile: LearnerProfile | null;
  /** 当前正在讨论/作答的题目（Chat 面板或训练页）。 */
  activeQuestion?: Question | null;
  session: InterviewSession | null;
  /** 已解析出的主题 slug，用于收窄检索范围。 */
  topic?: string;
  /** 显式指定答案安全模式（例如 UI 的「给提示」按钮强制 hint）。 */
  mode?: RetrievalMode;
  /** 用户实际作答与诊断（ADR-065 P0-2），非当前题/未作答时为 undefined。 */
  answerContext?: AnswerContext | null;
  /** 真实 ConversationContext（UI 侧状态），用于 P1-4 判定上一轮用户消息的通道；缺省回退初始态。 */
  context?: ConversationContext | null;
  /** Learner Memory 弱项信号（ADR-065 P1-2 / ADR-066 P1）：weakTopics/weakAngles 为真实弱项，focusTopic 为当前查询焦点（只作锚点）。 */
  learnerContext?: { weakTopics?: string[]; weakAngles?: string[]; focusTopic?: string };
}

export interface CopilotTurnResult {
  /** 已附引用尾注、可直接展示给用户。 */
  reply: string;
  evidence: KnowledgeEvidence | null;
}

/** 补全函数由调用方注入（UI 侧持有 AIConfig 与 provider 选择逻辑）。 */
export type CopilotChatFn = (
  system: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  message: string,
) => Promise<string>;

/**
 * 从 Learner Profile 推导弱项信号（ADR-065 P1-2）：只做轻量透传，供检索排序小幅提权。
 * - weakTopics：均分低于掌握线的 topic（**真实的长期弱项**，来自 Profile，不含当前查询焦点）
 * - weakAngles：angleCoverage 中均分低于掌握线的角度（跨 topic 汇总，去重）
 * - focusTopic：当前查询上下文（Intent.topic / query 命中的知识节点），**只作检索锚点、不并入 weakTopics**——
 *   否则「用户这轮问的 RAG」会被当成「长期弱项」去 boost，与"真实弱项"语义混淆（ADR-066 P1）。
 * 不引入新排序层，也不改变其他检索逻辑。
 */
export function deriveLearnerContext(
  profile: LearnerProfile | null,
  focusTopic?: string,
): { weakTopics: string[]; weakAngles: string[]; focusTopic?: string } {
  const weakTopics: string[] = [];
  const weakAngles = new Set<string>();
  if (profile) {
    for (const [t, s] of Object.entries(profile.topicStats)) {
      if (s.attempts > 0 && s.avgScore < WEAK_AVG) weakTopics.push(t);
    }
    if (profile.angleCoverage) {
      for (const [key, s] of Object.entries(profile.angleCoverage)) {
        if (s.avgScore < WEAK_AVG) {
          const angle = key.split('|')[1];
          if (angle) weakAngles.add(angle);
        }
      }
    }
  }
  return { weakTopics: weakTopics.slice(0, 8), weakAngles: [...weakAngles].slice(0, 8), focusTopic };
}

export async function runCopilotTurn(
  deps: { chat: CopilotChatFn },
  input: CopilotTurnInput,
): Promise<CopilotTurnResult> {
  let evidence: KnowledgeEvidence | null = null;
  try {
    // P1-1：follow-up 检索 query 与上一轮用户消息绑定（不消耗 LLM 做 query rewriting）。
    const lastUserTurn = [...input.history].reverse().find((m) => m.role === 'user')?.content;
    // P0-2：topic 锚点用"显式 topic 或 query 命中的知识节点"，不再把 activeQuestion.topic 当默认。
    const anchor = input.topic ?? detectQueryTopic(input.message);
    // P1-4：上一轮用户消息若走的是 command/answer 通道，则不参与拼接（复用 routeUserMessage 判定）。
    const convContext = input.context ?? initialConversationContext();
    const lastTurnChannel = lastUserTurn
      ? routeUserMessage(lastUserTurn, convContext, input.activeQuestion).kind
      : 'copilot';
    const retrieveQuery = combineFollowUp(input.message, lastUserTurn, anchor, lastTurnChannel);
    // P1-2：弱项信号透传给检索排序（若上游未显式传入则在此推导）。
    const learnerContext = input.learnerContext ?? deriveLearnerContext(input.profile, anchor);
    evidence = retrieveForCopilot({
      query: input.message,
      retrieveQuery,
      activeQuestion: input.activeQuestion,
      topic: anchor,
      mode: input.mode,
      learnerContext,
      // ADR-066 P1：上一轮解析出的知识锚点接成 graph 种子，让确定性 follow-up 也吃到邻域。
      priorKnowledgeIds: input.context?.activeKnowledgeIds ?? [],
    });
  } catch (e) {
    // 检索是增强而非前置条件：失败时降级为无依据问答，不把错误抛给用户。
    console.warn('[Copilot] 知识检索失败，降级为无依据问答：', e);
  }
  const system = buildCopilotSystemPrompt({
    profile: input.profile,
    activeQuestion: input.activeQuestion,
    session: input.session,
    evidence,
    answerContext: input.answerContext,
  });
  const reply = await deps.chat(system, input.history, input.message);
  const citations = knowledgeCitations(evidence);
  if (citations.length === 0) return { reply, evidence };
  return { reply: `${reply}\n\n知识库依据：${citations.join('｜')}`, evidence };
}
