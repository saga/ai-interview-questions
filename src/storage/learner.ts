// Learner Profile 本地持久化（localStorage，MVP 阶段足够；数据量大再迁 IndexedDB）。
// 边界：localStorage 为不可信边界，即使是自己写进去的数据也可能因旧版本/手工篡改/损坏而非法。
// Zod 负责形状校验，domain 负责业务不变量；版本化包装为后续迁移预留（当前读写均兼容旧直接存储形态）。

import type { LearnerProfile } from '../types';
import { emptyProfile } from '../domain/learner';
import { parsePersistedLearner, serializePersistedLearner } from '../schemas/learner';

const KEY = 'ai-interview-trainer.learner.v1';

export function loadLearner(): LearnerProfile {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      const validated = parsePersistedLearner(parsed);
      if (validated) {
        // 通过 Zod 形状校验的已信任对象；缺省字段由 schema 保证
        return validated as LearnerProfile;
      }
      // 兼容旧存储的宽松回退：仅做最小形状检查，避免完全丢弃用户数据
      const p = parsed as Partial<LearnerProfile>;
      if (p && typeof p.totalSessions === 'number' && Array.isArray(p.sessions)) {
        return {
          totalSessions: p.totalSessions,
          totalQuestions: p.totalQuestions ?? 0,
          overallScore: p.overallScore ?? 0,
          topicStats: p.topicStats ?? {},
          sessions: p.sessions as LearnerProfile['sessions'],
          updatedAt: p.updatedAt ?? 0,
        };
      }
    }
  } catch {
    /* ignore 损坏数据，回退空画像 */
  }
  return emptyProfile();
}

export function saveLearner(p: LearnerProfile): void {
  // 新写入一律带 version 包装；旧数据读取时仍兼容无 version 形态（migration 在 load 时完成）
  try {
    localStorage.setItem(KEY, JSON.stringify(serializePersistedLearner(p as never)));
  } catch {
    // 存储失败时回退为直接存储（极少数配额/序列化异常）
    localStorage.setItem(KEY, JSON.stringify(p));
  }
}
