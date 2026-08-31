import type { AnswerValue } from '../../types';
import type { EvaluationResult } from '../../schemas/evaluation';
import type { SessionQuestion } from '../../schemas/session';
import type { ConversationContext } from '../../schemas/conversation';
import { sessionFromQuiz } from '../../domain/learner';
import type { SessionRecord } from '../../schemas/learner';

/**
 * ConversationSession is the real lifecycle object for Chat.
 * It aggregates multiple questions into ONE SessionRecord (P0-3/4).
 * Persisted as JSON in localStorage (messages + context together, P1-1).
 */
export interface ConversationSession {
  id: string;
  startedAt: number;
  context: ConversationContext;
  messages: { role: 'user' | 'assistant'; content: string; key: string }[];
  questions: SessionQuestion[];
  answers: Record<string, AnswerValue>;
  evaluations: Record<string, EvaluationResult | null>;
  turnCount: number;
}

export function createConversationSession(sessionId: string): ConversationSession {
  return {
    id: sessionId,
    startedAt: Date.now(),
    context: { version: 1, mode: 'question', sessionId, pendingAction: 'choose_question', questionHistory: [], turnCount: 0 },
    messages: [],
    questions: [],
    answers: {},
    evaluations: {},
    turnCount: 0,
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
      turnCount: session.turnCount + 1,
    },
    turnCount: session.turnCount + 1,
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

export function shouldUpgradeToInterview(session: ConversationSession): boolean {
  // Heuristic: after 2+ turns with explicit difficulty/continue requests, upgrade makes sense.
  // For now: if turnCount >= 2 and lastEvaluation exists, suggest upgrade path.
  // Caller decides whether to auto-upgrade or ask.
  return session.turnCount >= 2;
}

export const CONVERSATION_SESSION_KEY = 'ai-interview-conversation-session-v1';

export function loadConversationSession(): ConversationSession | null {
  try {
    const raw = localStorage.getItem(CONVERSATION_SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ConversationSession;
  } catch {
    return null;
  }
}

export function saveConversationSession(session: ConversationSession): void {
  try {
    localStorage.setItem(CONVERSATION_SESSION_KEY, JSON.stringify(session));
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
