// 独立 Agent 面试 ↔ Copilot 侧栏的桥接上下文（纯类型 + 纯函数，不依赖 React）。
//
// 架构现状（ADR-084）：Agent 运行时**只有一份**，由 App 层的 `useAgentInterview` 持有，
// 「Agent 面试」页与 Copilot 侧栏是同一场面试的两个视图，共享同一个 `InterviewAgentSession`。
// Copilot 侧栏自己那份 `ConversationSession` 只保存它自己的 transcript / question-mode 状态，
// **不**承载面试运行时（早期版本是两套独立 runtime，靠一个反馈对象互相同步，已在 ADR-084 合并）。
//
// 本模块的职责：把 Agent 侧当前的反馈投影成 Copilot 的 `AnswerContext`（**唯一**上下文契约），
// 并在面试进行中派生出消息路由所需的 `ConversationContext`。
// 用户在 Agent 面试页点「让 Copilot 详细解释」时，Copilot 手里没有那场面试的作答与评分，
// 若不投影就只能靠调用方手拼一段 prompt 描述——那就是第二套上下文格式，必然与 AnswerContext 漂移。

import type { AnswerValue } from '../../types';
import type { EvaluationResult } from '../../schemas/evaluation';
import type { SessionQuestion } from '../../schemas/session';
import type { InterviewFeedbackMode } from '../../schemas/interview';
import type { ConversationContext } from '../../schemas/conversation';
import type { AnswerContext } from './copilot';

/** Agent 面试页在「停在本题反馈上」时可交给 Copilot 的结构化上下文。 */
export interface ActiveInterviewContext {
  feedbackMode: InterviewFeedbackMode;
  /** 刚作答的那道题（immediate 反馈态下即当前题）。 */
  question: SessionQuestion;
  /** 用户作答。 */
  answer: AnswerValue;
  /** 本题评分。反馈态下必然非 null——`evaluation === null` 不会产生反馈卡。 */
  evaluation: EvaluationResult;
  /** 已交付题数，让 Copilot 知道面试进度（而非把它当成孤立的一道题）。 */
  deliveredCount: number;
}

/**
 * 转成 Copilot 的 `AnswerContext`。
 *
 * 额外带上 `question` 与 `feedbackMode`：
 * - `question`：让 Copilot 不必再从别处猜「正在讲哪道题」（Agent 面试的题不在 Copilot 的 session 里）；
 * - `feedbackMode`：让讲解深度配合用户所处的节奏——`immediate` 下用户正逐题消化，
 *   讲解应聚焦「这道题的要点与偏差」，而不是急着他进入下一题。
 */
export function toAnswerContext(ctx: ActiveInterviewContext): AnswerContext {
  return {
    answer: ctx.answer,
    evaluation: ctx.evaluation,
    question: ctx.question.question,
    feedbackMode: ctx.feedbackMode,
  };
}

/**
 * 「让 Copilot 详细解释」的默认提问。
 * 结构化上下文已随 `AnswerContext` 传入，故这里只表达意图，不复述题目与评分——
 * 复述会与结构化字段重复，并随字段演进而过期。
 */
export const ASK_COPILOT_ABOUT_FEEDBACK =
  '请结合我的作答与评分，详细讲解这道题的考察要点、我的理解偏差，以及正确的思路。';

/**
 * 面试进行中时，Copilot 的消息路由上下文。
 *
 * 为什么需要派生：侧栏的 `ConversationSession` 只在 question / chat 模式维护
 * `pendingAction` 与 `currentQuestionId`；面试模式下这两个字段的真源在共享的 Agent 会话里。
 * 若沿用侧栏那份陈旧 context，`shouldSubmitAsAnswer` 会判定「当前没有待作答题」，
 * 于是用户输入的「A」被路由到 Copilot（当成一次提问）而不是一次作答——面试直接卡死。
 *
 * 反过来，停在反馈卡上时答案通道必须关闭（`pendingAction='feedback'`）：此刻当前题已评分，
 * 再提交只会被运行时拒绝，用户输入的文本更可能是在追问。
 *
 * @param question Agent 会话的当前题；无题时原样返回（未开场 / 已收尾，路由不需要面试语义）
 */
export function interviewRoutingContext(
  base: ConversationContext,
  question: SessionQuestion | null,
  awaitingFeedback: boolean,
): ConversationContext {
  if (!question) return base;
  return {
    ...base,
    mode: 'interview',
    currentQuestionId: question.question.id,
    pendingAction: awaitingFeedback ? 'feedback' : 'answer',
  };
}
