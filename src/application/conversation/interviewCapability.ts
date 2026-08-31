import type { LLMProvider, QuestionBank } from '../../types';
import type { AIConfig } from '../../schemas/ai-config';
import type { InterviewDefinition } from '../../schemas/interview';
import type { LearnerProfile } from '../../schemas/learner';
import type { AnswerValue } from '../../types';
import type { InterviewSession, SessionQuestion } from '../../schemas/session';
import type { EvaluationResult } from '../../schemas/evaluation';
import { buildSession, nextAdaptiveStep } from '../interviewEngine';
import { evaluateAnswer } from './evaluationCapability';
import type { AnswerSignal, Strategy } from '../../domain/adaptive';

export async function startInterview(
  bank: QuestionBank,
  definition: InterviewDefinition,
  config?: AIConfig,
): Promise<InterviewSession> {
  return buildSession(bank, definition, config);
}

export async function evaluateInterviewAnswer(
  question: SessionQuestion,
  answer: AnswerValue | undefined,
  provider: LLMProvider | null,
  definition: InterviewDefinition,
): Promise<EvaluationResult | null> {
  return evaluateAnswer(question, answer, provider, definition);
}

export async function continueAdaptiveInterview(
  bank: QuestionBank,
  session: InterviewSession,
  signals: AnswerSignal[],
  profile: LearnerProfile,
  config?: AIConfig,
  provider?: LLMProvider,
): Promise<{ question: SessionQuestion; strategy: Strategy } | null> {
  return nextAdaptiveStep(bank, session, signals, profile, config, provider);
}
