import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { loadLearner, saveLearner, resetLearnerData } from './learner';
import { emptyProfile, updateLearner, sessionFromQuiz } from '../domain/learner';
import type { LearnerProfile, SessionRecord } from '../schemas/learner';

function mkRecord(over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random()),
    startedAt: Date.now(),
    durationSec: 60,
    mode: 'quick',
    title: '训练',
    questionResults: [
      { questionId: 'q1', category: 'c', topic: 'transformer', format: 'open', score: 80, gaps: [] },
      { questionId: 'q2', category: 'c', topic: 'moe', format: 'choice', score: 100, correct: true, gaps: [] },
    ],
    overall: 90,
    ...over,
  };
}

describe('storage/learner (IndexedDB)', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('空库 loadLearner 返回 emptyProfile', async () => {
    const p = await loadLearner();
    expect(p).toEqual(emptyProfile());
  });

  it('resetLearnerData 清空画像与会话，回到 emptyProfile', async () => {
    const base = emptyProfile();
    const profile = updateLearner(base, mkRecord({ startedAt: 1000, overall: 70 }));
    await saveLearner(profile);
    expect((await loadLearner()).totalSessions).toBe(1);

    await resetLearnerData();
    const after = await loadLearner();
    expect(after).toEqual(emptyProfile());
    expect(after.totalSessions).toBe(0);
    expect(Object.keys(after.topicStats)).toHaveLength(0);
  });

  it('save → load 往返保持画像与 sessions（且 sessions 在前序新→旧）', async () => {
    const base = emptyProfile();
    const r1 = mkRecord({ startedAt: 1000, overall: 70 });
    const r2 = mkRecord({ startedAt: 2000, overall: 90 });
    const profile = updateLearner(updateLearner(base, r1), r2);

    await saveLearner(profile);
    const got = await loadLearner();

    expect(got.totalSessions).toBe(2);
    expect(got.totalQuestions).toBe(4);
    // sessions 最新在前
    expect(got.sessions[0].startedAt).toBe(2000);
    expect(got.sessions[1].startedAt).toBe(1000);
    // topicStats 聚合正确：transformer 与 moe 均在两次会话各出现一次 → attempts=2
    expect(got.topicStats.transformer.attempts).toBe(2);
    expect(got.topicStats.moe.attempts).toBe(2);
  });

  it('save → load 往返保留 angleCoverage 与 conceptEvidence（证据层不会静默丢失）', async () => {
    // 两层证据都由 toStoredLearner 的对象展开落库；StoredLearner 类型现已显式声明它们，
    // 本用例锁定「往返不丢」，防止未来把 toStoredLearner 改成显式列字段时漏掉这两层。
    const record: SessionRecord = {
      ...mkRecord(),
      questionResults: [
        {
          questionId: 'q1',
          category: 'c',
          topic: 'rag',
          format: 'open',
          angle: 'mechanism',
          score: 50,
          gaps: [],
          missingConcepts: ['混合检索', 'PPO'],
        },
      ],
    };
    const profile = updateLearner(emptyProfile(), record);
    // 前置断言：内存里两层证据都已生成
    expect(Object.keys(profile.angleCoverage ?? {})).toContain('rag|mechanism');
    expect(profile.conceptEvidence?.['rag|混合检索']?.misses).toBe(1);

    await saveLearner(profile);
    const got = await loadLearner();

    expect(got.angleCoverage?.['rag|mechanism']).toEqual(profile.angleCoverage?.['rag|mechanism']);
    expect(got.conceptEvidence?.['rag|混合检索']?.misses).toBe(1);
    // 原始写法（label）也要保住，否则 "PPO" 会退化成 "ppo"
    expect(got.conceptEvidence?.['rag|ppo']?.label).toBe('PPO');
  });

  it('save 不会把 sessions 写进 learner 表（画像与历史分离）', async () => {
    const profile = updateLearner(emptyProfile(), mkRecord());
    await saveLearner(profile);
    const learnerRow = await db.learner.get('singleton');
    expect(learnerRow).toBeDefined();
    expect((learnerRow as { sessions?: unknown }).sessions).toBeUndefined();
    const sessionRows = await db.sessions.toArray();
    expect(sessionRows.length).toBe(1);
  });

  it('sessions 上限 SESSION_CAP=50（超出截断，与 updateLearner 一致）', async () => {
    let profile = emptyProfile();
    const records: SessionRecord[] = [];
    for (let i = 0; i < 60; i++) {
      const r = mkRecord({ id: `s${i}`, startedAt: i, overall: 50 });
      profile = updateLearner(profile, r);
      records.push(r);
    }
    await saveLearner(profile);
    const got = await loadLearner();
    expect(got.sessions.length).toBe(50);
  });

  it('sessionFromQuiz → updateLearner → save → load 端到端链路', async () => {
    const session = {
      questions: [
        { question: { id: 'q1', category: 'c', topic: 'attn', format: 'open' as const }, format: 'open' as const },
        { question: { id: 'q2', category: 'c', topic: 'attn', format: 'choice' as const }, format: 'choice' as const },
      ],
      startedAt: 123,
    };
    const grades = {
      q1: { overall: 60, dimensions: { correctness: 60 }, gaps: ['缺多头机制说明'] },
      q2: { overall: 100, dimensions: { correctness: 100 }, gaps: [] },
    } as never;
    const rec = sessionFromQuiz(session, grades, 30);
    const next = updateLearner(emptyProfile(), rec);
    await saveLearner(next);
    const loaded = await loadLearner();
    expect(loaded.sessions[0].overall).toBe(80);
    expect(loaded.topicStats.attn.attempts).toBe(2);
  });

  // ── 不可信边界（IndexedDB 可被用户手改 / 旧版本可能留下不兼容形状）──
  describe('读取时的 schema 边界', () => {
    it('learner 行损坏（topicStats 缺失）→ 退回空画像，不抛异常', async () => {
      // 修复前：`Object.entries(rest.topicStats)` 直接抛，整个「进度」页白屏。
      await db.learner.put({
        id: 'singleton',
        totalSessions: 1,
        totalQuestions: 2,
        overallScore: 90,
        updatedAt: Date.now(),
      } as never);
      await expect(loadLearner()).resolves.toEqual(emptyProfile());
    });

    it('learner 行字段类型错误（overallScore 越界）→ 退回空画像', async () => {
      await db.learner.put({
        id: 'singleton',
        totalSessions: 1,
        totalQuestions: 2,
        overallScore: 9999,
        topicStats: {},
        updatedAt: Date.now(),
      } as never);
      await expect(loadLearner()).resolves.toEqual(emptyProfile());
    });

    it('单条 session 行不可用（questionResults 缺失）→ 只丢那一行，其余记录保留', async () => {
      const profile = updateLearner(emptyProfile(), mkRecord({ id: 'good', startedAt: 1 }));
      await saveLearner(profile);
      // 塞一行坏数据（questionResults 缺失）
      await db.sessions.put({ id: 'bad', startedAt: 2, title: 'x', overall: 1 } as never);

      const loaded = await loadLearner();
      // 坏行被丢弃，好行仍在——一行损坏不该让用户全部学习记录归零。
      expect(loaded.sessions.map((s) => s.id)).toEqual(['good']);
    });

    it('旧记录的 questions 快照不符合当前 schema 时**不丢行**（只降级掉快照）', async () => {
      // 两段式口径：核心字段（id/startedAt/title/overall/questionResults）严格，
      // 回放快照（questions/answers）过不了当前 schema 时只摘掉该字段——为一条过时快照
      // 丢掉用户整段历史，代价远大于「这条记录的回放退化成『分数 + 解析』视图」。
      const profile = updateLearner(emptyProfile(), mkRecord({ id: 'legacy', startedAt: 1 }));
      await saveLearner(profile);
      await db.sessions.put({
        id: 'legacy',
        startedAt: 1,
        title: '训练',
        overall: 90,
        questionResults: [{ questionId: 'q1', category: 'c', topic: 'transformer', format: 'open', score: 80, gaps: [] }],
        // 旧形状：questions 是残缺的裸对象，过不了当前 sessionQuestionSchema
        questions: [{ question: { id: 'q1' }, format: 'open' }],
      } as never);

      const loaded = await loadLearner();
      expect(loaded.sessions.map((s) => s.id)).toEqual(['legacy']);
      // 快照被摘掉（而非保留一个坏形状给回放组件去崩）
      expect(loaded.sessions[0].questions).toBeUndefined();
      // 核心字段完好，聚合照常
      expect(loaded.sessions[0].overall).toBe(90);
    });

    it('单条 session 行核心字段不可用（questionResults 里是空对象）→ 丢掉该行', async () => {
      // 修复前：只查 Array.isArray，`{}` 能过，于是 `result.topic` 的 undefined 会被写进
      // topicPracticeSessions，进度页 / 历史回放也会拿到形状不对的行。
      const profile = updateLearner(emptyProfile(), mkRecord({ id: 'good', startedAt: 1 }));
      await saveLearner(profile);
      await db.sessions.put({
        id: 'junk',
        startedAt: 2,
        title: 'x',
        overall: 1,
        questionResults: [{}],
      } as never);

      const loaded = await loadLearner();
      expect(loaded.sessions.map((s) => s.id)).toEqual(['good']);
      // 脏 topic 不得进入练习场次统计
      expect(Object.keys(loaded.topicStats).sort()).toEqual(['moe', 'transformer']);
    });
  });
});
