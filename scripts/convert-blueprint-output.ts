// npm run question:convert -- --file draft.json --prompt-version v7 [--check | --write --questions out.json --variants out.json]
// 把 docs/prompt_part2.md（PROMPT-VERSION v7）产出的 JSON 拆成仓库可入库的两部分：
//   canonical → Question JSON（走 question:add 入库）；variant → 变体池 JSON（src/data/variants/ 格式）。
//
// 适配的 v7 落库字段（与 schema 对齐，避免 Zod 静默 strip）：
//   - blueprintKnowledgeId：对账字段，仅与 topic 一致性校验（同名不同义于 schema 的 question.knowledgeId）。
//   - misconceptions：题目级误解数组 → Question.misconceptions。
//   - misconceptionMap：Part2 以 option key 对齐的对象输出，此处转成 schema 要求的「按 option 索引的数组」。
//   - source.materialId：溯源引用 → Question.source（此前被 Zod strip 丢失，复评 v6 P0 之一）。
//
// Blueprint 的测量意图（assessmentTarget / reasoningGoal）**落库**为 Question.assessment
// （plan0907 / 外部评审 P0-2）。

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
import { mapMisconceptionMap, misconceptionMapsEqual } from './convert-blueprint-helpers.ts';

const root = fileURLToPath(new URL('../', import.meta.url));

const promptOptionSchema = z.object({ key: z.string().min(1), text: z.string().min(1) });
// Part2 以 option key 对齐的对象声明 misconceptionMap（见 prompt_part2 §20），
// schema 需要的是「按 option 索引的数组」，转换在 toMisconceptionMap 完成。
const promptMapSchema = z.record(z.string(), z.union([z.number().int().nonnegative(), z.null()])).optional();
const promptFormatSchema = z.object({
  type: z.enum(['multiple-choice', 'single-choice', 'multiple', 'single']),
  options: z.array(promptOptionSchema).min(2),
  answer: z.union([z.array(z.string().min(1)).min(1), z.string().min(1)]),
  misconceptionMap: promptMapSchema,
});
const promptItemSchema = z.object({
  id: z.string().min(1),
  questionRole: z.enum(['canonical', 'variant']),
  variantOf: z.string().nullable().optional(),
  category: z.string().min(1),
  topic: z.string().min(1),
  // v7 改名（prompt_part2 §2）：仅 Blueprint 与 topic 的对账字段，不是 schema 的 Question.knowledgeId。
  blueprintKnowledgeId: z.string().optional(),
  concepts: z.array(z.string().min(1)).optional(),
  tags: z.array(z.string()).default([]),
  // difficulty：canonical 必产（缺则 error）；variant 可省略并从 canonical 继承（v7 §4）。
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  angle: z.string().min(1),
  cognitiveTask: z.string().min(1),
  assessmentTarget: z.string().optional(),
  reasoningGoal: z.string().optional(),
  misconceptions: z.array(z.string().min(1)).optional(),
  source: z.object({ materialId: z.string().min(1), section: z.string().optional() }).optional(),
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
  console.error('用法：npm run question:convert -- --file draft.json --prompt-version v7 --check');
  console.error('或：npm run question:convert -- --file draft.json --prompt-version v7 --write --questions q.json --variants v.json');
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

/**
 * Part2 的 misconceptionMap 以 option key 对齐（如 {A:0,B:null}），schema 需要按 option
 * 索引的数组。转换委托给独立纯函数（便于单测），结果汇入 errors。
 */
function toMisconceptionMap(item: PromptItem, indices: number[]): (number | null)[] | null {
  const { array, problems } = mapMisconceptionMap(item.formats[0].options, indices, item.formats[0].misconceptionMap, item.id);
  problems.forEach((p) => errors.push(p));
  return array;
}

for (const item of items) {
  // blueprintKnowledgeId 仅对账：必须与 topic 一致（v7 §2）。不一致说明 Part2 误填了
  // 课程知识点 id。本仓库 Knowledge 节点 id 即 topic（add-question.ts 用 nodeIds.has(topic) 校验）。
  if (item.blueprintKnowledgeId && item.blueprintKnowledgeId !== item.topic) {
    warnings.push(
      `${item.id}: blueprintKnowledgeId "${item.blueprintKnowledgeId}" 与 topic "${item.topic}" 不一致。` +
        `本仓库 topic 即 Knowledge 节点 id，已丢弃该对账字段`,
    );
  }
  // 测量意图落库（P0-2）：target + reasoningGoal 必须齐备才构成完整 assessment。
  // 缺一半时只告警不落库——半截的测量意图比没有更容易误导后续 review。
  const hasTarget = Boolean(item.assessmentTarget?.trim());
  const hasReasoning = Boolean(item.reasoningGoal?.trim());
  const assessment =
    hasTarget && hasReasoning ? { target: item.assessmentTarget!.trim(), reasoningGoal: item.reasoningGoal!.trim() } : undefined;
  if (hasTarget !== hasReasoning) {
    warnings.push(
      `${item.id}: 测量意图不完整（assessmentTarget=${hasTarget ? '有' : '无'} / reasoningGoal=${hasReasoning ? '有' : '无'}），未落库`,
    );
  }
  const indices = toIndices(item);
  const type = item.formats[0].type.startsWith('multiple') ? 'multiple' : 'single';
  if (type === 'multiple' && indices.length < 2) errors.push(`${item.id}: multiple-choice 至少需要两个答案 key`);
  const misconceptionMap = toMisconceptionMap(item, indices);
  if (item.questionRole === 'canonical') {
    if (!item.difficulty) errors.push(`${item.id}: canonical 必须产出 difficulty`);
    const [core, ...supporting] = item.concepts ?? [];
    const choice: { type: 'single' | 'multiple'; options: string[]; answer: number[]; misconceptionMap?: (number | null)[] } = {
      type,
      options: item.formats[0].options.map((o) => o.text),
      answer: indices,
    };
    if (misconceptionMap) choice.misconceptionMap = misconceptionMap;
    questions.push({
      id: item.id,
      category: item.category,
      topic: item.topic,
      tags: item.tags,
      ...(item.difficulty ? { difficulty: item.difficulty } : {}),
      angle: item.angle,
      cognitiveTask: item.cognitiveTask,
      ...(item.misconceptions?.length ? { misconceptions: item.misconceptions } : {}),
      ...(item.source ? { source: item.source } : {}),
      ...(core ? { concepts: { core, supporting: supporting.slice(0, 3) } } : {}),
      ...(assessment ? { assessment } : {}),
      question: item.question,
      explanation: item.explanation,
      formats: { choice },
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
    // v7 §4：variant 省略 difficulty 时继承 canonical；若声明则与 canonical 一致。
    if (item.difficulty && item.difficulty !== (canonical as Question).difficulty) {
      errors.push(`${item.id}: variant difficulty "${item.difficulty}" 与 canonical "${canonical.difficulty}" 不一致（v7 §4）`);
    }
    // v7 §25：variant 选项与 canonical 同槽位、同 misconception role。两题 options 一一对应，
    // 故 misconceptionMap 必须逐槽相等；违反则拒绝（变体池不存储 misconceptionMap，此处仅校验）。
    const cMap = (canonical as Question).formats?.choice?.misconceptionMap ?? null;
    if (misconceptionMap && !misconceptionMapsEqual(misconceptionMap, cMap)) {
      errors.push(`${item.id}: variant 的 misconceptionMap 与 canonical 不一致，违反 v7 §25 同槽位同 misconception role`);
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
      // 变体自声明的测量意图（缺省 = 继承 canonical）。
      // reasoningGoal 不同是「两条 reasoning path 真的不同」的直接依据。
      ...(assessment ? { assessment } : {}),
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
