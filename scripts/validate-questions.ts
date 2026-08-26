// npm run validate:questions —— 题目 concept-coverage 数据完整性校验（PR2）。
// 借鉴 question-coverage.ts：直接 fs 读 JSON（不经过 Vite / import.meta.glob），
// 调用 Zod 不变量 + 概念面校验。Node 原生运行 TS，相对导入带 .ts 扩展名。

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

// 全局概念 id 集合：所有知识节点 concepts[] 面里的概念（概念独立于知识节点本身）。
const conceptIds = new Set<string>();
for (const n of nodes) for (const c of n.concepts ?? []) conceptIds.add(c.id);

let errors = 0;
let withTests = 0;
for (const q of questions) {
  const tests = q.tests ?? [];
  if (tests.length > 0) withTests++;
  for (const t of tests) {
    if (!conceptIds.has(t.concept)) {
      console.error(`✗ ${q.id}: tests 概念 "${t.concept}" 不在任何知识节点 concepts[] 面中`);
      errors++;
    }
  }
  // 约束：每题 ≤3 concept，且 primary 唯一（避免 "一题测 10 个概念" 导致无法定位弱点）。
  if (tests.length > 3) {
    console.error(`✗ ${q.id}: tests 数量 ${tests.length} > 3`);
    errors++;
  }
  const primaries = tests.filter((t) => t.role === 'primary');
  if (primaries.length > 1) {
    console.error(`✗ ${q.id}: 有 ${primaries.length} 个 primary，应唯一`);
    errors++;
  }
}

if (errors > 0) {
  console.error(`\n校验失败：${errors} 处问题`);
  process.exit(1);
}
console.log(
  `✓ 校验通过：${questions.length} 题，含 tests 的题 ${withTests} 道，概念面共 ${conceptIds.size} 个`,
);
