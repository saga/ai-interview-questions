// 人工/LLM 直接撰写测量面字段的进出口（不接 provider —— 撰写者本身就是 LLM）。
//
// 两步：
//   1) --dump   把「还没有该字段」的条目导成紧凑上下文，供撰写者逐批阅读。
//   2) --apply  把写好的条目合并回题库 / 变体池。
//
// 两个字段共用一条链路（--field）：
//   --field=assessment      （默认）`{ id, target, reasoningGoal }`
//   --field=cognitive-task          `{ id, cognitiveTask }`
//
// 为什么单独一条链路：`question:assessment --engine=infer` 只能抽取已有文字，抽不到断言句
// 就留空（存量 156 题 + 48 变体）。这些题的解析首句是名词罗列或逐项判错，必须由撰写者
// 真正读懂题目后写。撰写者就是 LLM 时，再套一层 provider 调用纯属浪费。
//
// 用法：
//   node scripts/assessment-manual.ts --dump --out=temp/assessment-pending.json [--kind=question|variant]
//   node scripts/assessment-manual.ts --apply --file=temp/assessment-authored-01.json [--dry-run]
//   node scripts/assessment-manual.ts --status
//   node scripts/assessment-manual.ts --dump --field=cognitive-task --out=temp/ct-pending.json
//   node scripts/assessment-manual.ts --apply --field=cognitive-task --file=temp/ct-authored-01.json

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { Assessment } from '../src/schemas/common.ts';
import type { Question } from '../src/schemas/question.ts';
import type { QuestionVariant } from '../src/schemas/variant.ts';
import { cjkDice } from '../src/domain/textSimilarity.ts';
import { cognitiveTaskSchema, type CognitiveTask } from '../src/schemas/common.ts';
import { variantModeOf } from '../src/schemas/variant.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const questionsDir = resolve(root, 'src/data/questions');
const variantsDir = resolve(root, 'src/data/variants');

/** 变体选项 ↔ canonical 正确项的匹配阈值，与 backfill-assessment.ts 保持一致。 */
const VARIANT_OPTION_MATCH = 50;

interface PendingItem {
  seq: number;
  kind: 'question' | 'variant';
  id: string;
  topic: string;
  angle?: string;
  cognitiveTask?: string;
  /** 变体专用：canonical id 与变体形态 */
  canonicalId?: string;
  variantKind?: string;
  /** 变体专用：canonical 已落库的测量意图——新写的必须与它能区分开，否则等于没写。 */
  canonicalAssessment?: Assessment;
  question: string;
  explanation: string;
  correct: string[];
  distractors: string[];
}

function arg(name: string): string | undefined {
  const inline = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (inline !== undefined) return inline.slice(name.length + 3);
  const i = process.argv.indexOf(`--${name}`);
  const next = i >= 0 ? process.argv[i + 1] : undefined;
  return next !== undefined && !next.startsWith('--') ? next : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

const readQuestions = (): { path: string; questions: Question[] }[] =>
  readdirSync(questionsDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const path = resolve(questionsDir, f);
      return { path, questions: JSON.parse(readFileSync(path, 'utf8')) as Question[] };
    });

interface PoolFile {
  version: 1;
  generatedAt: number;
  promptVersion: string;
  variants: Record<string, QuestionVariant[]>;
}
const readVariants = (): { path: string; pool: PoolFile }[] =>
  readdirSync(variantsDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const path = resolve(variantsDir, f);
      return { path, pool: JSON.parse(readFileSync(path, 'utf8')) as PoolFile };
    });

function splitOptions(q: Question): { correct: string[]; distractors: string[] } | null {
  const choice = q.formats?.choice;
  if (!choice) return null;
  const answer = new Set(choice.answer);
  return {
    correct: choice.options.filter((_, i) => answer.has(i)),
    distractors: choice.options.filter((_, i) => !answer.has(i)),
  };
}

function collectPending(kind: 'question' | 'variant' | 'both'): PendingItem[] {
  const files = readQuestions();
  const variantFiles = readVariants();
  const bank = new Map<string, Question>();
  for (const f of files) for (const q of f.questions) bank.set(q.id, q);

  const out: PendingItem[] = [];
  let seq = 0;
  const push = (item: Omit<PendingItem, 'seq'>) => out.push({ seq: seq++, ...item });

  if (kind !== 'variant') {
    for (const f of files) {
      for (const q of f.questions) {
        if (q.assessment) continue;
        const split = splitOptions(q);
        if (!split) continue;
        push({
          kind: 'question',
          id: q.id,
          topic: q.topic,
          angle: q.angle,
          cognitiveTask: q.cognitiveTask,
          question: q.question,
          explanation: q.explanation ?? '',
          correct: split.correct,
          distractors: split.distractors,
        });
      }
    }
  }
  if (kind !== 'question') {
    for (const f of variantFiles) {
      for (const [canonicalId, vs] of Object.entries(f.pool.variants ?? {})) {
        for (const v of vs) {
          if (v.assessment) continue;
          // runtime（presentation）变体恒继承 canonical，不需要也不应该自声明测量意图。
          if (variantModeOf(v) === 'presentation') continue;
          const canonical = bank.get(canonicalId);
          const split = canonical ? splitOptions(canonical) : null;
          if (!canonical || !split || !v.options) continue;
          const correct: string[] = [];
          const distractors: string[] = [];
          for (const option of v.options) {
            const best = Math.max(0, ...split.correct.map((c) => cjkDice(option, c)));
            (best >= VARIANT_OPTION_MATCH ? correct : distractors).push(option);
          }
          push({
            kind: 'variant',
            id: v.id,
            topic: canonical.topic,
            angle: v.angle ?? canonical.angle,
            cognitiveTask: v.cognitiveTask ?? canonical.cognitiveTask,
            canonicalId,
            variantKind: v.kind,
            canonicalAssessment: canonical.assessment,
            question: v.question,
            explanation: canonical.explanation ?? '',
            correct,
            distractors,
          });
        }
      }
    }
  }
  return out;
}

// ── --dump ──
/** cognitive-task 只需题干与 angle，带全量解析会把 292 条撑到没法读，故单独出紧凑形状。 */
interface CtPendingItem {
  seq: number;
  id: string;
  topic: string;
  angle?: string;
  question: string;
}

function collectCtPending(): CtPendingItem[] {
  const out: CtPendingItem[] = [];
  let seq = 0;
  for (const f of readQuestions()) {
    for (const q of f.questions) {
      if (q.cognitiveTask) continue;
      out.push({ seq: seq++, id: q.id, topic: q.topic, angle: q.angle, question: q.question });
    }
  }
  return out;
}

function dump(kind: 'question' | 'variant' | 'both', out: string, field: string): void {
  const items = field === 'cognitive-task' ? collectCtPending() : collectPending(kind);
  writeFileSync(resolve(process.cwd(), out), JSON.stringify(items, null, 2), 'utf8');
  if (field === 'cognitive-task') {
    const byAngle = (items as CtPendingItem[]).reduce<Record<string, number>>((acc, i) => {
      acc[i.angle ?? '?'] = (acc[i.angle ?? '?'] ?? 0) + 1;
      return acc;
    }, {});
    console.log(`✓ 导出 ${items.length} 条待撰写 cognitiveTask → ${out}`);
    console.log(`  ${JSON.stringify(byAngle)}`);
    return;
  }
  const byKind = (items as PendingItem[]).reduce<Record<string, number>>((acc, i) => {
    acc[i.kind] = (acc[i.kind] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`✓ 导出 ${items.length} 条待撰写条目 → ${out}`);
  console.log(`  ${JSON.stringify(byKind)}`);
  if (items.length > 0) console.log(`  首条 seq=${items[0].seq} id=${items[0].id}`);
}

// ── --apply ──
const authoredSchema = z.object({
  id: z.string().min(1),
  target: z.string().min(1),
  reasoningGoal: z.string().min(1),
});

const ctSchema = z.object({
  id: z.string().min(1),
  cognitiveTask: cognitiveTaskSchema,
});

function apply(file: string, dryRun: boolean, field: string): void {
  type Authored = { id: string; target?: string; reasoningGoal?: string; cognitiveTask?: CognitiveTask };
  const raw = JSON.parse(readFileSync(resolve(process.cwd(), file), 'utf8')) as unknown;
  const list = (Array.isArray(raw) ? raw : [raw]) as Authored[];
  if (list.length === 0) {
    console.error(`${file} 里没有条目`);
    process.exit(1);
  }

  const files = readQuestions();
  const variantFiles = readVariants();
  const index = new Map<string, { kind: 'question' | 'variant'; q?: Question; v?: QuestionVariant }>();
  for (const f of files) for (const q of f.questions) index.set(q.id, { kind: 'question', q });
  for (const f of variantFiles) {
    for (const vs of Object.values(f.pool.variants ?? {})) {
      for (const v of vs) index.set(v.id, { kind: 'variant', v });
    }
  }

  const isCt = field === 'cognitive-task';
  const errors: string[] = [];
  const applied: Authored[] = [];
  for (const a of list) {
    const parsed = (isCt ? ctSchema : authoredSchema).safeParse(a);
    if (!parsed.success) {
      errors.push(`${a?.id ?? '<无 id>'}: 字段不合契约 —— ${parsed.error.message}`);
      continue;
    }
    const hit = index.get(a.id);
    if (!hit) {
      errors.push(`${a.id}: 题库/变体池里找不到`);
      continue;
    }
    if (hit.kind === 'variant' && variantModeOf(hit.v!) === 'presentation') {
      errors.push(`${a.id}: runtime（presentation）变体不得声明测量面`);
      continue;
    }
    if (isCt) {
      const value = a.cognitiveTask as CognitiveTask;
      if (hit.kind === 'question') hit.q!.cognitiveTask = value;
      else hit.v!.cognitiveTask = value;
    } else {
      const value: Assessment = { target: a.target!, reasoningGoal: a.reasoningGoal! };
      if (hit.kind === 'question') hit.q!.assessment = value;
      else hit.v!.assessment = value;
    }
    applied.push(a);
  }

  if (errors.length > 0) {
    console.error(`✗ ${errors.length} 条不合规，本次未写入任何文件：`);
    for (const e of errors.slice(0, 20)) console.error(`  · ${e}`);
    process.exit(1);
  }

  if (dryRun) {
    console.log(`--dry-run：将写入 ${applied.length} 条，未改动文件。`);
    for (const a of applied.slice(0, 5)) {
      console.log(isCt ? `  ${a.id} → ${a.cognitiveTask}` : `  ${a.id}\n    target: ${a.target}`);
    }
    return;
  }

  let filesChanged = 0;
  for (const f of files) {
    if (!f.questions.some((q) => applied.some((a) => a.id === q.id))) continue;
    writeFileSync(f.path, `${JSON.stringify(f.questions, null, 2)}\n`, 'utf8');
    filesChanged++;
  }
  for (const f of variantFiles) {
    const touched = Object.values(f.pool.variants ?? {}).some((vs) => vs.some((v) => applied.some((a) => a.id === v.id)));
    if (!touched) continue;
    writeFileSync(f.path, `${JSON.stringify(f.pool, null, 2)}\n`, 'utf8');
    filesChanged++;
  }
  console.log(`✓ 写入 ${applied.length} 条，改动 ${filesChanged} 个文件。`);
}

// ── --status ──
function status(): void {
  const q = readQuestions().flatMap((f) => f.questions);
  const v = readVariants().flatMap((f) => Object.values(f.pool.variants ?? {}).flat());
  const qWith = q.filter((x) => x.assessment).length;
  const qTask = q.filter((x) => x.cognitiveTask).length;
  const vDeclared = v.filter((x) => x.assessment).length;
  const vPresentation = v.filter((x) => variantModeOf(x) === 'presentation').length;
  console.log(`题目  : ${qWith}/${q.length} 带 assessment（缺 ${q.length - qWith}）`);
  console.log(`        ${qTask}/${q.length} 带 cognitiveTask（缺 ${q.length - qTask}）`);
  console.log(`变体  : ${vDeclared}/${v.length} 自声明（其余 ${v.length - vDeclared} 条继承 canonical）`);
  console.log(`        其中 runtime/presentation 变体 ${vPresentation} 条，按 ADR-077 恒继承、不应声明。`);
}

const kindArg = (arg('kind') ?? 'both') as 'question' | 'variant' | 'both';
const fieldArg = arg('field') ?? 'assessment';
if (has('dump')) dump(kindArg, arg('out') ?? 'temp/assessment-pending.json', fieldArg);
else if (has('apply')) apply(arg('file') ?? 'temp/assessment-authored.json', has('dry-run'), fieldArg);
else if (has('status')) status();
else {
  console.error(
    '用法：--dump [--kind=question|variant] [--field=assessment|cognitive-task] [--out=...] | ' +
      '--apply --file=... [--field=...] [--dry-run] | --status',
  );
  process.exit(2);
}
