// 会话级学习状态（P0-1）：把「历史 LearnerProfile + 本轮 evaluations」叠加成有效画像。
// 问题背景：Agent 工具创建时闭包捕获 profile 快照，getUserWeaknesses / getWeakAngles /
// getCoverageGaps 读到的永远是「面试开始前」的画像——第 1 题答 40 分，第 2 题的
// 「薄弱主题」仍然只反映历史，本轮表现完全丢失，自适应无法闭环。
//
// 设计：不修改持久化画像（ADR：画像只在 finishInterview 后由 updateLearner 落库），
// 而是在工具/兜底读取时**即时叠加**：把本轮已评分结果经 sessionFromQuiz + updateLearner
// 合成「如果本轮现在落库，画像会是什么样」的 effective profile。纯函数、无副作用、
// 每次调用从基准 profile 重算（会话增长也幂等），≤10 条结果，成本可忽略。
//
// 与 updateLearner 的口径对齐：null 评分（未作答/评估失败）不入账、不伪造 0 分；
// 选择题误解命中（misconceptionIds）随 sessionFromQuiz 一并叠加，本轮错选同样能反馈给后续决策。

import type { LearnerProfile } from '../schemas/learner';
import type { Question } from '../schemas/question';
import type { SessionQuestion } from '../schemas/session';
import { sessionFromQuiz, updateLearner } from '../domain/learner';
import type { InterviewAgentSession } from './types';

/**
 * 由运行时会话推导「有效学习画像」：历史 profile 叠加本轮已评分结果。
 *
 * @param session 运行时会话（evaluations / answers / startedAt）
 * @param bank    题库（按 id 还原题目快照与呈现形态）
 * @param profile 历史画像（面试开始前的持久化快照，不会被修改）
 */
export function effectiveProfileFor(
  session: InterviewAgentSession,
  bank: Question[],
  profile: LearnerProfile,
): LearnerProfile {
  const byId = new Map(bank.map((q) => [q.id, q]));
  // 已交付/已评分的题目快照；呈现形态按「有 choice 用 choice，否则 open」还原
  // （与 getQuestion / fallbackNextQuestion 的选型逻辑一致，仅影响加权，不影响判定）。
  const asked: SessionQuestion[] = Object.keys(session.evaluations)
    .map((id) => byId.get(id))
    .filter((q): q is Question => q != null)
    .map((q) => ({ question: q, format: q.formats.choice ? 'choice' : 'open' }));
  const record = sessionFromQuiz(
    { questions: asked, startedAt: session.startedAt, definition: { title: 'Agent 面试（进行中）', mode: 'agent' } },
    session.evaluations,
    undefined,
    session.answers,
  );
  // 无有效评分时 updateLearner 原样返回基准画像（与「不入账」语义一致）
  return updateLearner(profile, record);
}
