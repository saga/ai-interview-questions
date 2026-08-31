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
import type { LearnerProfile } from '../../schemas/learner';
import type { Question } from '../../schemas/question';
import type { KnowledgeEvidence, RetrievalMode } from '../../domain/knowledge/types';
import { knowledgeCitations, retrieveForCopilot } from './knowledgeCapability';
import { buildCopilotSystemPrompt } from './copilotPrompt';

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

export async function runCopilotTurn(
  deps: { chat: CopilotChatFn },
  input: CopilotTurnInput,
): Promise<CopilotTurnResult> {
  let evidence: KnowledgeEvidence | null = null;
  try {
    evidence = retrieveForCopilot({
      query: input.message,
      activeQuestion: input.activeQuestion,
      topic: input.topic,
      mode: input.mode,
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
  });
  const reply = await deps.chat(system, input.history, input.message);
  const citations = knowledgeCitations(evidence);
  if (citations.length === 0) return { reply, evidence };
  return { reply: `${reply}\n\n依据：${citations.join('｜')}`, evidence };
}
