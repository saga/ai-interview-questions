#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
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
function readJsonArrays(directory) {
  return readdirSync(directory)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .flatMap((file) => parse(readFileSync(resolve(directory, file), 'utf8'), `src/data/knowledge/${file}`));
}
const knowledgeNodes = readJsonArrays(resolve(process.cwd(), 'src/data/knowledge'));
const knowledgeById = new Map(knowledgeNodes.map((node) => [node.id, node]));
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
    if (question.courseId && !question.knowledgeId) {
      errors.push(`${path} / ${question.id}: 课程题缺精确 knowledgeId`);
    }
    if (question.courseId && question.knowledgeId) {
      const node = knowledgeById.get(question.knowledgeId);
      if (!node) {
        errors.push(`${path} / ${question.id}: knowledgeId "${question.knowledgeId}" 不存在于 KnowledgeNode 清单`);
      } else {
        if (node.courseId !== question.courseId) {
          errors.push(`${path} / ${question.id}: knowledgeId "${question.knowledgeId}" 不属于 courseId "${question.courseId}"`);
        }
        if (question.topic !== node.id) {
          errors.push(`${path} / ${question.id}: topic 必须等于对应 KnowledgeNode.id（${node.id}），不能使用 KnowledgeNode.topic 分组值`);
        }
      }
    }
    if (question.courseId === 'snowflake') {
      if (!question.source?.section?.trim()) errors.push(`${path} / ${question.id}: Snowflake 课程题缺 source.section`);
      if (!question.source?.relatedMaterials?.length) {
        errors.push(`${path} / ${question.id}: Snowflake 课程题缺 source.relatedMaterials`);
      }
    }
  }
}
console.log(`新题来源门禁：检查 ${changedQuestions} 道新增或修改的题目。`);
if (errors.length) {
  errors.forEach((error) => console.error('✗ ' + error));
  process.exit(1);
}
console.log('✓ 本次新增/修改题目均声明 cognitiveTask、source.materialId，并满足课程节点与来源字段要求。');
