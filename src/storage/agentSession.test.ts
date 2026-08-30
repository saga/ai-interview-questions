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
import type { SessionQuestion } from '../schemas/session';

/** 构造一份最小可存储草稿（session/messages/questions 用占位数据，验证 round-trip 不被篡改）。 */
function mkDraft(over: Partial<{ status: 'running' | 'finished'; updatedAt: number; entryId: string }> = {}) {
  const session = createAgentSession();
  if (over.status) session.status = over.status;
  session.currentQuestion = { question: { id: 'q1' }, format: 'choice' } as unknown as SessionQuestion;
  session.answers['q1'] = ['a'];
  session.lastSearchIds = ['q1', 'q2'];
  return {
    id: session.id,
    session,
    messages: [
      { role: 'user', content: '开始面试' },
      { role: 'assistant', content: [{ type: 'text', text: '好的，先看看你的薄弱主题。' }] },
    ],
    questions: [{ question: { id: 'q1' }, format: 'choice' }] as unknown as SessionQuestion[],
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

  it('deleteAgentSession 移除草稿', async () => {
    const rec = mkDraft();
    await saveAgentSession(rec);
    await deleteAgentSession(rec.id);
    expect(await loadAgentSession(rec.id)).toBeUndefined();
    expect(await getActiveAgentSession()).toBeUndefined();
  });
});
