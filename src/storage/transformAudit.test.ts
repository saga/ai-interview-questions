// 题型变换审计日志测试：append-only、上限裁剪、损坏存储兜底（localStorage mock，参照 settings.test.ts）。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appendTransformRecord, loadTransformRecords, MAX_RECORDS } from './transformAudit';
import type { TransformAuditRecord } from '../types';

let store: Record<string, string>;

beforeEach(() => {
  store = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
  });
});

const rec = (questionId: string, ok = true): Omit<TransformAuditRecord, 'at'> => ({
  questionId,
  topic: 'memory',
  from: 'essay',
  target: 'single',
  result: ok ? 'single' : 'essay',
  provider: 'mock',
  ok,
  ...(ok ? {} : { error: 'LLM 输出缺少有效题干' }),
});

describe('appendTransformRecord / loadTransformRecords', () => {
  it('追加后可读回，at 由模块盖时间戳', () => {
    appendTransformRecord(rec('q-1'));
    const all = loadTransformRecords();
    expect(all).toHaveLength(1);
    expect(all[0].questionId).toBe('q-1');
    expect(all[0].at).toBeGreaterThan(0);
  });

  it('多条记录时间正序（新在后）', () => {
    appendTransformRecord(rec('q-1'));
    appendTransformRecord(rec('q-2'));
    expect(loadTransformRecords().map((r) => r.questionId)).toEqual(['q-1', 'q-2']);
  });

  it('超过上限时裁剪保留最近 MAX_RECORDS 条', () => {
    for (let i = 0; i < MAX_RECORDS + 5; i++) appendTransformRecord(rec(`q-${i}`));
    const all = loadTransformRecords();
    expect(all).toHaveLength(MAX_RECORDS);
    expect(all[0].questionId).toBe('q-5');
    expect(all[MAX_RECORDS - 1].questionId).toBe(`q-${MAX_RECORDS + 4}`);
  });

  it('失败记录带 error 摘要', () => {
    appendTransformRecord(rec('q-1', false));
    const r = loadTransformRecords()[0];
    expect(r.ok).toBe(false);
    expect(r.error).toContain('题干');
  });

  it('存储内容损坏（非 JSON/非数组/含垃圾项）时容错读取', () => {
    store['ai-interview-trainer.transform-audit'] = '{not json';
    expect(loadTransformRecords()).toEqual([]);
    store['ai-interview-trainer.transform-audit'] = JSON.stringify(['junk', null, { questionId: 'x' }]);
    expect(loadTransformRecords()).toEqual([]);
  });

  it('localStorage 不可用时静默降级为 no-op', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(() => appendTransformRecord(rec('q-1'))).not.toThrow();
    expect(loadTransformRecords()).toEqual([]);
  });
});
