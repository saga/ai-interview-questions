import { z } from 'zod';
import type { AnswerValue } from '../../types';
import type { EvaluationResult } from '../../schemas/evaluation';
import type { SessionQuestion } from '../../schemas/session';
import type { ConversationContext } from '../../schemas/conversation';
import { conversationContextSchema } from '../../schemas/conversation';
import { sessionQuestionSchema } from '../../schemas/session';
import { evaluationResultSchema } from '../../schemas/evaluation';
import { sessionFromQuiz } from '../../domain/learner';
import type { SessionRecord } from '../../schemas/learner';
import type { InterviewAgentSession } from '../../agent/types';
import {
  DEFAULT_INTERVIEW_FEEDBACK_MODE,
  interviewFeedbackModeSchema,
  type InterviewFeedbackMode,
} from '../../schemas/interview';

/**
 * ConversationSession is the real lifecycle object for Chat.
 * It aggregates multiple questions into ONE SessionRecord (P0-3/4).
 * Persisted as JSON in localStorage (messages + context together, P1-1).
 */
/**
 * ConversationSession 的运行时校验 schema（plan0831_5 §P2）。
 * 复用 question/evaluation 的既有 schema，避免重复定义；`agentSession` 是运行时对象、
 * 不持久化（见 saveConversationSession），故不纳入 schema。`.passthrough()` 允许旧版本
 * 残留字段（如 `turnCount`）通过，便于 load 时做版本迁移。
 */
const sessionAnswerValueSchema = z.union([z.array(z.number()), z.string()]);

export const conversationSessionSchema = z
  .object({
    id: z.string(),
    startedAt: z.number(),
    context: conversationContextSchema,
    messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string(), key: z.string() })),
    questions: z.array(sessionQuestionSchema),
    answers: z.record(z.string(), sessionAnswerValueSchema),
    evaluations: z.record(z.string(), evaluationResultSchema.nullable()),
    questionCount: z.number().optional(),
    messageTurnCount: z.number().optional(),
    /**
     * 逐题反馈模式（会话级）。显式声明而非依赖 `.passthrough()`：
     * passthrough 只能保留已有键，无法为旧版本写入的 session 补默认值；
     * 用 `.catch` 让非法/缺失值降级为 standard，而不是整份 session 校验失败被丢弃。
     */
    feedbackMode: interviewFeedbackModeSchema.catch(DEFAULT_INTERVIEW_FEEDBACK_MODE),
  })
  .passthrough();

export interface ConversationSession {
  id: string;
  startedAt: number;
  context: ConversationContext;
  messages: { role: 'user' | 'assistant'; content: string; key: string }[];
  questions: SessionQuestion[];
  answers: Record<string, AnswerValue>;
  evaluations: Record<string, EvaluationResult | null>;
  /** 出过几道题（plan0831_5 §P1-3：原 turnCount，语义是题数）。 */
  questionCount: number;
  /** 对话轮数（每次用户发送 +1），与 questionCount 解耦（plan0831_5 §P1-3）。 */
  messageTurnCount: number;
  /** 逐题反馈模式（会话级）：`immediate` 时每题评分后暂停等确认。 */
  feedbackMode: InterviewFeedbackMode;
  /**
   * 桥接字段（plan0831_5 §P1-2）：当 Chat 以「模拟面试」模式运行时，
   * 复用与独立 Agent Interview 同一份运行时会话（InterviewAgentSession），
   * 而非维护第三套状态。仅在内存中存在，不强制持久化（运行时对象，刷新后由 Agent 侧重建）。
   */
  agentSession?: InterviewAgentSession;
}

/** 空闲态上下文：无 session、无当前题，等待用户开口。 */
export function initialConversationContext(): ConversationContext {
  return { version: 1, mode: 'chat', questionHistory: [], questionCount: 0, messageTurnCount: 0, activeKnowledgeIds: [] };
}

/** 已交付某道题、等待作答。 */
export function questionContext(
  currentQuestionId: string,
  sessionId?: string,
  history: string[] = [],
): ConversationContext {
  return {
    version: 1,
    mode: 'question',
    sessionId,
    currentQuestionId,
    pendingAction: 'answer',
    questionHistory: [...history, currentQuestionId],
    questionCount: history.length + 1,
    messageTurnCount: history.length + 1,
  };
}

export function createConversationSession(
  sessionId: string,
  feedbackMode: InterviewFeedbackMode = DEFAULT_INTERVIEW_FEEDBACK_MODE,
): ConversationSession {
  return {
    id: sessionId,
    startedAt: Date.now(),
    context: { version: 1, mode: 'question', sessionId, pendingAction: 'choose_question', questionHistory: [], questionCount: 0, messageTurnCount: 0 },
    messages: [],
    questions: [],
    answers: {},
    evaluations: {},
    questionCount: 0,
    messageTurnCount: 0,
    feedbackMode,
  };
}

export function addQuestionToSession(session: ConversationSession, sq: SessionQuestion): ConversationSession {
  const nextHistory = [...(session.context.questionHistory ?? []), sq.question.id];
  return {
    ...session,
    questions: [...session.questions, sq],
    context: {
      ...session.context,
      currentQuestionId: sq.question.id,
      pendingAction: 'answer',
      questionHistory: nextHistory,
      questionCount: session.questionCount + 1,
      messageTurnCount: session.messageTurnCount + 1,
    },
    questionCount: session.questionCount + 1,
    messageTurnCount: session.messageTurnCount + 1,
  };
}

/**
 * 记录一次评分。
 *
 * @param options.awaitFeedback immediate 模式：评分后**不**清空当前题、**不**进入「选下一题」，
 *   而是把 `pendingAction` 置为 `'feedback'`，表示「已评分、停在反馈卡上等用户确认」。
 *   这与默认的 `'choose_question'`（已评分并清空当前题）语义不同：
 *   反馈卡需要回显题干与作答，故必须保留 `currentQuestionId`。
 */
export function addEvaluationToSession(
  session: ConversationSession,
  questionId: string,
  answer: AnswerValue,
  evaluation: EvaluationResult | null,
  options: { awaitFeedback?: boolean } = {},
): ConversationSession {
  const awaitFeedback = options.awaitFeedback ?? false;
  return {
    ...session,
    answers: { ...session.answers, [questionId]: answer },
    evaluations: { ...session.evaluations, [questionId]: evaluation },
    context: {
      ...session.context,
      pendingAction: awaitFeedback ? 'feedback' : 'choose_question',
      currentQuestionId: awaitFeedback ? questionId : undefined,
      lastEvaluationOverall: evaluation?.overall,
    },
  };
}

export function toSessionRecord(session: ConversationSession, title = 'Chat 连续训练'): SessionRecord | null {
  if (session.questions.length === 0) return null;
  const filteredQuestions = session.questions;
  // Build a quiz-like session for sessionFromQuiz: only graded questions count
  const durationSec = Math.max(1, Math.round((Date.now() - session.startedAt) / 1000));
  return sessionFromQuiz(
    { questions: filteredQuestions, startedAt: session.startedAt, definition: { title } },
    session.evaluations as Record<string, EvaluationResult | null>,
    durationSec,
    session.answers,
  );
}

export interface UpgradeIntent {
  intent: string;
  difficulty?: 'easy' | 'medium' | 'hard' | 'expert';
  topic?: string;
}

/**
 * 统一的「升级到 Agent 面试」策略（plan0831_6 P1-5 / 小问题）。
 * 之前 ConversationSession 层（`questionCount >= 2`）与 CopilotSidebar 内联各有一份 policy，
 * 现收口到此处作为唯一来源：题数达阈值 + 用户明确「继续面试」+ 带难度/主题信号才升级。
 */
export function shouldUpgradeToInterview(session: ConversationSession, intent?: UpgradeIntent): boolean {
  if (session.questionCount < 2) return false;
  if (!intent || intent.intent !== 'continue_interview') return false;
  return (
    intent.difficulty === 'hard' ||
    (Boolean(intent.topic) && (session.context.questionHistory?.length ?? 0) > 0)
  );
}

/**
 * 把运行时会话（InterviewAgentSession）投影到 ConversationSession（plan0831_6 P1-3）。
 *
 * 已删除（ADR-002：不留无引用代码）：Copilot 侧栏改为直接读写 App 层 `useAgentInterview`
 * 的会话状态后，「把 Agent 运行时会话投影成 ConversationSession」这一层就没有调用方了——
 * 它原本存在的唯一目的，是在两个独立 runtime 之间做单向同步。运行时合并后，
 * ConversationSession 只剩「Copilot 自己的 transcript + question 模式状态」这一职责。
 */

export const CONVERSATION_SESSION_KEY = 'ai-interview-conversation-session-v1';

export function loadConversationSession(): ConversationSession | null {
  try {
    const raw = localStorage.getItem(CONVERSATION_SESSION_KEY);
    if (!raw) return null;
    const parsed = conversationSessionSchema.safeParse(JSON.parse(raw));
    // 损坏 / 老版本数据：校验失败直接丢弃（不再用类型断言把脏数据塞进运行时，plan0831_5 §P2）。
    if (!parsed.success) return null;
    const data = parsed.data as Record<string, unknown>;
    // 版本迁移：旧字段 turnCount → questionCount（plan0831_5 §P1-3 改名）。
    if (data.questionCount === undefined && typeof data.turnCount === 'number') {
      data.questionCount = data.turnCount;
    }
    // messageTurnCount 缺省时与 questionCount 对齐，避免旧数据缺字段。
    if (data.messageTurnCount === undefined && typeof data.questionCount === 'number') {
      data.messageTurnCount = data.questionCount;
    }
    // agentSession 是运行时对象，不持久化；若旧数据残留则剔除。
    delete data.agentSession;
    return data as unknown as ConversationSession;
  } catch {
    return null;
  }
}

export function saveConversationSession(session: ConversationSession): void {
  try {
    // agentSession 是运行时对象（含 log 数组），不写入 localStorage（plan0831_5 §P1-2）。
    const { agentSession: _drop, ...persisted } = session;
    void _drop;
    localStorage.setItem(CONVERSATION_SESSION_KEY, JSON.stringify(persisted));
  } catch {
    // best effort
  }
}

export function clearConversationSession(): void {
  try {
    localStorage.removeItem(CONVERSATION_SESSION_KEY);
  } catch {
    // ignore
  }
}
