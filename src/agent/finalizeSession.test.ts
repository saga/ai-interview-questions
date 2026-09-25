// 收尾顺序契约：先落库，成功之后才排空并删除草稿。
//
// 顺序一旦被调换，只在**落库失败**时才会暴露（成绩静默丢失、且没有重试入口），
// 正常路径完全看不出来——故这里用调用顺序断言把契约钉死。

import { describe, it, expect, vi } from 'vitest';
import type { SessionRecord } from '../schemas/learner';
import { finalizeSession } from './finalizeSession';

const RECORD = { id: 's1', questionResults: [] } as unknown as SessionRecord;

describe('finalizeSession', () => {
  it('成功：顺序为 persist → flushDraft → deleteDraft', async () => {
    const calls: string[] = [];
    const outcome = await finalizeSession({
      record: RECORD,
      persist: async () => {
        calls.push('persist');
      },
      flushDraft: async () => {
        calls.push('flush');
      },
      deleteDraft: async () => {
        calls.push('delete');
      },
    });
    expect(outcome).toEqual({ ok: true });
    expect(calls).toEqual(['persist', 'flush', 'delete']);
  });

  it('★落库失败：草稿绝不被删除，且返回失败', async () => {
    const flushDraft = vi.fn(async () => {});
    const deleteDraft = vi.fn(async () => {});
    const outcome = await finalizeSession({
      record: RECORD,
      persist: async () => {
        throw new Error('QuotaExceededError');
      },
      flushDraft,
      deleteDraft,
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.error.message).toBe('QuotaExceededError');
    // 核心断言：草稿是这次结果唯一的可恢复副本，落库失败时必须原样保留
    expect(deleteDraft).not.toHaveBeenCalled();
    expect(flushDraft).not.toHaveBeenCalled();
  });

  it('抛出非 Error（如字符串）也被包装，保证调用方能拿到 message', async () => {
    const outcome = await finalizeSession({
      record: RECORD,
      persist: async () => {
        throw 'boom';
      },
      flushDraft: async () => {},
      deleteDraft: async () => {},
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.error.message).toBe('boom');
  });

  it('record 为 null（本轮无有效成绩）：跳过落库，仍清理草稿', async () => {
    const calls: string[] = [];
    const outcome = await finalizeSession({
      record: null,
      persist: async () => {
        calls.push('persist');
      },
      flushDraft: async () => {
        calls.push('flush');
      },
      deleteDraft: async () => {
        calls.push('delete');
      },
    });
    expect(outcome).toEqual({ ok: true });
    expect(calls).toEqual(['flush', 'delete']);
  });

  it('草稿清理失败不改结论：成绩已落库，不该让用户以为「没保存成功」', async () => {
    const outcome = await finalizeSession({
      record: RECORD,
      persist: async () => {},
      flushDraft: async () => {},
      deleteDraft: async () => {
        throw new Error('delete failed');
      },
    });
    expect(outcome).toEqual({ ok: true });
  });

  it('等待 persist 真正落地后才删除草稿（不等 Promise = 把失败当成功）', async () => {
    const calls: string[] = [];
    await finalizeSession({
      record: RECORD,
      persist: async () => {
        await new Promise((r) => setTimeout(r, 5));
        calls.push('persist');
      },
      flushDraft: async () => {
        calls.push('flush');
      },
      deleteDraft: async () => {
        calls.push('delete');
      },
    });
    expect(calls).toEqual(['persist', 'flush', 'delete']);
  });
});
