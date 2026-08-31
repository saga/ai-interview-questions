import type { ProficiencyConfig } from '../../schemas/ai-config';
import type { LearnerProfile, SessionRecord } from '../../schemas/learner';
import { recommendWeakTopics, updateLearner } from '../../domain/learner';
import { saveLearner } from '../../storage/learner';

export function getWeakTopics(profile: LearnerProfile, limit = 3): string[] {
  return recommendWeakTopics(profile, limit);
}

/**
 * Single application boundary for learner writes. The caller owns session
 * idempotency; this function only applies the pure update then persists it.
 */
export async function commitSession(
  profile: LearnerProfile,
  record: SessionRecord,
  proficiency?: ProficiencyConfig,
): Promise<LearnerProfile> {
  const next = updateLearner(profile, record, proficiency);
  await saveLearner(next);
  return next;
}
