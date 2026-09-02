import { rankCandidatePool } from '../../domain/adaptive';
import { availableSessionFormats, finalizeQuestion } from '../sessionEvaluator';
import { variantPool } from '../../data/variantBank';
import type { SessionQuestion } from '../../schemas/session';
import type { ConversationDeps, AskQuestionInput } from './types';

/** Shared deterministic ranking used by Chat, Agent tools and interview flow. */
export function rankQuestions(deps: ConversationDeps, input: AskQuestionInput = {}) {
  const excluded = new Set(input.excludeIds ?? []);
  let pool = deps.bank.questions.filter((q) => !excluded.has(q.id));
  if (input.topic) pool = pool.filter((q) => q.topic === input.topic || q.category === input.topic);
  if (input.difficulty) pool = pool.filter((q) => q.difficulty === input.difficulty);
  if (deps.config?.disabledCategories?.length) {
    pool = pool.filter((q) => !deps.config!.disabledCategories!.includes(q.category));
  }
  return rankCandidatePool(pool, deps.profile);
}

/**
 * Shared question capability. It selects from the canonical bank and returns a
 * session snapshot; it never asks an LLM to invent assessment content.
 */
export async function askQuestion(
  deps: ConversationDeps,
  input: AskQuestionInput = {},
): Promise<SessionQuestion | null> {
  const ranked = rankQuestions(deps, input);
  for (const question of ranked) {
    const formats = availableSessionFormats(
      question,
      input.format ? [input.format] : undefined,
      Boolean(deps.provider),
      deps.config?.generateOpenQuestions,
    );
    if (formats.length === 0) continue;
    const format = input.format && formats.includes(input.format) ? input.format : formats[0];
    const sessionQuestion: SessionQuestion = { question, format };
    return finalizeQuestion(sessionQuestion, deps.provider ?? null, {
      variantPool,
      runtimeVariantEnabled: deps.config?.runtimeVariantEnabled ?? false,
      seenVariantIds: new Set<string>(),
    });
  }
  return null;
}
