// npm run question:blueprint —— 把覆盖缺口格输出为题目蓝图（ADR-032 慢速生产管线
// 的 ③ 步）：每条蓝图附同主题变体候选 id，供"复用 > 变体 > 生成"决策与后续受约束
// 生成使用。用法：npm run question:blueprint [-- limit]（默认 10，P0 优先序同 coverage）。
// 与 question-coverage 相同：fs 直读 JSON，不走 Vite 打包路径；相对导入带 .ts 扩展名。

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { KnowledgeNode } from '../src/schemas/knowledge';
import type { Question } from '../src/schemas/question';
import { coverageSuggestions, questionCoverageMatrix } from '../src/domain/coverage.ts';
import { blueprintFromSuggestion, variantCandidates } from '../src/domain/blueprint.ts';

const dataDir = fileURLToPath(new URL('../src/data/', import.meta.url));

function readJsonDir(dir: string): unknown[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .flatMap((f) => JSON.parse(readFileSync(dir + f, 'utf8')) as unknown);
}

const questions = readJsonDir(dataDir + 'questions/') as Question[];
const nodes = readJsonDir(dataDir + 'knowledge/') as KnowledgeNode[];

const limitArg = process.argv[2];
const limit = Number.parseInt(limitArg ?? '', 10);
if (Number.isNaN(limit) || limit <= 0) {
  console.error('用法：npm run question:blueprint -- <limit>（如 10）');
  process.exit(1);
}

const matrix = questionCoverageMatrix(questions, nodes);
const blueprints = coverageSuggestions(matrix)
  .slice(0, limit)
  .map((s) => {
    const bp = blueprintFromSuggestion(s, nodes);
    if (!bp) return null; // 理论不可达：建议只来自知识节点
    // 字段名刻意不用 variantCandidateIds：变体（ADR-069）继承 canonical 的 topic × angle，
    // 用它补覆盖缺口等于把 A 格的题搬到 B 格，A 格重新空出来，覆盖率永远补不满。
    // 这里是「以已有题为蓝本 fork 新 canonical」的候选（derive，新 ID + derivedFrom），是 reuse，不是 variant。
    // 禁止原地改写候选题的 angle/difficulty 后沿用原 ID（evidence 污染，见 questionIdentity.ts）。
    return { ...bp, priority: s.priority, reuseCandidateIds: variantCandidates(questions, bp).map((q) => q.id) };
  })
  .filter((x) => x !== null);

console.log(JSON.stringify(blueprints, null, 2));
