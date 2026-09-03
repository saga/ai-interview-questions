// npm run question:convert -- --file draft.json --prompt-version v5 [--check | --write --questions out.json --variants out.json]
// 把 docs/prompt_part2.md 产出的 JSON 拆成仓库可入库的两部分：
//   canonical → Question JSON（走 question:add 入库）；variant → 变体池 JSON（src/data/variants/ 格式）。
// prompt 的 knowledgeId / assessmentTarget / reasoningGoal 不在 Question schema 内，转换时丢弃并告警
// （assessment 语义由 topic×angle×difficulty×cognitiveTask 承载，见 questionIdentity.ts）。

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { parseQuestionArray, type Question } from '../src/schemas/question.ts';
import { cognitiveTaskSchema, questionAngleSchema } from '../src/schemas/common.ts';
import {
  computeVariantSourceHash,
  variantSourceOf,
  type QuestionVariant,
  type VariantKind,
} from '../src/schemas/variant.ts';

const root = fileURLToPath(new URL('../', import.meta.url));

const promptOptionSchema = z.object({ key: z.string().min(1), text: z.string().min(1) });
const promptFormatSchema = z.object({
  type: z.enum(['multiple-choice', 'single-choice', 'multiple', 'single']),
  options: z.array(promptOptionSchema).min(2),
  answer: z.union([z.array(z.string().min(1)).min(1), z.string().min(1)]),
});
const promptItemSchema = z.object({
  id: z.string().min(1),
  questionRole: z.enum(['canonical', 'variant']),
  variantOf: z.string().nullable().optional(),
  category: z.string().min(1),
  topic: z.string().min(1),
  knowledgeId: z.string().optional(),
  concepts: z.array(z.string().min(1)).optional(),
  tags: z.array(z.string()).default([]),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  angle: z.string().min(1),
  cognitiveTask: z.string().min(1),
  assessmentTarget: z.string().optional(),
  question: z.string().min(1),
  explanation: z.string().min(1),
  formats: z.array(promptFormatSchema).min(1).max(1),
});
type PromptItem = z.infer<typeof promptItemSchema>;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const inputFile = arg('--file');
const promptVersion = arg('--prompt-version') ?? 'unversioned';
const kind = (arg('--kind') ?? 'context-options') as VariantKind;
const questionsOut = arg('--questions');
const variantsOut = arg('--variants');
const write = process.argv.includes('--write');
if (!inputFile || (write && (!questionsOut || !variantsOut))) {
  console.error('用法：npm run question:convert -- --file draft.json --prompt-version v5 --check');
  console.error('或：npm run question:convert -- --file draft.json --prompt-version v5 --write --questions q.json --variants v.json');
  process.exit(2);
}
if (!['surface', 'context', 'surface-options', 'context-options'].includes(kind)) {
  console.error(`--kind 非法：${kind}`);
  process.exit(2);
}

const raw = JSON.parse(readFileSync(resolve(process.cwd(), inputFile), 'utf8')) as unknown;
const items = z.array(promptItemSchema).parse(raw) as PromptItem[];

// canonical 查找：本批 + 存量库（variant 算 sourceHash 需要 canonical 内容）。
const bankDir = resolve(root, 'src/data/questions');
const bank: Question[] = readdirSync(bankDir)
  .filter((f) => f.endsWith('.json'))
  .flatMap((f) => JSON.parse(readFileSync(resolve(bankDir, f), 'utf8')) as Question[]);
const byId = new Map<string, Question>(bank.map((q) => [q.id, q]));

const errors: string[] = [];
const warnings: string[] = [];
const questions: unknown[] = [];
const variants: QuestionVariant[] = [];
const now = Date.now();

function toIndices(item: PromptItem): number[] {
  const opts = item.formats[0].options;
  const keys = Array.isArray(item.formats[0].answer) ? item.formats[0].answer : [item.formats[0].answer];
  return (keys as string[]).map((k) => {
    const idx = opts.findIndex((o) => o.key === k);
    if (idx < 0) errors.push(`${item.id}: answer key "${k}" 在 options 中不存在`);
    return idx;
  });
}

for (const item of items) {
  // ⚠️ 措辞修正（2026-09-04）：原文本写「knowledgeId 无对应 schema 字段」是错的——
  // schema 里 `knowledgeId` 存在（question.ts），但指的是**课程知识点 id**，
  // 与 prompt 侧 `knowledgeId`（Knowledge 节点 id）同名不同义。而 Knowledge 节点 id
  // 在本仓库就是 `topic`（add-question.ts 用 `nodeIds.has(question.topic)` 校验）。
  // 因此这里的正确处理是「比对是否与 topic 一致」而非「一律丢弃」。
  if (item.knowledgeId && item.knowledgeId !== item.topic) {
    warnings.push(
      `${item.id}: knowledgeId "${item.knowledgeId}" 与 topic "${item.topic}" 不一致。` +
        `本仓库 topic 即 Knowledge 节点 id，schema 的 Question.knowledgeId 是课程知识点 id（同名不同义），已丢弃`,
    );
  }
  if (item.assessmentTarget) warnings.push(`${item.id}: assessmentTarget 未落库（schema 无此字段，留作评审上下文）`);
  const indices = toIndices(item);
  const type = item.formats[0].type.startsWith('multiple') ? 'multiple' : 'single';
  if (type === 'multiple' && indices.length < 2) errors.push(`${item.id}: multiple-choice 至少需要两个答案 key`);
  if (item.questionRole === 'canonical') {
    const [core, ...supporting] = item.concepts ?? [];
    questions.push({
      id: item.id,
      category: item.category,
      topic: item.topic,
      tags: item.tags,
      difficulty: item.difficulty,
      angle: item.angle,
      cognitiveTask: item.cognitiveTask,
      ...(core ? { concepts: { core, supporting: supporting.slice(0, 3) } } : {}),
      question: item.question,
      explanation: item.explanation,
      formats: {
        choice: {
          type,
          options: item.formats[0].options.map((o) => o.text),
          answer: indices,
        },
      },
    });
  } else {
    if (!item.variantOf) {
      errors.push(`${item.id}: variant 缺少 variantOf`);
      continue;
    }
    const canonical = byId.get(item.variantOf) ?? (questions as Question[]).find((q) => q.id === item.variantOf);
    if (!canonical) {
      errors.push(`${item.id}: variantOf "${item.variantOf}" 在存量库与本批中均找不到`);
      continue;
    }
    const angleChanged = (canonical as Question).angle !== item.angle;
    const cogChanged = (canonical as Question).cognitiveTask !== item.cognitiveTask;
    let angle: QuestionVariant['angle'];
    let cognitiveTask: QuestionVariant['cognitiveTask'];
    try {
      if (angleChanged) angle = questionAngleSchema.parse(item.angle);
      if (cogChanged) cognitiveTask = cognitiveTaskSchema.parse(item.cognitiveTask);
    } catch {
      errors.push(`${item.id}: variant 的 angle/cognitiveTask 非法（angle="${item.angle}" cognitiveTask="${item.cognitiveTask}"）`);
      continue;
    }
    variants.push({
      id: `${item.variantOf}__${kind}__prompt-${item.id}`,
      kind,
      question: item.question,
      options: item.formats[0].options.map((o) => o.text),
      angle,
      cognitiveTask,
      generatedAt: now,
      generator: 'offline',
      promptVersion,
      sourceHash: computeVariantSourceHash(variantSourceOf(canonical as Question)),
    });
  }
}

// canonical 先过 Question schema（angle/cognitiveTask 非法在这里暴露）。
let parsed: Question[] = [];
try {
  parsed = parseQuestionArray(questions);
} catch (e) {
  console.error('canonical 校验失败：');
  console.error(e instanceof Error ? e.message.slice(0, 3000) : e);
  process.exit(1);
}
for (const q of parsed) byId.set(q.id, q);

if (errors.length) {
  console.error(`转换失败：${errors.length} 个错误`);
  errors.forEach((e) => console.error(`✗ ${e}`));
  process.exit(1);
}
console.log(`转换通过：canonical ${parsed.length} · variant ${variants.length}（promptVersion=${promptVersion}）`);
warnings.forEach((w) => console.warn(`⚠ ${w}`));

if (write) {
  writeFileSync(resolve(process.cwd(), questionsOut!), `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  writeFileSync(
    resolve(process.cwd(), variantsOut!),
    `${JSON.stringify({ version: 1, generatedAt: now, promptVersion, variants: Object.fromEntries(group(variants)) }, null, 2)}\n`,
    'utf8',
  );
  console.log(`已写入 ${questionsOut} / ${variantsOut}（下一步：npm run question:add -- --file ${questionsOut} --check）`);
} else {
  console.log('仅检查模式：加 --write --questions <f> --variants <f> 才会写入。');
}

function group(vs: QuestionVariant[]): Map<string, QuestionVariant[]> {
  const m = new Map<string, QuestionVariant[]>();
  for (const v of vs) {
    const canonId = v.id.split('__')[0];
    m.set(canonId, [...(m.get(canonId) ?? []), v]);
  }
  return m;
}
