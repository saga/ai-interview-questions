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

export function createConversationSession(sessionId: string): ConversationSession {
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

export function addEvaluationToSession(
  session: ConversationSession,
  questionId: string,
  answer: AnswerValue,
  evaluation: EvaluationResult | null,
): ConversationSession {
  return {
    ...session,
    answers: { ...session.answers, [questionId]: answer },
    evaluations: { ...session.evaluations, [questionId]: evaluation },
    context: {
      ...session.context,
      pendingAction: 'choose_question',
      currentQuestionId: undefined,
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
 * 明确「Agent 运行时会话 = runtime 真源，ConversationSession = 投影」：Chat 不再手工
 * `{...base.answers, ...controller.session.answers}` 双向同步，避免长期 drift。题数 / 作答 /
 * 评分配额都从这里统一计算（projectToConversationSession 是单一写入点）。
 *
 * @param base 当前 ConversationSession（投影的基底）
 * @param agentSession 运行时会话（真源）
 * @param messages 完整 transcript（含本轮用户消息与即将追加的助手消息）
 * @param opts.deliveredQuestion 本轮刚交付给用户作答的新题；收尾 / 「结束」时传 null
 * @param opts.countAsNew 是否把 deliveredQuestion 计入题数（每交付一题 +1；收尾 / 换题不计重复）
 */
export function projectToConversationSession(
  base: ConversationSession,
  agentSession: InterviewAgentSession,
  messages: { role: 'user' | 'assistant'; content: string; key: string }[],
  opts: { deliveredQuestion?: SessionQuestion | null; countAsNew?: boolean } = {},
): ConversationSession {
  const delivered = opts.deliveredQuestion ?? null;
  const countAsNew = opts.countAsNew ?? false;
  const questionCount = countAsNew ? base.questionCount + 1 : base.questionCount;
  const messageTurnCount = countAsNew ? base.messageTurnCount + 1 : base.messageTurnCount;
  const questions = delivered && !base.questions.some((q) => q.question.id === delivered.question.id)
    ? [...base.questions, delivered]
    : base.questions;
  // delivered=null 表示本轮收尾：清空当前题；delivered 为具体题则指向它；未传（undefined）沿用原值。
  const currentQuestionId = delivered ? delivered.question.id : delivered === null ? undefined : base.context.currentQuestionId;
  return {
    ...base,
    messages,
    answers: { ...base.answers, ...agentSession.answers },
    evaluations: { ...base.evaluations, ...agentSession.evaluations },
    agentSession,
    questions,
    questionCount,
    messageTurnCount,
    context: {
      ...base.context,
      mode: 'interview',
      currentQuestionId,
      pendingAction: delivered ? 'answer' : 'choose_question',
      questionHistory: delivered ? [...(base.context.questionHistory ?? []), delivered.question.id] : base.context.questionHistory,
      questionCount,
      messageTurnCount,
    },
  };
}

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
