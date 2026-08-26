// Curation 管线（PR6 闭环）纯逻辑测试：探针累计、晋升阈值、任务生成、去重。

import { describe, expect, it } from 'vitest';
import type { KnowledgeNode } from '../types';
import {
  curationTasks,
  emptyLedger,
  isPromoted,
  markCurated,
  promotedEntries,
  recordProbe,
  type CurationLedger,
} from './curation';
import { PROBE_PROMOTION_THRESHOLD } from './probe';

const node: KnowledgeNode = {
  id: 'rag',
  name: 'RAG',
  area: 'rag',
  topic: 'retrieval',
  priority: 'P0',
  summary: '...',
  required: [],
  misconceptions: [],
  angles: ['definition', 'scenario'],
  concepts: [{ id: 'rag-index', title: 'RAG 索引', importance: 0.7 }],
};

describe('recordProbe', () => {
  it('首次探测创建 pending 条目并计数 1', () => {
    const l = recordProbe(emptyLedger(), 'rag-index', 'rag', 1000);
    expect(l.entries).toHaveLength(1);
    expect(l.entries[0]).toMatchObject({ conceptId: 'rag-index', nodeId: 'rag', count: 1, status: 'pending' });
  });

  it('同一 (conceptId, nodeId) 累加计数，且不修改入参', () => {
    const l0 = emptyLedger();
    const l1 = recordProbe(l0, 'rag-index', 'rag', 1000);
    const l2 = recordProbe(l1, 'rag-index', 'rag', 2000);
    expect(l0.entries).toHaveLength(0); // 入参不变
    expect(l2.entries[0].count).toBe(2);
    expect(l2.entries[0].firstSeen).toBe(1000);
    expect(l2.entries[0].lastSeen).toBe(2000);
  });

  it('不同概念/节点分开计数', () => {
    let l = recordProbe(emptyLedger(), 'rag-index', 'rag', 1);
    l = recordProbe(l, 'rag-other', 'rag', 2);
    expect(l.entries).toHaveLength(2);
  });
});

describe('isPromoted / promotedEntries', () => {
  it(`计数 ≥ 阈值(${PROBE_PROMOTION_THRESHOLD}) 且 status=pending 才晋升`, () => {
    let l: CurationLedger = emptyLedger();
    for (let i = 0; i < PROBE_PROMOTION_THRESHOLD - 1; i++) l = recordProbe(l, 'rag-index', 'rag', i);
    expect(isPromoted(l.entries[0])).toBe(false);
    l = recordProbe(l, 'rag-index', 'rag', 99);
    expect(isPromoted(l.entries[0])).toBe(true);
    expect(promotedEntries(l)).toHaveLength(1);
  });

  it('已达到阈值的条目被 markCurated 后不再晋升', () => {
    let l: CurationLedger = emptyLedger();
    for (let i = 0; i < PROBE_PROMOTION_THRESHOLD; i++) l = recordProbe(l, 'rag-index', 'rag', i);
    expect(isPromoted(l.entries[0])).toBe(true);
    const curated = markCurated(l, 'rag-index', 'rag');
    expect(isPromoted(curated.entries[0])).toBe(false);
    expect(promotedEntries(curated)).toHaveLength(0);
  });
});

describe('curationTasks', () => {
  it('把每个晋升概念翻译为一张概念蓝图任务（含可直接交 LLM 出的蓝图）', () => {
    let l: CurationLedger = emptyLedger();
    for (let i = 0; i < PROBE_PROMOTION_THRESHOLD; i++) l = recordProbe(l, 'rag-index', 'rag', i);
    const tasks = curationTasks(l, [node]);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ conceptId: 'rag-index', nodeId: 'rag', nodeTitle: 'RAG', conceptTitle: 'RAG 索引' });
    expect(tasks[0].blueprint.topic).toBe('rag');
    expect(tasks[0].blueprint.expectedConcepts[0]).toBe('rag-index');
    expect(tasks[0].blueprint.format).toBe('choice');
  });

  it('无节点归属的 orphan 概念自动跳过（不产生僵尸任务）', () => {
    let l: CurationLedger = emptyLedger();
    for (let i = 0; i < PROBE_PROMOTION_THRESHOLD; i++) l = recordProbe(l, 'orphan', 'ghost', i);
    const tasks = curationTasks(l, [node]);
    expect(tasks).toHaveLength(0);
  });

  it('未达阈值的 pending 概念不产生任务', () => {
    const l = recordProbe(emptyLedger(), 'rag-index', 'rag', 1);
    expect(curationTasks(l, [node])).toHaveLength(0);
  });
});
