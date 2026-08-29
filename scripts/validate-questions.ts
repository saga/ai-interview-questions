// npm run validate:questions —— 题库数据完整性校验。
// 概念层（Question.tests / KnowledgeNode.concepts）移除后，覆盖索引回归
// topic × angle 两个维度，故本脚本改为校验这两个维度的数据质量：
//   1. topic 必须存在对应知识节点（无悬空 topic）
//   2. angle 必须存在于全局角度枚举（覆盖率统计的前提）
//   3. 选择题 answer 索引必须落在 options 范围内
// 借鉴 question-coverage.ts：fs 直读 JSON（不经 Vite / import.meta.glob），Node 原生运行 TS。

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { KnowledgeNode } from '../src/schemas/knowledge';
import type { Question } from '../src/schemas/question';

const dataDir = fileURLToPath(new URL('../src/data/', import.meta.url));

function readJsonDir(dir: string): unknown[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .flatMap((f) => JSON.parse(readFileSync(dir + f, 'utf8')) as unknown[]);
}

const questions = readJsonDir(dataDir + 'questions/') as Question[];
const nodes = readJsonDir(dataDir + 'knowledge/') as KnowledgeNode[];
const nodeIds = new Set(nodes.map((n) => n.id));

const VALID_ANGLES = new Set([
  'definition',
  'fundamental',
  'mechanism',
  'calculation',
  'comparison',
  'tradeoff',
  'scenario',
  'debugging',
  'design',
  'system-design',
]);

let errors = 0;
let withAngle = 0;
// 题型分布仅作可见性输出（AGENTS.md §4.2）：硬门禁在 question:add 上，只约束新导入批次，
// 不在这里拦全库——历史单选占比高是存量问题，卡住校验会让它永远红。
let singleCount = 0;
let multipleCount = 0;
for (const q of questions) {
  if (!nodeIds.has(q.topic)) {
    console.error(`✗ ${q.id}: topic "${q.topic}" 无对应知识节点`);
    errors++;
  }
  if (!q.angle) {
    console.error(`✗ ${q.id}: 缺少 angle（覆盖索引依赖它）`);
    errors++;
  } else if (!VALID_ANGLES.has(q.angle)) {
    console.error(`✗ ${q.id}: angle "${q.angle}" 不在合法角度枚举内`);
    errors++;
  } else {
    withAngle++;
  }
  const choice = q.formats?.choice;
  if (choice) {
    if (choice.type === 'single') singleCount++;
    else if (choice.type === 'multiple') multipleCount++;
    if (new Set(choice.answer).size !== choice.answer.length) {
      console.error(`✗ ${q.id}: 选择题 answer 索引重复`);
      errors++;
    }
    if (choice.type === 'single' && choice.answer.length !== 1) {
      console.error(`✗ ${q.id}: single 题必须恰好有一个正确答案`);
      errors++;
    }
    if (choice.type === 'multiple' && choice.answer.length < 2) {
      console.error(`✗ ${q.id}: multiple 题至少需要两个正确答案`);
      errors++;
    }
    const max = choice.options.length - 1;
    for (const i of choice.answer) {
      if (i < 0 || i > max) {
        console.error(`✗ ${q.id}: 选择题 answer 索引 ${i} 越界（options 共 ${choice.options.length} 项）`);
        errors++;
      }
    }
  }
}

if (errors > 0) {
  console.error(`\n校验失败：${errors} 处问题`);
  process.exit(1);
}
console.log(
  `✓ 校验通过：${questions.length} 题 / ${nodes.length} 知识节点 · 带 angle ${withAngle} 题（${((withAngle / questions.length) * 100).toFixed(1)}%）`,
);
const choiceTotal = singleCount + multipleCount;
if (choiceTotal) {
  const multiRatio = (multipleCount / choiceTotal) * 100;
  console.log(
    `  题型分布：单选 ${singleCount} · 多选 ${multipleCount}（多选占比 ${multiRatio.toFixed(1)}%，目标 ≥ 66.7%）` +
      (multiRatio < 66.7 ? ' ← 偏低，新题请以多选为主' : ''),
  );
}
