import type { AnswerValue, LLMProvider } from '../../types';
import type { EvaluationResult } from '../../schemas/evaluation';
import type { InterviewDefinition } from '../../schemas/interview';
import type { SessionQuestion } from '../../schemas/session';
import { DEFAULT_RUBRIC } from '../../domain/evaluation';
import { evaluateSessionQuestion } from '../sessionEvaluator';

/** Shared evaluation capability. Null means unanswered, unavailable, or failed. */
export async function evaluateAnswer(
  question: SessionQuestion,
  answer: AnswerValue | undefined,
  provider: LLMProvider | null,
  definition?: Pick<InterviewDefinition, 'scoringRubric' | 'evaluationCriteria'>,
): Promise<EvaluationResult | null> {
  try {
    return await evaluateSessionQuestion(
      question,
      answer,
      provider,
      definition?.scoringRubric ?? DEFAULT_RUBRIC,
      definition?.evaluationCriteria,
    );
  } catch {
    // Provider/parse failures are not zero scores; preserve the null contract.
    return null;
  }
}
