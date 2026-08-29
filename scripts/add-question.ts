// npm run question:add -- --file draft.json [--check | --write --output batch.json]
// Import gate: Zod validates the contract; this script adds cross-bank checks.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseQuestionArray, type Question } from '../src/schemas/question.ts';
import type { KnowledgeNode } from '../src/schemas/knowledge.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const questionsDir = resolve(root, 'src/data/questions');
const knowledgeDir = resolve(root, 'src/data/knowledge');
const validAngles = new Set(['definition', 'fundamental', 'mechanism', 'calculation', 'comparison', 'tradeoff', 'scenario', 'debugging', 'system-design', 'design']);

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readJsonArrays<T>(directory: string): T[] {
  return readdirSync(directory)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .flatMap((file) => JSON.parse(readFileSync(resolve(directory, file), 'utf8')) as T[]);
}

function normalizedText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '');
}

function printUsage(): never {
  console.error('用法：npm run question:add -- --file draft.json --check');
  console.error('或：npm run question:add -- --file draft.json --write --output src/data/questions/p1-gap-fill.json');
  process.exit(2);
}

const inputFile = arg('--file');
const outputFile = arg('--output');
const write = process.argv.includes('--write');
if (!inputFile || (write && !outputFile) || (!write && process.argv.includes('--output'))) printUsage();

const raw = JSON.parse(readFileSync(resolve(process.cwd(), inputFile), 'utf8')) as unknown;
const incoming = parseQuestionArray(raw);
const existing = readJsonArrays<Question>(questionsDir);
const nodes = readJsonArrays<KnowledgeNode>(knowledgeDir);
const nodeIds = new Set(nodes.map((node) => node.id));
const existingIds = new Set(existing.map((question) => question.id));
const existingTexts = new Map(existing.map((question) => [normalizedText(question.question), question.id]));
const errors: string[] = [];
const warnings: string[] = [];
const newlyCovered = new Set<string>();
const existingCells = new Set(existing.filter((question) => question.angle).map((question) => `${question.topic}\u0000${question.angle}`));

// 题型门禁（AGENTS.md §4.2）：多选题应占多数，单选题超过 1/3 视为题型设计偷懒。
// 只对"本批导入"生效，不追溯历史题目——历史单选占比高是存量问题，不应阻塞新题导入。
const MAX_SINGLE_RATIO = 1 / 3;
const MIN_CHOICE_FOR_FORMAT_GATE = 3;
let singleCount = 0;
let multipleCount = 0;
let openOnlyCount = 0;

for (const question of incoming) {
  if (existingIds.has(question.id)) errors.push(`${question.id}: id 已存在`);
  if (nodeIds.has(question.topic) && question.angle && !existingCells.has(`${question.topic}\u0000${question.angle}`)) {
    newlyCovered.add(`${question.topic} × ${question.angle}`);
  }
  if (!nodeIds.has(question.topic)) errors.push(`${question.id}: topic "${question.topic}" 没有知识节点`);
  if (!question.angle || !validAngles.has(question.angle)) errors.push(`${question.id}: angle 不合法或缺失`);
  const duplicate = existingTexts.get(normalizedText(question.question));
  if (duplicate) warnings.push(`${question.id}: 题干与 ${duplicate} 规范化后重复`);
  existingIds.add(question.id);
  existingTexts.set(normalizedText(question.question), question.id);

  const choice = question.formats.choice;
  if (choice) {
    const options = choice.options.map(normalizedText);
    if (new Set(options).size !== options.length) errors.push(`${question.id}: 选项重复`);
    if (choice.options.some((option) => /^(参见解析|见解析|略|待补充|todo|tbd)$/iu.test(option.trim()))) {
      errors.push(`${question.id}: 选项包含占位文本`);
    }
    if (choice.type === 'single') singleCount++;
    else if (choice.type === 'multiple') multipleCount++;
  } else {
    openOnlyCount++;
  }
}

const choiceTotal = singleCount + multipleCount;
if (choiceTotal >= MIN_CHOICE_FOR_FORMAT_GATE) {
  const singleRatio = singleCount / choiceTotal;
  if (singleRatio > MAX_SINGLE_RATIO) {
    errors.push(
      `题型分布：本批 ${choiceTotal} 道选择题里单选 ${singleCount} 道（${(singleRatio * 100).toFixed(0)}%），超过 1/3。` +
        `AGENTS.md §4.2 要求以多选为主（multiple ≥ 2/3），请回炉改写后再导入`,
    );
  }
}

if (errors.length) {
  console.error(`导入检查失败：${errors.length} 个错误`);
  errors.forEach((error) => console.error(`✗ ${error}`));
  process.exit(1);
}

console.log(`导入检查通过：${incoming.length} 题`);
console.log(`新增覆盖格：${newlyCovered.size ? [...newlyCovered].join('、') : '无'}`);
console.log(
  `题型分布：单选 ${singleCount} · 多选 ${multipleCount}` +
    (openOnlyCount ? ` · 纯开放题 ${openOnlyCount}` : '') +
    (choiceTotal ? `（多选占比 ${((multipleCount / choiceTotal) * 100).toFixed(0)}%）` : ''),
);
warnings.forEach((warning) => console.warn(`⚠ ${warning}`));

if (write) {
  const target = resolve(process.cwd(), outputFile!);
  const questionsRoot = `${questionsDir}/`;
  if (!target.startsWith(questionsRoot) || existsSync(target)) {
    console.error(`写入目标必须位于 ${questionsRoot} 且不能覆盖已有文件`);
    process.exit(1);
  }
  writeFileSync(target, `${JSON.stringify(incoming, null, 2)}\n`, 'utf8');
  console.log(`已写入 ${target}`);
} else {
  console.log('仅检查模式：使用 --write --output <题库文件> 才会写入。');
}