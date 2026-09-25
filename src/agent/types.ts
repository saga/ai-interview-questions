// Agent 运行时层的会话与事件类型。
// 这里只描述「本次 Agent 面试的运行时会话」——App 拥有它，Agent 通过工具读写它。
// 不依赖 React / LLM；纯类型，可单测。

import type { AnswerValue } from '../types';
import type { EvaluationResult } from '../schemas/evaluation';
import type { LearnerProfile, SessionRecord } from '../schemas/learner';
import type { SessionQuestion } from '../schemas/session';
import {
  DEFAULT_INTERVIEW_FEEDBACK_MODE,
  type InterviewFeedbackMode,
} from '../schemas/interview';
import { sessionFromQuiz } from '../domain/learner';

/**
 * Agent 面试的运行状态。
 * - `running`：Agent 正在推进（选下一题 / 等待用户作答）；
 * - `awaiting_feedback`：本题已评分，**停在反馈上等用户确认**（仅 immediate 模式）；
 *   此时不得再出题、不得重复评分，直到 `continueAfterFeedback()` 被调用；
 * - `finished`：面试收尾。
 *
 * 现有比较点全部是 `=== 'finished'`（见 agentSession.ts 的续面过滤、useAgentInterview 的
 * 收尾判断），新增第三态是纯增量，不会改变任何既有分支。
 */
export type AgentStatus = 'running' | 'awaiting_feedback' | 'finished';

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
  /**
   * 逐题反馈模式（会话级）。`immediate` 时评分后停在 `awaiting_feedback`，
   * 由 `continueAfterFeedback()` 放行；`standard` 时评分后立即推进下一题。
   */
  feedbackMode: InterviewFeedbackMode;
  startedAt: number;
  currentQuestion: SessionQuestion | null;
  answers: Record<string, AnswerValue>;
  evaluations: Record<string, EvaluationResult | null>;
  log: AgentLogEntry[];
  /**
   * 最近一次 searchQuestions 返回的真实题目 id 列表（有序）。
   * 由工具层写入，作为 getQuestion「id 校验 / not_found 自纠正」的唯一可信池：
   * - getQuestion 找不到 id 时，直接回带这些可用 id，让 Agent 无需记忆即可挑真 id，
   *   （替代原本只能靠 prompt 提醒「回到列表挑真 id」的脆弱约束）；
   * - 避免 Agent 反复调用 searchQuestions（调用即幂等复用缓存列表）。
   */
  lastSearchIds: string[];
  /**
   * 兜底接管原因（telemetry，仅观察用，不驱动逻辑）：
   * - 'timeout'：看门狗超时（Agent 未在 WATCHDOG_MS 内交付题目）；
   * - 'model_error'：Agent 流式返回错误 / aborted；
   * - 'agent_no_action'：Agent run 正常收尾但未调用 getQuestion 交付题目。
   * 仅在首次兜底接管时记录一次，用于观察真实 Agent 稳定性（P1 第 4 项）。
   */
  fallbackReason?: 'timeout' | 'model_error' | 'agent_no_action';
  /** 兜底接管的次数（telemetry）：每次确定性兜底成功交付下一道题 +1。 */
  fallbackCount: number;
}

/** 新建一个空的运行时会话。`feedbackMode` 缺省为 `standard`（保持既有行为）。 */
export function createAgentSession(
  feedbackMode: InterviewFeedbackMode = DEFAULT_INTERVIEW_FEEDBACK_MODE,
): InterviewAgentSession {
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : String(Date.now());
  return {
    id,
    status: 'running',
    feedbackMode,
    startedAt: Date.now(),
    currentQuestion: null,
    answers: {},
    evaluations: {},
    log: [],
    lastSearchIds: [],
    fallbackCount: 0,
  };
}

/** UI 事件回调：把 Agent 生命周期事件与「当前题 / 状态」变化转给页面。 */
export interface AgentHandlers {
  /** 每个 AgentEvent（turn_end / tool_execution_* / message_update 等）。 */
  onEvent?: (event: unknown, signal: AbortSignal) => void;
  /** 当前题变化（getQuestion 或兜底交付后）。 */
  onQuestion?: (q: SessionQuestion | null) => void;
  /**
   * 本题评分完成（三条评分路径——选择题确定性评分 / 兜底评分 / LLM 工具评分——的**统一出口**）。
   * 三条路径最终都汇入同一个内部 `afterEvaluation()`，因此本回调天然对三种路径一致生效，
   * UI 无需分别适配。
   *
   * @param awaitingFeedback 本次评分后是否**停在反馈上等用户确认**（immediate 模式为 true，
   *   standard 模式为 false）。必须由运行时显式给出，不能让消费方去读 `session.status`：
   *   本回调在 `afterEvaluation` 内部触发，若消费方依赖状态字段，就会与「状态何时被写入」
   *   这一实现细节耦合——一旦顺序调整，反馈卡在 standard 模式下会静默出现（或反之消失）。
   */
  onEvaluation?: (
    q: SessionQuestion,
    answer: AnswerValue,
    evaluation: EvaluationResult,
    awaitingFeedback: boolean,
  ) => void;
  /** 状态变化（running / awaiting_feedback / finished）。 */
  onStatus?: (status: AgentStatus) => void;
  /** 运行期错误/自愈提示：fatal=true 为致命（应阻塞并 setError），否则为可恢复告警（如已兜底出题）。 */
  onError?: (message: string, fatal?: boolean) => void;
}

/**
 * 是否停在「等待用户确认反馈」上。
 * 所有「该不该继续出题 / 该不该再评分」的判断都应先过这个闸，
 * 避免把 immediate 的暂停语义散落成多处 `status === 'awaiting_feedback'` 字面量。
 */
export function isAwaitingFeedback(session: InterviewAgentSession): boolean {
  return session.status === 'awaiting_feedback';
}

/**
 * 已交付题数：`evaluations[id]` 在题目交付给用户时即建键（尚未评分时为 null），
 * 因此键数 = 已呈现给用户 / 已尝试过的题数，与 `isDelivered` 口径一致。
 *
 * 题数上限（MAX_AGENT_QUESTIONS）必须用本口径：若改用「已评分」口径，
 * 一旦评分连续失败（键值为 null），上限永远达不到，面试无法优雅收尾。
 */
export function countDelivered(session: InterviewAgentSession): number {
  return Object.keys(session.evaluations).length;
}

/**
 * 已评分题数：只统计真正拿到 EvaluationResult 的题目。
 * `null` 表示未作答 / 评估失败（不计入成绩），与 `averageOverall` 口径一致。
 */
export function countScored(session: InterviewAgentSession): number {
  return Object.values(session.evaluations).filter((e): e is EvaluationResult => e != null).length;
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
