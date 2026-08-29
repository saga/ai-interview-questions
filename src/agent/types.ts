// Agent 运行时层的会话与事件类型。
// 这里只描述「本次 Agent 面试的运行时会话」——App 拥有它，Agent 通过工具读写它。
// 不依赖 React / LLM；纯类型，可单测。

import type { AnswerValue } from '../types';
import type { EvaluationResult } from '../schemas/evaluation';
import type { LearnerProfile, SessionRecord } from '../schemas/learner';
import type { SessionQuestion } from '../schemas/session';
import { sessionFromQuiz } from '../domain/learner';

/** Agent 面试的运行状态。 */
export type AgentStatus = 'running' | 'finished';

/** Agent 推理/工具调用的可读记录，供 UI 展示「决策过程」。 */
export interface AgentLogEntry {
  at: number;
  kind: 'tool' | 'decision' | 'event';
  /** 触发的工具名（kind==='tool' 时）。 */
  tool?: string;
  summary: string;
  details?: unknown;
}

/**
 * 本次 Agent 面试的运行时会话：Agent 决策的中心数据。
 * - `currentQuestion`：Agent 通过 getQuestion 工具选定、当前展示给用户作答的题；
 * - `answers` / `evaluations`：按 questionId 收集作答与评分，结束时交给 updateLearner 持久化；
 * - `log`：决策/工具调用轨迹，便于 UI 透明化 Agent 行为。
 * 该对象由 App 创建并持有，工具与运行时直接读写（引用共享），不经过 LLMProvider。
 */
export interface InterviewAgentSession {
  id: string;
  status: AgentStatus;
  startedAt: number;
  currentQuestion: SessionQuestion | null;
  answers: Record<string, AnswerValue>;
  evaluations: Record<string, EvaluationResult | null>;
  log: AgentLogEntry[];
}

/** 新建一个空的运行时会话。 */
export function createAgentSession(): InterviewAgentSession {
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : String(Date.now());
  return {
    id,
    status: 'running',
    startedAt: Date.now(),
    currentQuestion: null,
    answers: {},
    evaluations: {},
    log: [],
  };
}

/** UI 事件回调：把 Agent 生命周期事件与「当前题 / 状态」变化转给页面。 */
export interface AgentHandlers {
  /** 每个 AgentEvent（turn_end / tool_execution_* / message_update 等）。 */
  onEvent?: (event: unknown, signal: AbortSignal) => void;
  /** 当前题变化（getQuestion 或兜底交付后）。 */
  onQuestion?: (q: SessionQuestion | null) => void;
  /** 状态变化（finished 后）。 */
  onStatus?: (status: AgentStatus) => void;
  /** 运行期错误/自愈提示：fatal=true 为致命（应阻塞并 setError），否则为可恢复告警（如已兜底出题）。 */
  onError?: (message: string, fatal?: boolean) => void;
}

/** 计算已评分题数（用于「题数上限」停止条件）。 */
export function countEvaluated(session: InterviewAgentSession): number {
  return Object.keys(session.evaluations).length;
}

/** 从已评分结果聚合综合均分（0-100），无评分返回 0。 */
export function averageOverall(session: InterviewAgentSession): number {
  const vals = Object.values(session.evaluations).filter((e): e is EvaluationResult => e != null);
  if (vals.length === 0) return 0;
  return Math.round(vals.reduce((a, e) => a + e.overall, 0) / vals.length);
}

/**
 * 把一次 Agent 面试的运行时会话转化为可持久化的 SessionRecord，
 * 复用现有 `sessionFromQuiz`（选择题 gap 截断、overall 聚合等契约一并生效）。
 * - `questions`：本轮实际考察过的题（去重后的有序列表，由 UI 在 onQuestion 时累积）；
 *   仅保留「已评分」的题作为结果，避免把用户未答/未评估的选题以 0 分污染 Learner Memory；
 * - `evaluations`：按题目 id 收集，直接作为 grades 传入；
 * - 选择题的 gap 不污染 Learner Memory（与既有 engine 行为一致）。
 */
export function sessionRecordFromAgent(
  session: InterviewAgentSession,
  questions: SessionQuestion[],
  title = 'Agent 面试',
  durationSec?: number,
): SessionRecord {
  const evaluatedIds = new Set(Object.keys(session.evaluations));
  const asked = questions.filter((q) => evaluatedIds.has(q.question.id));
  return sessionFromQuiz(
    { questions: asked, startedAt: session.startedAt, definition: { title, mode: 'agent' } },
    session.evaluations,
    durationSec,
    session.answers,
  );
}

// LearnerProfile 在此仅作类型再导出，便于工具层直接引用，不引入运行时依赖。
export type { LearnerProfile };
