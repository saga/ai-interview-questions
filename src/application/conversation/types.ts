import type { AnswerValue, LLMProvider, QuestionBank } from '../../types';
import type { AIConfig } from '../../schemas/ai-config';
import type { ConversationContext, UserIntent } from '../../schemas/conversation';
import type { EvaluationResult } from '../../schemas/evaluation';
import type { FormatId } from '../../schemas/common';
import type { LearnerProfile, SessionRecord } from '../../schemas/learner';
import type { Question } from '../../schemas/question';
import type { SessionQuestion } from '../../schemas/session';

export interface ConversationDeps {
  bank: QuestionBank;
  profile: LearnerProfile;
  config?: AIConfig;
  provider?: LLMProvider | null;
}

export interface AskQuestionInput {
  topic?: string;
  difficulty?: Question['difficulty'];
  format?: FormatId;
  excludeIds?: string[];
}

export interface ConversationQuestionResult {
  question: SessionQuestion;
  context: ConversationContext;
}

export interface ConversationEvaluationResult {
  evaluation: EvaluationResult | null;
  context: ConversationContext;
}

export interface ConversationRouteResult {
  intent: UserIntent;
  context: ConversationContext;
  reply?: string;
  question?: SessionQuestion;
  evaluation?: EvaluationResult | null;
}

export type ConversationAnswer = AnswerValue;
export type ConversationSessionRecord = SessionRecord;
