// Learner Profile 本地持久化（IndexedDB via Dexie）。
//
// - learner 表存单例画像（剔除 sessions）；sessions 表存拆分后的会话历史，带 startedAt/overall/*topics 索引。
// - loadLearner 从两表重组完整 LearnerProfile（sessions 按 SESSION_CAP 截断，保持与 updateLearner 一致的行为）。
// - saveLearner 把画像拆写两张表，并用事务保证原子性。
// - 不读取/不迁移任何旧 localStorage 数据：旧画像无意义，直接以空画像起步（用户决策）。
//
// 边界：IndexedDB 同样是不可信边界，读出的数据仍需经 Zod 形状校验（沿用 schemas/learner 的校验）。

import type { LearnerProfile } from '../types';
import { emptyProfile } from '../domain/learner';
import { db, topicsOfSession, type StoredLearner, type StoredSession } from './db';

const SESSION_CAP = 50;
const SINGLETON = 'singleton';

function toStoredLearner(p: LearnerProfile): StoredLearner {
  const { sessions: _sessions, ...rest } = p;
  return { id: SINGLETON, ...rest };
}

function toStoredSession(s: LearnerProfile['sessions'][number]): StoredSession {
  return { ...s, topics: topicsOfSession(s) };
}

/** 从 Dexie 重组完整 LearnerProfile；空库返回 emptyProfile。 */
export async function loadLearner(): Promise<LearnerProfile> {
  const stored = await db.learner.get(SINGLETON);
  if (!stored) return emptyProfile();

  const sessions = await db.sessions.orderBy('startedAt').reverse().toArray();
  const { id: _id, ...rest } = stored;
  return {
    ...rest,
    // 与 updateLearner 保持一致：新在前、上限 SESSION_CAP
    sessions: sessions.slice(0, SESSION_CAP).map(({ topics: _t, ...s }) => s),
  };
}

/** 把完整画像拆写 learner + sessions 两张表（事务原子写入）。 */
export async function saveLearner(p: LearnerProfile): Promise<void> {
  const learnerRow = toStoredLearner(p);
  const sessionRows = p.sessions.map(toStoredSession);

  await db.transaction('rw', db.learner, db.sessions, async () => {
    // 先清旧会话再写入当前快照（画像替换语义，非增量追加）
    await db.sessions.clear();
    await db.learner.put(learnerRow);
    if (sessionRows.length > 0) {
      await db.sessions.bulkPut(sessionRows);
    }
  });
}
