// Learner Profile 本地持久化（IndexedDB via Dexie）。
//
// - learner 表存单例画像（剔除 sessions）；sessions 表存拆分后的会话历史，带 startedAt/overall/*topics 索引。
// - loadLearner 从两表重组完整 LearnerProfile（sessions 按 SESSION_CAP 截断，保持与 updateLearner 一致的行为）。
// - saveLearner 把画像拆写两张表，并用事务保证原子性。
// - 不读取/不迁移任何旧 localStorage 数据：旧画像无意义，直接以空画像起步（用户决策）。
//
// 边界：IndexedDB 同样是不可信边界，读出的数据仍需经 Zod 形状校验（沿用 schemas/learner 的校验）。

import type { LearnerProfile, SessionRecord } from '../schemas/learner';
import type { ProficiencyConfig } from '../schemas/ai-config';
import { calculateProficiency, emptyProfile, recommendWeakTopics } from '../domain/learner';
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
export async function loadLearner(config?: ProficiencyConfig): Promise<LearnerProfile> {
  const stored = await db.learner.get(SINGLETON);
  if (!stored) return emptyProfile();

  const sessions = await db.sessions.orderBy('startedAt').reverse().toArray();
  const { id: _id, ...rest } = stored;
  const topicPracticeSessions = new Map<string, number>();
  for (const session of sessions) {
    for (const topic of new Set(session.questionResults.map((result) => result.topic))) {
      topicPracticeSessions.set(topic, (topicPracticeSessions.get(topic) ?? 0) + 1);
    }
  }
  const topicStats = Object.fromEntries(
    Object.entries(rest.topicStats).map(([topic, stat]) => {
      const practiceSessions = stat.practiceSessions ?? topicPracticeSessions.get(topic) ?? 0;
      return [topic, {
        ...stat,
        practiceSessions,
        mastery: calculateProficiency(stat.avgScore, stat.attempts, practiceSessions, config),
      }];
    }),
  );
  return {
    ...rest,
    topicStats,
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

/**
 * 清空全部学习数据（画像 + 会话历史），回到首次使用的干净状态。
 * 用于「重置学习数据」：让用户随时丢弃陈旧/测试遗留画像，
 * 使 Agent 面试等依赖 LearnerProfile 的功能重新从空白起步（随机探索）。
 */
export async function resetLearnerData(): Promise<void> {
  await db.transaction('rw', db.learner, db.sessions, async () => {
    await db.learner.clear();
    await db.sessions.clear();
  });
}

// ── IndexedDB 索引查询 API（喂给进度页 / Agent 上下文，直接命中 Dexie 索引） ──

/** 最近 N 次会话（按 startedAt 倒序，直接命中 startedAt 索引）。 */
export async function getRecentSessions(limit = 10): Promise<SessionRecord[]> {
  const rows = await db.sessions.orderBy('startedAt').reverse().limit(limit).toArray();
  return rows.map(({ topics: _t, ...s }) => s as SessionRecord);
}

/** 某 topic 的全部会话（命中 *topics 多值索引，无需全表扫描）。 */
export async function getSessionsByTopic(topic: string): Promise<SessionRecord[]> {
  const rows = await db.sessions.where('topics').equals(topic).toArray();
  // 按时间倒序
  rows.sort((a, b) => b.startedAt - a.startedAt);
  return rows.map(({ topics: _t, ...s }) => s as SessionRecord);
}

/** 某 topic 的逐题历史（扁平化 QuestionResult，按时间倒序）。 */
export async function getHistoryForTopic(topic: string): Promise<SessionRecord['questionResults'][number][]> {
  const sessions = await getSessionsByTopic(topic);
  return sessions.flatMap((s) => s.questionResults.filter((r: SessionRecord['questionResults'][number]) => r.topic === topic));
}

/** 弱项 topic（基于 LearnerProfile 的 mastery 阈值，直接复用 domain 逻辑）。 */
export async function getWeakTopics(limit = 3): Promise<string[]> {
  const profile = await loadLearner();
  return recommendWeakTopics(profile, limit);
}

/** 某 topic+angle 的逐题历史，用于角度级追问。 */
export async function getHistoryForTopicAngle(
  topic: string,
  angle?: string,
): Promise<SessionRecord['questionResults'][number][]> {
  const history = await getHistoryForTopic(topic);
  return angle ? history.filter((r: SessionRecord['questionResults'][number]) => r.angle === angle) : history;
}
