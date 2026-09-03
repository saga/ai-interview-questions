// npm run question:coverage —— 离线覆盖报告（慢速题库生产管线第一步，ADR-032）。
// 刻意不经过 Vite / import.meta.glob（那是浏览器打包路径）：直接 fs 读 JSON，
// 调用 src/domain/coverage.ts 纯函数。Node 24+ 原生运行 TS，无需构建步骤；
// 因此这里的相对导入必须带 .ts 扩展名。

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { KnowledgeNode } from '../src/schemas/knowledge';
import type { Question } from '../src/schemas/question';
import {
  assessmentQualityOf,
  coverageSuggestions,
  formatCoverageReport,
  questionCoverageMatrix,
  retrievalReadinessOf,
} from '../src/domain/coverage.ts';

const dataDir = fileURLToPath(new URL('../src/data/', import.meta.url));

function readJsonDir(dir: string): unknown[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .flatMap((f) => JSON.parse(readFileSync(dir + f, 'utf8')) as unknown);
}

const questions = readJsonDir(dataDir + 'questions/') as Question[];
const nodes = readJsonDir(dataDir + 'knowledge/') as KnowledgeNode[];
if (questions.length === 0 || nodes.length === 0) {
  console.error('题库或知识点数据为空：请检查 src/data/{questions,knowledge}/');
  process.exit(1);
}

const matrix = questionCoverageMatrix(questions, nodes);
console.log(
  formatCoverageReport(matrix, coverageSuggestions(matrix), {
    quality: assessmentQualityOf(questions as Question[]),
    readiness: retrievalReadinessOf(nodes as KnowledgeNode[]),
  }),
);
