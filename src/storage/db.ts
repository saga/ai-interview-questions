// Dexie 数据库 schema —— Trainer 的本地结构化存储（替代"整个 LearnerProfile 当 JSON blob 塞 localStorage"）。
//
// 设计要点：
// - learner 表：单例画像，落库时**剔除 sessions**（历史会话拆到 sessions 表），避免大 blob 重复序列化。
// - sessions 表：每条 SessionRecord 一行，建立 startedAt / overall / *topics 索引，
//   直接支撑 getRecentSessions / getWeakTopics 等范围/索引查询（localStorage 做不到）。
// - memory / agentSessions 表：为后续 Agent Memory、Agent 会话回放预留（架构方向所需，目前不强制写入）。
//
// 版本化迁移：version(1) 即首版。不读取/迁移任何旧 localStorage 数据——旧画像无意义，直接以空画像起步。

import Dexie, { type Table } from 'dexie';
import type { LearnerProfile, SessionRecord } from '../types';

/** learner 表行：画像去掉 sessions（历史在 sessions 表）。 */
export interface StoredLearner {
  /** 单例固定 id，便于 upsert。 */
  id: 'singleton';
  totalSessions: number;
  totalQuestions: number;
  overallScore: number;
  topicStats: LearnerProfile['topicStats'];
  updatedAt: number;
}

/** sessions 表行：即 SessionRecord，附冗余索引字段供 Dexie 建索引。 */
export interface StoredSession extends SessionRecord {
  /** Dexie 多值索引要求数组字段；topics 由 questionResults 推导，写入时一并填充。 */
  topics: string[];
}

/** 通用结构化记忆行（Agent/Learner Memory 预留）。 */
export interface MemoryEntry {
  id: string;
  kind: string;
  payload: unknown;
  updatedAt: number;
}

/** Agent 会话回放预留。 */
export interface AgentSessionEntry {
  id: string;
  startedAt: number;
  payload: unknown;
}

export class TrainerDB extends Dexie {
  learner!: Table<StoredLearner, string>;
  sessions!: Table<StoredSession, string>;
  memory!: Table<MemoryEntry, string>;
  agentSessions!: Table<AgentSessionEntry, string>;

  constructor() {
    super('ai-interview-trainer');
    this.version(1).stores({
      // 单例画像
      learner: 'id',
      // 会话历史：主键 id；startedAt/overall 单值索引，topics 多值索引（*）
      sessions: 'id, startedAt, overall, *topics',
      // 预留
      memory: 'id, kind, updatedAt',
      agentSessions: 'id, startedAt',
    });
  }
}

export const db = new TrainerDB();

/** 由 SessionRecord 推导 topics 数组（去重），供多值索引写入。 */
export function topicsOfSession(s: SessionRecord): string[] {
  return [...new Set(s.questionResults.map((r) => r.topic))];
}
