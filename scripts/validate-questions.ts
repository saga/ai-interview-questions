// npm run validate:questions —— 题库数据完整性校验。
// 概念层（Question.tests / KnowledgeNode.concepts）移除后，覆盖索引回归
// topic × angle 两个维度，故本脚本改为校验这两个维度的数据质量：
//   1. topic 必须存在对应知识节点（无悬空 topic）
//   2. angle 必须存在于全局角度枚举（覆盖率统计的前提）
//   3. 选择题 answer 索引必须落在 options 范围内
// 借鉴 question-coverage.ts：fs 直读 JSON（不经 Vite / import.meta.glob），Node 原生运行 TS。

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { KnowledgeNode, Question } from '../src/types';

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
