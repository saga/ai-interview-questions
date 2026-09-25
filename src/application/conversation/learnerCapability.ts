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
 *
 * 注意（2026-09 评审 P1）：本函数目前**没有调用方**。若要重新接线，必须经过
 * `application/learnerCommit.ts` 的串行提交队列——`updateLearner` 是读-改-写，
 * 两个入口并发时后写入者会用旧快照覆盖先写入者，先完成的成绩被静默丢弃
 * （`saveLearner` 的 Dexie 事务只保证单次写入原子，覆盖不了跨调用的读-改-写）。
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
