// Dexie 数据库 schema —— Trainer 的本地结构化存储（替代"整个 LearnerProfile 当 JSON blob 塞 localStorage"）。
//
// 设计要点：
// - learner 表：单例画像，落库时**剔除 sessions**（历史会话拆到 sessions 表），避免大 blob 重复序列化。
// - sessions 表：每条 SessionRecord 一行，建立 startedAt / overall / *topics 索引，
//   直接支撑 getRecentSessions / getWeakTopics 等范围/索引查询（localStorage 做不到）。
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

/** 错误日志行（诊断/回溯用，与 LearnerProfile / sessions 等业务数据隔离）。 */
export interface ErrorLogEntry {
  /** 自增主键。 */
  id?: number;
  /** 出错模块：'copilot' / 'interview' / 'agent' 等。 */
  scope: string;
  /** 面向用户的错误信息（即抛出的 message）。 */
  message: string;
  /** 结构化上下文：provider / model / stopReason / errorMessage / promptLen 等，便于回溯。 */
  detail?: unknown;
  /** 写入时间戳。 */
  createdAt: number;
}

export class TrainerDB extends Dexie {
  learner!: Table<StoredLearner, string>;
  sessions!: Table<StoredSession, string>;
  errorLog!: Table<ErrorLogEntry, number>;

  constructor() {
    super('ai-interview-trainer');
    // 首版：画像 + 会话
    this.version(1).stores({
      learner: 'id',
      sessions: 'id, startedAt, overall, *topics',
    });
    // v2：新增 errorLog 诊断表（不改动既有表结构，仅追加）
    this.version(2).stores({
      learner: 'id',
      sessions: 'id, startedAt, overall, *topics',
      errorLog: '++id, scope, createdAt',
    });
  }
}

export const db = new TrainerDB();

/** 由 SessionRecord 推导 topics 数组（去重），供多值索引写入。 */
export function topicsOfSession(s: SessionRecord): string[] {
  return [...new Set(s.questionResults.map((r) => r.topic))];
}

/**
 * 记录一条错误日志到本地库（fire-and-forget，失败静默）。
 * 用于出错时回溯：结构化 detail 写入 errorLog 表，与生产/业务数据隔离。
 * 不阻塞主流程——无 IndexedDB 的环境（如部分测试/SSR）直接吞掉。
 */
export async function recordErrorLog(scope: string, message: string, detail?: unknown): Promise<void> {
  try {
    await db.errorLog.add({ scope, message, detail, createdAt: Date.now() });
  } catch {
    /* 持久化不可用时不抛，避免影响主流程 */
  }
}

/** 读取最近的 errorLog 记录（按时间倒序），供诊断面板回溯。 */
export async function getErrorLogs(limit = 100): Promise<ErrorLogEntry[]> {
  try {
    return await db.errorLog.orderBy('createdAt').reverse().limit(limit).toArray();
  } catch {
    return [];
  }
}

/** 清空 errorLog 表（诊断面板「清空」用）。 */
export async function clearErrorLogs(): Promise<void> {
  try {
    await db.errorLog.clear();
  } catch {
    /* 同上 */
  }
}
