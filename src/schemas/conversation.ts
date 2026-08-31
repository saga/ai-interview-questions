import { z } from 'zod';
import { difficultySchema, formatIdSchema } from './common';

export const conversationModeSchema = z.enum(['chat', 'question', 'interview']);
export const pendingActionSchema = z.enum(['answer', 'choose_question']);

export const conversationContextSchema = z.object({
  version: z.literal(1),
  mode: conversationModeSchema,
  sessionId: z.string().min(1).optional(),
  currentQuestionId: z.string().min(1).optional(),
  pendingAction: pendingActionSchema.optional(),
  // Rich history for adaptive routing (P0-2/12): not required for validation, best-effort persisted.
  questionHistory: z.array(z.string()).optional(),
  lastEvaluationOverall: z.number().min(0).max(100).optional(),
  // 出过几道题（原计划称 turnCount，但语义是「题数」而非对话轮数，故改名，plan0831_5 §P1-3）。
  questionCount: z.number().min(0).optional(),
  // 独立的对话轮数（每次用户发送消息 +1），与 questionCount 解耦（plan0831_5 §P1-3）。
  messageTurnCount: z.number().min(0).optional(),
  // 上一场训练已结束的时间戳；存在时 UI 提示「上一 session 已结束」，
  // 后续「下一题」应开新会话而非续接到已清空的 session（plan0831_5 §P1-4）。
  endedAt: z.number().min(0).optional(),
});

export const userIntentTypeSchema = z.enum([
  'start_interview',
  'ask_question',
  'answer_current_question',
  'continue_interview',
  'end_interview',
  'evaluate_answer',
  'explain_topic',
  'general_chat',
]);

export const userIntentSchema = z.object({
  version: z.literal(1),
  intent: userIntentTypeSchema,
  topic: z.string().min(1).optional(),
  difficulty: difficultySchema.optional(),
  format: formatIdSchema.optional(),
  answer: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export type ConversationMode = z.infer<typeof conversationModeSchema>;
export type PendingAction = z.infer<typeof pendingActionSchema>;
export type ConversationContext = z.infer<typeof conversationContextSchema>;
export type UserIntent = z.infer<typeof userIntentSchema>;
