// Dexie 数据库 schema —— Trainer 的本地结构化存储（替代"整个 LearnerProfile 当 JSON blob 塞 localStorage"）。
//
// 设计要点：
// - learner 表：单例画像，落库时**剔除 sessions**（历史会话拆到 sessions 表），避免大 blob 重复序列化。
// - sessions 表：每条 SessionRecord 一行，建立 startedAt / overall / *topics 索引，
//   直接支撑 getRecentSessions / getWeakTopics 等范围/索引查询（localStorage 做不到）。
//
// 版本化迁移：version(1) 即首版。不读取/迁移任何旧 localStorage 数据——旧画像无意义，直接以空画像起步。

import Dexie, { type Table } from 'dexie';
import type { LearnerProfile, SessionRecord } from '../schemas/learner';
import type { InterviewAgentSession } from '../agent/types';

/** learner 表行：画像去掉 sessions（历史在 sessions 表）。 */
export interface StoredLearner {
  /** 单例固定 id，便于 upsert。 */
  id: 'singleton';
  totalSessions: number;
  totalQuestions: number;
  overallScore: number;
  topicStats: LearnerProfile['topicStats'];
  /**
   * Concept×Angle 逐角度证据（`LearnerProfile.angleCoverage`）。
   * 运行时由 `toStoredLearner` 的对象展开写入 IndexedDB（Dexie 会保留未知字段，所以此前「碰巧能用」），
   * 但类型上缺失 ⇒ 一旦有人把 toStoredLearner 改成显式列字段，这层证据会被静默丢掉。显式声明以防漂移。
   */
  angleCoverage?: LearnerProfile['angleCoverage'];
  /** 概念级缺失证据（`LearnerProfile.conceptEvidence`），同上理由显式声明。 */
  conceptEvidence?: LearnerProfile['conceptEvidence'];
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
  /** 日志类型：错误、审计或运行事件。旧记录缺省为 error。 */
  kind?: 'error' | 'audit' | 'runtime';
  /** 稳定事件名，便于筛选和后续分析。 */
  event?: string;
  /** 严重级别。 */
  level?: 'info' | 'warning' | 'error';
  /** 面向用户的错误信息（即抛出的 message）。 */
  message: string;
  /** 结构化上下文：provider / model / stopReason / errorMessage / promptLen 等，便于回溯。 */
  detail?: unknown;
  /** 写入时间戳。 */
  createdAt: number;
}

/**
 * 进行中 Agent 面试的可恢复草稿（刷新/重开页面后据此续上面试）。
 * 只存重建 createInterviewAgent 所必需的状态，不重复存题库（恢复时由数据文件重新加载）。
 * 设计要点：
 * - `session` / `messages` / `questions` 是续面三要素：session=应用状态、messages=Agent 对话历史（append-only）、
 *   questions=已交付题列表（用于最终落库）；均为纯数据，IndexedDB 结构化克隆可序列化。
 * - `entryId` 而非整份 ProviderEntry：避免把 apiKey 落本地库；恢复时从 config 按 id 重新查找并走当前密钥。
 * - `profile` 存面试开始时的画像快照：弱项推荐基于它，保证中断前后一致（不随后续练习漂移）。
 */
export interface StoredAgentSession {
  /** 等于 InterviewAgentSession.id（进行中面试唯一 id，亦为主键）。 */
  id: string;
  session: InterviewAgentSession;
  /** agent.state.messages 完整对话历史（含 system 之外的全部轮次），恢复时整体写回以续上上下文。 */
  messages: unknown[];
  /** 已交付题目列表（SessionQuestion[]），UI 展示与最终 sessionRecordFromAgent 计算均依赖它。 */
  questions: unknown[];
  /** 引擎 id：恢复时从 config.providers 重新查找 ProviderEntry。 */
  entryId: string;
  /** 面试开始时的画像快照。 */
  profile: LearnerProfile;
  updatedAt: number;
}

export class TrainerDB extends Dexie {
  learner!: Table<StoredLearner, string>;
  sessions!: Table<StoredSession, string>;
  errorLog!: Table<ErrorLogEntry, number>;
  agentSessions!: Table<StoredAgentSession, string>;

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
    // v3：将 errorLog 扩展为通用本地日志表，旧记录保持可读
    this.version(3).stores({
      learner: 'id',
      sessions: 'id, startedAt, overall, *topics',
      errorLog: '++id, scope, createdAt, kind, event, level',
    }).upgrade((tx) => tx.table('errorLog').toCollection().modify((entry: ErrorLogEntry) => {
      entry.kind ??= 'error';
      entry.event ??= 'error';
      entry.level ??= 'error';
    }));
    // v4：新增 agentSessions 进行中面试草稿表（刷新/重开可续面），其余表结构不变
    this.version(4).stores({
      learner: 'id',
      sessions: 'id, startedAt, overall, *topics',
      errorLog: '++id, scope, createdAt, kind, event, level',
      agentSessions: 'id, updatedAt',
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
  await recordLog({ scope, event: 'error', kind: 'error', level: 'error', message, detail });
}

/** 记录一条通用本地日志；detail 由调用方提供安全摘要，不应包含原文或密钥。 */
export async function recordLog(entry: Omit<ErrorLogEntry, 'id' | 'createdAt'>): Promise<void> {
  try {
    await db.errorLog.add({ ...entry, createdAt: Date.now() });
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
