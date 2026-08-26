// npm run generate:concept-questions [-- --node <id>] [-- --count <n>]
// PR5 生成管线前移（concepts → blueprint → question）的离线入口：
// 取某知识节点的概念面 → 用其题库题计算覆盖缺口（uncovered concept）→
// 生成「均衡」的概念蓝图清单（每个概念最多 1 张，消灭 5 题全问同一概念）。
// 蓝图 JSON 可审查「为何生成此题」（purpose + expectedConcepts + importance）。
// 仅输出蓝图，不触 LLM；若需据此出题，把蓝图交给 provider.generateQuestion（PR6 同款能力）。
//
// PR6 Curation 闭环（--from-curation）：把运行期探针晋升账本（data/curation/ledger.json）
// 翻译成概念蓝图任务——每个达到晋升阈值的概念对应一张待生产蓝图；加 --commit 标记已生成。

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CurationLedger, ConceptAttemptSignal, KnowledgeNode, Question } from '../src/types';
import { buildConceptStats, conceptFaceOf, getCoverageGaps } from '../src/domain/coverage.ts';
import { conceptBlueprintsFromGaps } from '../src/domain/blueprint.ts';
import { curationTasks, isPromoted } from '../src/domain/curation.ts';
import { loadLedger, saveLedger } from '../src/infra/curationStore.ts';

const dataDir = fileURLToPath(new URL('../src/data/', import.meta.url));

function readJsonDir(dir: string): unknown[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .flatMap((f) => JSON.parse(readFileSync(dir + f, 'utf8')) as unknown);
}

const questions = readJsonDir(dataDir + 'questions/') as Question[];
const nodes = readJsonDir(dataDir + 'knowledge/') as KnowledgeNode[];

const args = process.argv.slice(2);
function arg(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}
const nodeId = arg('node') ?? 'transformer';
const countArg = Number.parseInt(arg('count') ?? '', 10);
const count = Number.isNaN(countArg) || countArg <= 0 ? 10 : countArg;

// ── Curation 管线模式（PR6 闭环）：把探针晋升账本翻译为概念蓝图任务 ──
if (args.includes('--from-curation')) {
  const ledgerPath =
    arg('from-curation') ?? fileURLToPath(new URL('../data/curation/ledger.json', import.meta.url));
  const ledger: CurationLedger = loadLedger(ledgerPath);
  const tasks = curationTasks(ledger, nodes);
  console.log(`\n=== Curation 管线（来自探针晋升账本 ${ledgerPath}）===`);
  console.log(`账本条目: ${ledger.entries.length}  ·  待生成任务: ${tasks.length}\n`);
  if (tasks.length === 0) {
    console.log('✓ 当前没有待生成的晋升概念（或已全部 curated）。');
  } else {
    for (const t of tasks) {
      console.log(
        `• [${t.conceptId}] @ ${t.nodeId} (imp ${t.importance})  ${t.blueprint.angle}/${t.blueprint.difficulty}/${t.blueprint.format}`,
      );
      console.log(`    ${t.conceptTitle}`);
      console.log(`    目的: ${t.blueprint.purpose}`);
    }
    console.log('\n=== 蓝图 JSON（可审查 / 可交 LLM 出题）===\n');
    console.log(JSON.stringify(tasks.map((t) => t.blueprint), null, 2));
  }
  if (args.includes('--commit')) {
    const next: CurationLedger = {
      ...ledger,
      entries: ledger.entries.map((e) => (isPromoted(e) ? { ...e, status: 'curated' } : e)),
    };
    saveLedger(ledgerPath, next);
    console.log(`\n✓ 已标记 ${tasks.length} 个晋升概念为 curated（账本: ${ledgerPath}）。`);
  } else {
    console.log('\n（试运行：加 --commit 可将这些概念标记为已生成，避免重复生产）');
  }
  process.exit(0);
}

const node = nodes.find((n) => n.id === nodeId);
if (!node) {
  console.error(`未找到知识节点 ${nodeId}（可选 --node 指定，默认 transformer）`);
  process.exit(1);
}

const face = conceptFaceOf(node);
if (face.length === 0) {
  console.error(`节点 ${nodeId} 尚未挂 concepts[] 概念面，无法生成概念蓝图。`);
  process.exit(1);
}

// 概念覆盖缺口：把该节点题库题的 tests 当作"已尝试"信号，找从未被任何题触达的概念
const nodeQuestions = questions.filter((q) => q.topic === nodeId);
const signals: ConceptAttemptSignal[] = nodeQuestions.flatMap((q) =>
  (q.tests ?? []).map((t) => ({ concept: t.concept, score: 1 })),
);
const stats = buildConceptStats(signals);
const gaps = getCoverageGaps(face, stats);

const blueprints = conceptBlueprintsFromGaps(face, gaps, nodes, { count });

console.log(`\n=== PR5 · 概念蓝图（节点 ${nodeId}）===`);
console.log(`概念面: ${face.length}  ·  题库题(本节点): ${nodeQuestions.length}  ·  未覆盖概念: ${gaps.length}  ·  计划蓝图: ${blueprints.length}\n`);

if (blueprints.length === 0) {
  console.log('✓ 该节点概念面已被题库完全覆盖，无需生成新题。');
} else {
  for (const { blueprint, concept } of blueprints) {
    console.log(`• [${concept.id}] (imp ${concept.importance})  ${blueprint.angle}/${blueprint.difficulty}/${blueprint.format}`);
    console.log(`    目的: ${blueprint.purpose}`);
    console.log(`    探测概念: ${blueprint.expectedConcepts.join(' > ')}`);
  }
}

console.log('\n=== 蓝图 JSON（可审查 / 可交 LLM 出题）===\n');
console.log(JSON.stringify(blueprints.map((b) => b.blueprint), null, 2));
