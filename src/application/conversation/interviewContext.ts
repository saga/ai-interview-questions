// 独立 Agent 面试 ↔ Copilot 侧栏的桥接上下文（纯类型 + 纯函数，不依赖 React）。
//
// 为什么需要它：Agent 面试的运行时状态由 App 层的 `useAgentInterview` 持有，
// 与 Copilot 侧栏自己那份 `ConversationSession` 是**两个彼此独立的 runtime**。
// 用户在 Agent 面试页点「让 Copilot 详细解释」时，Copilot 手里没有那场面试的作答与评分，
// 只能靠调用方手拼一段 prompt 描述——那就是第二套上下文格式，必然与 AnswerContext 漂移。
//
// 这里把它收敛成结构化对象：Agent 侧产出 `ActiveInterviewContext`，
// Copilot 侧消费为既有的 `AnswerContext`（**唯一**上下文契约）。

import type { AnswerValue } from '../../types';
import type { EvaluationResult } from '../../schemas/evaluation';
import type { SessionQuestion } from '../../schemas/session';
import type { InterviewFeedbackMode } from '../../schemas/interview';
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
