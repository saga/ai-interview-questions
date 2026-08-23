// Learner Profile 本地持久化（localStorage，MVP 阶段足够；数据量大再迁 IndexedDB）。

import type { LearnerProfile } from '../types';
import { emptyProfile } from '../domain/learner';

const KEY = 'ai-interview-trainer.learner.v1';

export function loadLearner(): LearnerProfile {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LearnerProfile>;
      if (parsed && typeof parsed.totalSessions === 'number' && Array.isArray(parsed.sessions)) {
        return {
          totalSessions: parsed.totalSessions,
          totalQuestions: parsed.totalQuestions ?? 0,
          overallScore: parsed.overallScore ?? 0,
          topicStats: parsed.topicStats ?? {},
          sessions: parsed.sessions,
          updatedAt: parsed.updatedAt ?? 0,
        };
      }
    }
  } catch {
    /* ignore 损坏数据，回退空画像 */
  }
  return emptyProfile();
}

export function saveLearner(p: LearnerProfile): void {
  localStorage.setItem(KEY, JSON.stringify(p));
}
