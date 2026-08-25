#!/usr/bin/env node
// PR0 pilot: 计算 "Transformer 概念面" 在 transformer.json 题库上的覆盖率与缺口。
// 只读不写：生产题库文件不被修改；tests 数据来自 scripts/pilot/transformer-concept-tests.json。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');

const pilot = JSON.parse(
  readFileSync(join(__dirname, 'transformer-concept-tests.json'), 'utf8'),
);
const concepts = pilot.concepts;
const mapping = pilot.mapping;

// transformer.json 实际题目 id（用于校验映射完整性）
const bank = JSON.parse(
  readFileSync(join(root, 'src/data/questions/transformer.json'), 'utf8'),
);
const bankIds = new Set(bank.map((q) => q.id));

// ── 校验：映射应覆盖题库全部题目，且不应有题库外题目 ──
const mapIds = Object.keys(mapping);
const missing = [...bankIds].filter((id) => !mapping[id]);
const extra = mapIds.filter((id) => !bankIds.has(id));
if (missing.length || extra.length) {
  console.error('[校验失败]');
  if (missing.length) console.error('  题库有题但映射缺失:', missing);
  if (extra.length) console.error('  映射有题但题库缺失:', extra);
  process.exit(1);
}

// ── 聚合每个 concept 的命中 ──
const stats = new Map();
for (const c of concepts) {
  stats.set(c.id, {
    ...c,
    primary: 0,
    supporting: 0,
    touched: 0,
    questions: [],
  });
}
for (const [qid, tests] of Object.entries(mapping)) {
  for (const t of tests) {
    const s = stats.get(t.concept);
    if (!s) {
      console.error(`[校验失败] 题目 ${qid} 引用了未知 concept: ${t.concept}`);
      process.exit(1);
    }
    if (t.role === 'primary') s.primary += 1;
    else s.supporting += 1;
    s.touched += 1;
    s.questions.push(qid);
  }
}

// ── 覆盖率：加权（importance），covered = 至少被 1 题（primary 或 supporting）触达 ──
let totalW = 0;
let coveredW = 0;
for (const s of stats.values()) {
  totalW += s.importance;
  if (s.touched > 0) coveredW += s.importance;
}
const coveragePct = totalW === 0 ? 0 : (coveredW / totalW) * 100;

// ── 输出 ──
const sorted = [...stats.values()].sort((a, b) => b.importance - a.importance);
const bar = (n) => {
  const w = Math.max(0, Math.min(20, Math.round((n / 43) * 20)));
  return '█'.repeat(w) + '░'.repeat(20 - w);
};

console.log('\n=== PR0 · Transformer 概念面覆盖缺口表 ===\n');
console.log(
  '题库: src/data/questions/transformer.json  |  题目数: ' +
    bank.length +
    '  |  概念面: ' +
    concepts.length +
    '\n',
);
console.log(
  '概念'.padEnd(26) +
    'imp'.padStart(5) +
    '  状态      ' +
    '主/辅'.padStart(7) +
    '  触达题数  分布',
);
console.log('-'.repeat(90));

let uncovered = 0;
let weak = 0;
for (const s of sorted) {
  let status;
  if (s.touched === 0) {
    status = 'UNCOVERED';
    uncovered += 1;
  } else if (s.primary === 0) {
    status = 'WEAK(仅辅)';
    weak += 1;
  } else {
    status = 'covered';
  }
  const nodeTag = s.knowledgeNodeExists ? '' : ' *';
  console.log(
    s.title.slice(0, 24).padEnd(26) +
      String(s.importance).padStart(5) +
      '  ' +
      status.padEnd(11) +
      `${s.primary}/${s.supporting}`.padStart(7) +
      `     ${String(s.touched).padStart(2)}    ` +
      bar(s.touched) +
      nodeTag,
  );
}

console.log('-'.repeat(90));
console.log(`\n加权覆盖率 (本题库范围): ${coveragePct.toFixed(1)}%  (已覆盖权重 ${coveredW.toFixed(1)} / 总权重 ${totalW.toFixed(1)})`);
console.log(`未覆盖概念: ${uncovered}  弱覆盖(仅作为辅概念): ${weak}`);
console.log('\n* = 该概念在当前知识库(lm-architecture.json)中尚无独立知识节点 —— 既是题库缺口也是知识图谱缺口');
console.log('注意: kv-cache 在 transformer.json 中 0 题，但在 model-architecture.json / inference.json 中有大量题 —— 说明概念跨 topic 泄漏，topic 级视图会漏掉它。');
console.log('');
