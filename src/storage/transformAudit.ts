// 题型变换审计日志：append-only 记录每次变换的成败与形态映射（ADR-024）。
// 用途：质量审核（LLM 标注的正确项是否靠谱）与成功率统计。
// localStorage 环境不可用（SSR / 测试 / 隐私模式异常）时静默降级为 no-op。

import type { TransformAuditRecord } from '../types';

const KEY = 'ai-interview-trainer.transform-audit';
const MAX_RECORDS = 300;

/** 逐字段清洗历史记录；结构不合法返回 null（丢弃）。 */
function sanitize(raw: unknown): TransformAuditRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (
    typeof o.questionId !== 'string' ||
    typeof o.from !== 'string' ||
    typeof o.target !== 'string' ||
    typeof o.result !== 'string' ||
    typeof o.provider !== 'string' ||
    typeof o.ok !== 'boolean'
  ) {
    return null;
  }
  return {
    questionId: o.questionId,
    topic: typeof o.topic === 'string' ? o.topic : '',
    from: o.from as TransformAuditRecord['from'],
    target: o.target as TransformAuditRecord['target'],
    result: o.result as TransformAuditRecord['result'],
    provider: o.provider,
    ok: o.ok,
    error: typeof o.error === 'string' ? o.error : undefined,
    at: typeof o.at === 'number' ? o.at : 0,
  };
}

/** 读取全部审计记录（时间正序，新在后）；存储缺失/损坏时返回空数组。 */
export function loadTransformRecords(): TransformAuditRecord[] {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitize).filter((r): r is TransformAuditRecord => r !== null);
  } catch {
    return [];
  }
}

/** 追加一条记录并裁剪到上限（保留最近 MAX_RECORDS 条）。 */
export function appendTransformRecord(rec: Omit<TransformAuditRecord, 'at'>): void {
  try {
    const records = [...loadTransformRecords(), { ...rec, at: Date.now() }].slice(-MAX_RECORDS);
    globalThis.localStorage?.setItem(KEY, JSON.stringify(records));
  } catch {
    /* 存储不可用时静默跳过——审计日志不允许影响主流程 */
  }
}
