// Curation 账本文件持久化（仅 Node）测试：读写回合、跨调用累计、sink 接线。

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appendProbe,
  commitCurated,
  DEFAULT_LEDGER_PATH,
  ledgerSink,
  loadLedger,
  saveLedger,
} from './curationStore';
import { emptyLedger } from '../domain/curation';
import { PROBE_PROMOTION_THRESHOLD } from '../domain/probe';

let dir: string;
let ledgerPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'curation-test-'));
  ledgerPath = join(dir, 'ledger.json');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('loadLedger', () => {
  it('文件不存在 → 返回空账本（不抛错）', () => {
    expect(loadLedger(ledgerPath)).toEqual(emptyLedger());
  });

  it('损坏的 JSON → 回退空账本', () => {
    saveLedger(ledgerPath, '{ not json' as unknown as ReturnType<typeof emptyLedger>);
    expect(loadLedger(ledgerPath)).toEqual(emptyLedger());
  });

  it('读取-写回回合一致', () => {
    let l = appendProbe(ledgerPath, 'rag-index', 'rag', 1);
    for (let i = 1; i < PROBE_PROMOTION_THRESHOLD; i++) l = appendProbe(ledgerPath, 'rag-index', 'rag', i);
    const reloaded = loadLedger(ledgerPath);
    expect(reloaded.entries[0]).toMatchObject({ conceptId: 'rag-index', nodeId: 'rag', count: PROBE_PROMOTION_THRESHOLD });
  });
});

describe('appendProbe', () => {
  it('跨调用累计同一概念计数', () => {
    appendProbe(ledgerPath, 'rag-index', 'rag', 1);
    appendProbe(ledgerPath, 'rag-index', 'rag', 2);
    const l = loadLedger(ledgerPath);
    expect(l.entries).toHaveLength(1);
    expect(l.entries[0].count).toBe(2);
  });
});

describe('commitCurated', () => {
  it('标记概念为 curated 并落盘', () => {
    appendProbe(ledgerPath, 'rag-index', 'rag', 1);
    commitCurated(ledgerPath, 'rag-index', 'rag');
    const l = loadLedger(ledgerPath);
    expect(l.entries[0].status).toBe('curated');
  });
});

describe('ledgerSink', () => {
  it('把探针晋升事件写入文件账本', () => {
    const sink = ledgerSink(ledgerPath);
    sink({ conceptId: 'rag-index', nodeId: 'rag', promoted: false });
    sink({ conceptId: 'rag-index', nodeId: 'rag', promoted: false });
    const l = loadLedger(ledgerPath);
    expect(l.entries[0].count).toBe(2);
  });
});

describe('DEFAULT_LEDGER_PATH', () => {
  it('指向 data/curation/ledger.json（相对 cwd）', () => {
    expect(DEFAULT_LEDGER_PATH).toBe('data/curation/ledger.json');
  });
});
