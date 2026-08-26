// Curation 账本的文件持久化（仅 Node 环境：CLI / 测试 / 服务端）。
// 浏览器 SPA 不应 import 本文件（node:fs 不可用）；SPA 应自备 sink（如 IndexedDB）
// 把 ProbePromotionEvent 落地，再通过上述 CLI 同步到本账本。
// 引擎层只依赖 domain/curation 的纯函数 + 调用方传入的 sink 回调，保持浏览器构建无 node 依赖。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ProbePromotionEvent } from '../types';
import { emptyLedger, markCurated, recordProbe, type CurationLedger } from '../domain/curation.ts';

/** 默认账本路径（相对 cwd）。generate:concept-questions --from-curation 也默认读这里。 */
export const DEFAULT_LEDGER_PATH = 'data/curation/ledger.json';

/** 读取账本；文件不存在或损坏时回退到空账本（不抛错，避免卡死管线）。 */
export function loadLedger(path: string): CurationLedger {
  if (!existsSync(path)) return emptyLedger();
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    if (raw && raw.version === 1 && Array.isArray(raw.entries)) return raw as CurationLedger;
  } catch {
    // 损坏账本 → 重新开始
  }
  return emptyLedger();
}

export function saveLedger(path: string, ledger: CurationLedger): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(ledger, null, 2), 'utf8');
}

/** 记录一次探针探测（跨会话累计）；返回更新后的账本。 */
export function appendProbe(path: string, conceptId: string, nodeId: string, now: number = Date.now()): CurationLedger {
  const next = recordProbe(loadLedger(path), conceptId, nodeId, now);
  saveLedger(path, next);
  return next;
}

/** 标记某概念已生成正式题（关闭 curation 任务）。 */
export function commitCurated(path: string, conceptId: string, nodeId: string): CurationLedger {
  const next = markCurated(loadLedger(path), conceptId, nodeId);
  saveLedger(path, next);
  return next;
}

/**
 * 供引擎 nextAdaptiveStep 使用的同步 sink：把探针事件追加进文件账本。
 * 每次探针（无论是否该步晋升）都记录，使计数跨会话累计到晋升阈值。
 */
export function ledgerSink(path: string): (e: ProbePromotionEvent) => void {
  return (e: ProbePromotionEvent) => {
    try {
      appendProbe(path, e.conceptId, e.nodeId);
    } catch (err) {
      console.warn('[curation] 记录探针事件失败：', err);
    }
  };
}
