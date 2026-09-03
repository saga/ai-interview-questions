// npm run question:add -- --file draft.json [--check | --write --output batch.json]
// Import gate: Zod validates the contract; this script adds cross-bank checks.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseQuestionArray, type Question } from '../src/schemas/question.ts';
import type { KnowledgeNode } from '../src/schemas/knowledge.ts';
import { questionAngleSchema } from '../src/schemas/common.ts';
import { detectOptionLengthRatio } from '../src/domain/bias.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const questionsDir = resolve(root, 'src/data/questions');
const knowledgeDir = resolve(root, 'src/data/knowledge');
// 合法角度以 schema 为单源（新增 angle 只改 common.ts，此处自动跟随）。
const validAngles = new Set<string>(questionAngleSchema.options);
// ADR-077：`cognitiveTask` 进入 assessment contract（topic × angle × difficulty × cognitiveTask）。
// 存量 1311 题无该字段且**不回填**（无可靠信息源，LLM 反推即污染）⇒ schema 层保持 optional。
// 新题目前只 **warn**：三个出题 skill（`add-question-to-bank` / `article-to-questions` /
// `fill-coverage-gap`）尚未产出该字段（plan0903_3 §二.7 未做），此刻改硬门禁会把出题管线锁死。
// 待 skill 同步产出后，把循环里的 `warnings.push` 换成 `errors.push` 即可升为必填。
// 合法值不在此处白名单化——`parseQuestionArray`（Zod）在更早的阶段就已拦截非法枚举值。

/** 题型归一化：新 prompt 用 single-choice/multiple-choice，库内用 single/multiple。 */
function normalizeChoiceType(value: unknown): unknown {
  if (value === 'single-choice') return 'single';
  if (value === 'multiple-choice') return 'multiple';
  return value;
}

function normalizeIncoming(raw: unknown): unknown {
  if (!Array.isArray(raw)) return raw;
  return raw.map((item) => {
    if (typeof item !== 'object' || item === null) return item;
    const q = item as Record<string, unknown>;
    const formats = q.formats as Record<string, unknown> | undefined;
    const choice = formats?.choice as Record<string, unknown> | undefined;
    if (!choice || typeof choice.type !== 'string') return item;
    return { ...q, formats: { ...formats, choice: { ...choice, type: normalizeChoiceType(choice.type) } } };
  });
}

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
const incoming = parseQuestionArray(normalizeIncoming(raw));
const existing = readJsonArrays<Question>(questionsDir);
const nodes = readJsonArrays<KnowledgeNode>(knowledgeDir);
const nodeIds = new Set(nodes.map((node) => node.id));
const existingIds = new Set(existing.map((question) => question.id));
const existingTexts = new Map(existing.map((question) => [normalizedText(question.question), question.id]));
const errors: string[] = [];
const warnings: string[] = [];
const newlyCovered = new Set<string>();
const existingCells = new Set(existing.map((question) => `${question.topic}\u0000${question.angle}`));

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
  if (!validAngles.has(question.angle)) errors.push(`${question.id}: angle 不合法`);
  // 只查「缺失」：非法值在 `parseQuestionArray`（Zod）阶段就已抛错，到不了这里。
  if (!question.cognitiveTask) {
    warnings.push(`${question.id}: 缺 cognitiveTask（ADR-077 起是 assessment contract 第四维，新题应填）`);
  }
  // 规范化后重复 = 硬失败。此前只 warn，导入照样写盘，结果同一道题以两种标点/大小写
  // 形态并存于题库：覆盖矩阵把它算成 2 题（虚高），练习时用户会连着答两遍同一题。
  // 真需要近似题时应走变体（variant）通道，而不是再导一遍原题。
  const duplicate = existingTexts.get(normalizedText(question.question));
  if (duplicate) errors.push(`${question.id}: 题干与 ${duplicate} 规范化后重复（如需近似题请走变体通道）`);
  existingIds.add(question.id);
  existingTexts.set(normalizedText(question.question), question.id);

  const choice = question.formats.choice;
  if (choice) {
    const options = choice.options.map(normalizedText);
    if (new Set(options).size !== options.length) errors.push(`${question.id}: 选项重复`);
    if (choice.options.some((option) => /^(参见解析|见解析|略|待补充|todo|tbd)$/iu.test(option.trim()))) {
      errors.push(`${question.id}: 选项包含占位文本`);
    }
    // 长度泄题门禁（AGENTS.md §4.2）：最长/最短选项比 > 1.8 会被应试者当"正确项更长"破绽利用。
    const ratioReport = detectOptionLengthRatio(choice.options);
    if (ratioReport.biased) {
      errors.push(
        `${question.id}: 选项长度失衡（最长 ${ratioReport.maxLen} / 最短 ${ratioReport.minLen} = ${ratioReport.ratio.toFixed(1)}× > 1.8），` +
          `存在长度泄题风险，请让各选项篇幅接近后再导入`,
      );
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

// 批量集中度告警（仅告警，不阻塞）：同一 topic × angle 在"本批导入"里过于集中（≥4 题），
// 属于重复堆砌同一认知任务。已有 ≥3 题的格子应确认新题带来新价值，而非同类堆砌。
const incomingCellCounts = new Map<string, number>();
for (const question of incoming) {
  if (question.angle) {
    const cell = `${question.topic}\u0000${question.angle}`;
    incomingCellCounts.set(cell, (incomingCellCounts.get(cell) ?? 0) + 1);
  }
}
for (const [cell, count] of incomingCellCounts) {
  if (count >= 4) {
    const [topic, angle] = cell.split('\u0000');
    warnings.push(
      `批量集中度：本批 ${count} 道题都落在 ${topic} × ${angle} 同一格子里（≥4）。` +
        `同一 topic×angle 已有 ≥3 题时应确认新题带来新认知任务 / 场景 / misconception，而不是堆砌同类题`,
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