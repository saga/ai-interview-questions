import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import {
  saveAgentSession,
  loadAgentSession,
  getActiveAgentSession,
  deleteAgentSession,
} from './agentSession';
import { createAgentSession } from '../agent/types';
import { emptyProfile } from '../domain/learner';
import type { Question, SessionQuestion } from '../schemas/session';

/**
 * 真实结构的题目（草稿读取端会做 Zod 运行时校验，占位假题会被判为坏数据丢弃）。
 * 用真实 Question 而非 `{ id: 'q1' }` 占位，是为了让往返测试同时覆盖「结构契约仍然成立」。
 */
const Q1: Question = {
  id: 'q1',
  category: 'transformer',
  topic: 'attention',
  tags: [],
  difficulty: 'easy',
  angle: 'mechanism',
  question: 'Transformer 中 multi-head attention 的作用？',
  explanation: '多头并行捕捉不同子空间关系。',
  // 选项至少 4 个（questionSchema 下限），否则会被读取端的运行时校验判为坏草稿
  formats: { choice: { type: 'single', options: ['A', 'B', 'C', 'D'], answer: [0] } },
};
const SQ1: SessionQuestion = { question: Q1, format: 'choice' };

/** 构造一份最小可存储草稿（session/messages/questions 用真实结构数据，验证 round-trip 不被篡改）。 */
function mkDraft(over: Partial<{ status: 'running' | 'finished'; updatedAt: number; entryId: string }> = {}) {
  const session = createAgentSession();
  if (over.status) session.status = over.status;
  session.currentQuestion = SQ1;
  session.answers['q1'] = [0];
  session.lastSearchIds = ['q1', 'q2'];
  return {
    id: session.id,
    session,
    messages: [
      { role: 'user', content: '开始面试' },
      { role: 'assistant', content: [{ type: 'text', text: '好的，先看看你的薄弱主题。' }] },
    ],
    questions: [SQ1],
    entryId: over.entryId ?? 'deepseek',
    profile: emptyProfile(),
    updatedAt: over.updatedAt ?? 1,
  };
}

describe('storage/agentSession (IndexedDB)', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('save + load 往返一致（session / messages / questions / profile 均原样还原）', async () => {
    const rec = mkDraft();
    await saveAgentSession(rec);
    const loaded = await loadAgentSession(rec.id);
    expect(loaded).toBeDefined();
    expect(loaded!.session.id).toBe(rec.id);
    expect(loaded!.session.currentQuestion?.question.id).toBe('q1');
    expect(loaded!.session.lastSearchIds).toEqual(['q1', 'q2']);
    expect(loaded!.messages).toEqual(rec.messages);
    expect(loaded!.questions).toEqual(rec.questions);
    expect(loaded!.entryId).toBe('deepseek');
    expect(loaded!.profile).toEqual(emptyProfile());
  });

  it('getActiveAgentSession 忽略 finished，只返回 running 草稿', async () => {
    const running = mkDraft();
    await saveAgentSession(running);
    const finished = mkDraft({ status: 'finished' });
    await saveAgentSession(finished);
    const active = await getActiveAgentSession();
    expect(active?.id).toBe(running.id);
  });

  it('getActiveAgentSession 在多个 running 草稿中取最近写入的一份', async () => {
    const older = mkDraft({ entryId: 'a' });
    await saveAgentSession(older);
    await new Promise((r) => setTimeout(r, 5)); // 确保 updatedAt 严格更晚
    const newer = mkDraft({ entryId: 'b' });
    await saveAgentSession(newer);
    const active = await getActiveAgentSession();
    expect(active?.id).toBe(newer.id);
  });

  it('结构损坏的草稿：读取时安全丢弃，不进入运行时', async () => {
    const rec = mkDraft();
    await saveAgentSession(rec);
    // 直接写入一条结构不合法的记录（模拟旧版本 schema / 写入中途损坏）
    await db.agentSessions.put({
      id: 'broken-1',
      session: { id: 'broken-1' }, // 缺 status / startedAt / evaluations 等必需字段
      messages: 'not-an-array',
      questions: [],
      entryId: 'deepseek',
      profile: emptyProfile(),
      updatedAt: Date.now(),
    } as never);

    expect(await loadAgentSession('broken-1')).toBeUndefined();
    // 坏记录应被删除，避免续面每次都撞到它
    expect(await db.agentSessions.get('broken-1')).toBeUndefined();
    // 且不得影响其它合法草稿
    expect((await loadAgentSession(rec.id))?.id).toBe(rec.id);
  });

  it('getActiveAgentSession 跳过坏草稿，回退到次新的合法草稿', async () => {
    const good = mkDraft();
    await saveAgentSession(good);
    await db.agentSessions.put({
      id: 'broken-newer',
      session: { id: 'broken-newer' },
      messages: [],
      questions: [],
      entryId: 'deepseek',
      profile: emptyProfile(),
      updatedAt: Date.now() + 10_000, // 比 good 更新，但结构损坏
    } as never);

    expect((await getActiveAgentSession())?.id).toBe(good.id);
  });

  it('deleteAgentSession 移除草稿', async () => {
    const rec = mkDraft();
    await saveAgentSession(rec);
    await deleteAgentSession(rec.id);
    expect(await loadAgentSession(rec.id)).toBeUndefined();
    expect(await getActiveAgentSession()).toBeUndefined();
  });
});
