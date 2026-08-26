// Curation 管线（PR6 闭环）：把运行期「探针晋升」信号接进正式题生产。
// 纯逻辑、不触 LLM / 文件 IO / React —— 浏览器与 CLI 共用；文件持久化见 src/infra/curationStore.ts。
//
// 数据流：引擎 nextAdaptiveStep 每生成一道临时探针题 → 发出 ProbePromotionEvent
//   → 调用方写入 CurationLedger（跨会话累计计数，达到阈值即晋升）
//   → scripts/generate:concept-questions --from-curation 把晋升概念翻译成概念蓝图
//     （与 PR5 同款能力，可交 LLM 据此生产正式题）→ --commit 关闭该概念，避免重复生产。

import type { KnowledgeNode, QuestionBlueprint } from '../types';
import { blueprintFromConcept } from './blueprint.ts';
import { PROBE_PROMOTION_THRESHOLD } from './probe.ts';

export type CurationStatus = 'pending' | 'curated';

/** 单个概念在 curation 账本中的累计记录（跨会话）。 */
export interface CurationEntry {
  conceptId: string;
  nodeId: string;
  /** 被探针探测的累计次数（跨会话累加）。 */
  count: number;
  firstSeen: number;
  lastSeen: number;
  status: CurationStatus;
}

/** Curation 账本：晋升信号的可持久化载体（JSON 文件，data/curation/ledger.json）。 */
export interface CurationLedger {
  version: 1;
  entries: CurationEntry[];
}

/** 一个晋升概念对应的「待生产任务」：含可直接交 LLM 出的概念蓝图。 */
export interface CurationTask {
  conceptId: string;
  nodeId: string;
  nodeTitle: string;
  conceptTitle: string;
  importance: number;
  blueprint: QuestionBlueprint;
}

export function emptyLedger(): CurationLedger {
  return { version: 1, entries: [] };
}

/** 记录一次探针探测：同 (conceptId, nodeId) 累加计数；返回新账本（不修改入参）。 */
export function recordProbe(
  ledger: CurationLedger,
  conceptId: string,
  nodeId: string,
  now: number = Date.now(),
): CurationLedger {
  const entries = ledger.entries.map((e) => ({ ...e }));
  const i = entries.findIndex((e) => e.conceptId === conceptId && e.nodeId === nodeId);
  if (i >= 0) {
    entries[i] = { ...entries[i], count: entries[i].count + 1, lastSeen: now };
  } else {
    entries.push({ conceptId, nodeId, count: 1, firstSeen: now, lastSeen: now, status: 'pending' });
  }
  return { version: 1, entries };
}

/** 某条目是否已达晋升阈值（pending 且计数 ≥ 阈值）。 */
export function isPromoted(entry: CurationEntry, threshold = PROBE_PROMOTION_THRESHOLD): boolean {
  return entry.status === 'pending' && entry.count >= threshold;
}

export function promotedEntries(ledger: CurationLedger, threshold = PROBE_PROMOTION_THRESHOLD): CurationEntry[] {
  return ledger.entries.filter((e) => isPromoted(e, threshold));
}

/** 标记某概念已生成正式题（关闭该 curation 任务，避免重复生产）。 */
export function markCurated(ledger: CurationLedger, conceptId: string, nodeId: string): CurationLedger {
  return {
    version: 1,
    entries: ledger.entries.map((e) =>
      e.conceptId === conceptId && e.nodeId === nodeId ? { ...e, status: 'curated' } : e,
    ),
  };
}

/**
 * 把晋升账本翻译成「待生产任务」清单：每个 pending 且达阈值的概念 → 一张概念蓝图
 * （以概念为主、≤3 概念，与 PR5 生成管线同款）。无节点归属 / 无概念定义的 orphan 概念自动跳过。
 */
export function curationTasks(
  ledger: CurationLedger,
  nodes: KnowledgeNode[],
  threshold = PROBE_PROMOTION_THRESHOLD,
): CurationTask[] {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const tasks: CurationTask[] = [];
  for (const e of promotedEntries(ledger, threshold)) {
    const node = nodeById.get(e.nodeId);
    const concept = node?.concepts?.find((c) => c.id === e.conceptId);
    if (node && concept) {
      tasks.push({
        conceptId: e.conceptId,
        nodeId: e.nodeId,
        nodeTitle: node.name,
        conceptTitle: concept.title,
        importance: concept.importance,
        // 探针晋升概念优先用易定义题建立认知（与 buildProbeBlueprint 一致的考察起点）
        blueprint: blueprintFromConcept(concept, node, { angle: 'definition', difficulty: 'easy', format: 'choice' }),
      });
    }
  }
  return tasks;
}
