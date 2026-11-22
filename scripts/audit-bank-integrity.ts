// npm run question:integrity —— 题库「结构性完整性」只读审计（默认恒 exit 0）。
//
// 与现有脚本的分工：
//   - validate:questions  数据契约：schema、answer 越界、题干/选项重复、angle 合法性；
//   - lint:bias / lint:length  选项长度泄题（新题硬门禁）；
//   - question:quality  内容语义嫌疑信号（精确率低，只排复核顺序）；
//   - 本脚本 补上前面三者都没覆盖的**结构性**问题：悬空 knowledgeId、答案位置分布、
//     全选项正确、溯源元数据缺口、知识节点支撑度。
//
// 默认只读报告，不阻断流程（历史题库有存量债，见下方 --strict 说明）。
// --strict：出现结构性错误（悬空引用 / 全选项正确 / 答案位置严重倾斜）时 exit 1。
// --json：机器可读输出。

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Question } from '../src/schemas/question.ts';
import type { KnowledgeNode } from '../src/schemas/knowledge.ts';

const dataDir = fileURLToPath(new URL('../src/data/', import.meta.url));
const strict = process.argv.includes('--strict');
const asJson = process.argv.includes('--json');

interface LocatedQuestion { file: string; q: Question }
const readQuestions = (): LocatedQuestion[] =>
  readdirSync(`${dataDir}questions/`)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .flatMap((f) =>
      (JSON.parse(readFileSync(`${dataDir}questions/${f}`, 'utf8')) as Question[]).map((q) => ({ file: f, q })),
    );

const nodes = readdirSync(`${dataDir}knowledge/`)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .flatMap((f) => JSON.parse(readFileSync(`${dataDir}knowledge/${f}`, 'utf8')) as KnowledgeNode[]);

const questions = readQuestions();
const nodeIds = new Set(nodes.map((n) => n.id));

interface Finding { id: string; file?: string; detail: string }
const hard: Finding[] = [];

// 1. 悬空引用：validate 只查 topic，knowledgeId 是可选字段，容易被忽略。
for (const { file, q } of questions) {
  if (!nodeIds.has(q.topic)) hard.push({ id: q.id, file, detail: `topic=${q.topic} 不是知识节点` });
  if (q.knowledgeId && !nodeIds.has(q.knowledgeId)) {
    hard.push({ id: q.id, file, detail: `knowledgeId=${q.knowledgeId} 不是知识节点` });
  }
}

// 2. 全选项正确：多选把所有选项都标对，考生不选也能满分，零区分度。
for (const { file, q } of questions) {
  const cf = q.formats?.choice;
  if (cf?.type === 'multiple' && cf.answer.length === cf.options.length) {
    hard.push({ id: q.id, file, detail: `全部 ${cf.options.length} 个选项均为正确答案` });
  }
}

// 3. 答案位置分布：生成脚本若总把正确项写在第一位，不读题也能高分。
const single = questions.filter(({ q }) => q.formats?.choice?.type === 'single');
const positionCounts = new Map<number, number>();
for (const { q } of single) {
  const i = q.formats?.choice?.answer[0] ?? -1;
  positionCounts.set(i, (positionCounts.get(i) ?? 0) + 1);
}
const maxShare = single.length ? Math.max(...positionCounts.values()) / single.length : 0;
if (single.length >= 20 && maxShare > 0.4) {
  hard.push({
    id: '(bank)',
    detail: `单选题答案位置倾斜：${[...positionCounts.entries()].sort((a, b) => a[0] - b[0]).map(([i, n]) => `${String.fromCharCode(65 + i)}=${n}`).join(' / ')}，最高占比 ${(maxShare * 100).toFixed(1)}%`,
  });
}
const byFile = new Map<string, { total: number; top: number; count: number }>();
const filePositionCache = new Map<string, Map<number, number>>();
function positionCountsByFile(file: string): Map<number, number> {
  let m = filePositionCache.get(file);
  if (!m) { m = new Map(); filePositionCache.set(file, m); }
  return m;
}
for (const { file, q } of single) {
  const row = byFile.get(file) ?? { total: 0, top: -1, count: 0 };
  row.total++;
  const i = q.formats?.choice?.answer[0] ?? -1;
  const c = (positionCountsByFile(file).get(i) ?? 0) + 1;
  positionCountsByFile(file).set(i, c);
  if (c > row.count) { row.count = c; row.top = i; }
  byFile.set(file, row);
}
const skewedFiles = [...byFile.entries()]
  .filter(([, r]) => r.total >= 10 && r.count / r.total > 0.7)
  .map(([file, r]) => ({ file, detail: `${r.total} 道单选里 ${r.count} 道答案为 ${String.fromCharCode(65 + r.top)}` }));
for (const f of skewedFiles) hard.push({ id: f.file, file: f.file, detail: f.detail });

// 3b. 「正确答案：<单词>」前缀：bank.test 的正则会抓到单词首字母当答案字母，
//     若该字母恰好等于正确项，错格式能蒙混过关；答案位置一变就暴露。
for (const { file, q } of questions) {
  const open = q.formats?.open?.referenceAnswer ?? '';
  if (/正确答案[：:\s]*[A-F][A-Za-z]/.test(open)) {
    hard.push({ id: q.id, file, detail: 'open 参考答案以「正确答案：<英文单词>」开头，会被答案字母正则误读' });
  }
}

// 4. 溯源与元数据（软信号：历史题无强制 materialId，见 AGENTS.md 用户数据契约例外）。
const sourceMissing = questions.filter(({ q }) => !q.source?.materialId);
const urlMaterialIds = questions.filter(({ q }) => /^https?:\/\//.test(q.source?.materialId ?? ''));
const noMisconceptions = questions.filter(({ q }) => !(q.misconceptions ?? []).length);
const noMisconceptionMap = questions.filter(({ q }) => !q.formats?.choice?.misconceptionMap?.length);

// 5. 选项长度泄题（与 lint:length 同口径，但全库可见；新题门禁仍以 lint:length 为准）。
const lengthHits = questions.filter(({ q }) => {
  const o = q.formats?.choice?.options ?? [];
  if (o.length < 2) return false;
  const lens = o.map((x) => String(x).trim().length);
  return Math.max(...lens) / Math.max(1, Math.min(...lens)) > 1.8;
});

// 6. 知识节点支撑度。
const support = new Map<string, number>();
for (const { q } of questions) support.set(q.topic, (support.get(q.topic) ?? 0) + 1);
const thinNodes = nodes.filter((n) => (support.get(n.id) ?? 0) === 1);
const topNodes = [...support.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

const report = {
  totals: { questions: questions.length, knowledgeNodes: nodes.length, singleChoice: single.length },
  hard,
  skewedFiles,
  soft: {
    answerPosition: [...positionCounts.entries()].sort((a, b) => a[0] - b[0]).map(([i, n]) => `${String.fromCharCode(65 + i)}=${n}`),
    sourceMissing: sourceMissing.length,
    urlMaterialIds: urlMaterialIds.length,
    noMisconceptions: noMisconceptions.length,
    noMisconceptionMap: noMisconceptionMap.length,
    optionLengthRatioHits: lengthHits.length,
    thinNodes: thinNodes.map((n) => n.id),
    topNodes,
  },
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`题库 ${questions.length} 题 / ${nodes.length} 知识节点 / ${single.length} 单选`);
  const structural = hard.filter(
    (h) => h.id !== '(bank)' && !skewedFiles.some((s) => s.file === h.file && s.detail === h.detail),
  );
  console.log(`\n[硬信号] 悬空引用 / 全选项正确 / 答案前缀误读：${structural.length}`);
  for (const h of hard.slice(0, 20)) console.warn(`  ✗ ${h.file ?? '(bank)'} ${h.id}: ${h.detail}`);
  console.log(`\n[硬信号] 答案位置倾斜：全局最高 ${(maxShare * 100).toFixed(1)}%，单文件异常 ${skewedFiles.length} 个`);
  for (const f of skewedFiles.slice(0, 12)) console.warn(`  ✗ ${f.file}: ${f.detail}`);
  console.log(`\n[软信号] 无 materialId ${sourceMissing.length} · URL 型 materialId ${urlMaterialIds.length} · 无 misconceptions ${noMisconceptions.length} · 无 misconceptionMap ${noMisconceptionMap.length} · 选项长度比 >1.8 ${lengthHits.length} 题`);
  console.log(`[软信号] 仅 1 题支撑的节点 ${thinNodes.length} 个；题量最高节点 ${topNodes.map(([id, n]) => `${id}(${n})`).join('、')}`);
}

if (strict && hard.length) {
  console.error(`\n✗ question:integrity --strict 失败：${hard.length} 项结构性错误`);
  process.exit(1);
}
