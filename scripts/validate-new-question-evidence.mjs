#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const baseIndex = args.indexOf('--since');
const base = baseIndex >= 0 ? args[baseIndex + 1] : undefined;
if (!base) {
  console.error('必须提供 --since <base-commit>。');
  process.exit(2);
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}
function parse(raw, path) {
  const value = JSON.parse(raw);
  if (!Array.isArray(value)) throw new Error(`${path}: 题库文件必须是 JSON 数组`);
  return value;
}
function previousQuestions(path) {
  try {
    return parse(execFileSync('git', ['show', `${base}:${path}`], { encoding: 'utf8' }), path);
  } catch {
    return [];
  }
}
const changedFiles = execFileSync('git', [
  'diff', '--name-only', '--diff-filter=ACMR', `${base}...HEAD`, '--', 'src/data/questions',
], { encoding: 'utf8' }).split('\n').filter((path) => path.endsWith('.json'));
if (changedFiles.length === 0) {
  console.log('新题来源门禁：本次没有修改题库文件。');
  process.exit(0);
}
const errors = [];
let changedQuestions = 0;
for (const path of changedFiles) {
  const current = parse(readFileSync(resolve(process.cwd(), path), 'utf8'), path);
  const previous = new Map(
    previousQuestions(path).map((question) => [question.id, JSON.stringify(stable(question))]),
  );
  for (const question of current) {
    if (previous.get(question.id) === JSON.stringify(stable(question))) continue;
    changedQuestions++;
    if (!question.cognitiveTask) errors.push(`${path} / ${question.id}: 缺 cognitiveTask`);
    if (!question.source?.materialId?.trim()) errors.push(`${path} / ${question.id}: 缺 source.materialId`);
  }
}
console.log(`新题来源门禁：检查 ${changedQuestions} 道新增或修改的题目。`);
if (errors.length) {
  errors.forEach((error) => console.error('✗ ' + error));
  process.exit(1);
}
console.log('✓ 本次新增/修改题目均声明 cognitiveTask 和 source.materialId。');
