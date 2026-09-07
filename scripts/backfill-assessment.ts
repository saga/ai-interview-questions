// npm run question:assessment —— 测量意图（`assessment.target` / `reasoningGoal`）的覆盖率报告与回填。
//
// 背景：`assessment` 是 plan0907 / 外部评审 P0-2 引入的 question-level 元数据，新管线
// （`convert-blueprint-output.ts`）会落库，但存量题目走的是旧管线 —— 1354 题 + 100 变体全空。
// 字段空着，人工审题看不到「这道题原本要测什么判断」，variant challenger 也无法比对两条
// reasoning path 是否真的不同。
//
// 两种 producer：
//   --engine=infer（默认，离线）  由 src/domain/assessmentInference.ts 从解析/选项**抽取**。
//                                 每段文字都可追溯到题面已有内容；抽不到核心断言句就跳过。
//   --engine=llm                  接 provider 真正生成。
//                                 环境变量：ASSESSMENT_PROVIDER / _MODEL / _API_KEY / _BASE_URL
//                                 （缺省回退 CHALLENGER_*）。LLM 分支动态 import src/ai/pi，
//                                 该模块走浏览器打包路径，故 llm 模式须用 vite-node：
//                                   npx vite-node scripts/backfill-assessment.ts --write --engine=llm
//
// 用法：
//   npm run question:assessment                                  # 覆盖率报告
//   npm run question:assessment -- --json --top=10               # 机器可读
//   npm run question:assessment -- --write --dry-run             # 预览将写入什么
//   npm run question:assessment -- --write --topic=rag           # 只回填某个知识点
//   npm run question:assessment -- --write --overwrite           # 覆盖已有 assessment
//
// 注意：`--key=value` 与 `--key value` 都支持 —— `npm run x -- --topic=rag` 传入的是**单个**
// token，只认后者会静默丢掉整个参数。

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { Assessment } from '../src/schemas/common.ts';
import type { Question } from '../src/schemas/question.ts';
import type { QuestionVariant } from '../src/schemas/variant.ts';
import { cjkDice } from '../src/domain/textSimilarity.ts';
import {
  DEFAULT_MIN_CONFIDENCE,
  inferAssessment,
  type AssessmentInferenceInput,
} from '../src/domain/assessmentInference.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const questionsDir = resolve(root, 'src/data/questions');
const variantsDir = resolve(root, 'src/data/variants');

/** 变体选项 ↔ canonical 正确项的匹配阈值（cjkDice，%）。变体是逐项改写，不做字面相等。 */
const VARIANT_OPTION_MATCH = 50;

interface Options {
  write: boolean;
  dryRun: boolean;
  overwrite: boolean;
  engine: 'infer' | 'llm';
  minConfidence: number;
  concurrency: number;
  topic?: string;
  ids: string[];
  limit: number;
  json: boolean;
  top: number;
  out: string;
  only: 'both' | 'questions' | 'variants';
}

// 同时支持 --key=value 与 --key value。
function parseArgs(argv: string[]): Options {
  const get = (name: string): string | undefined => {
    const inline = argv.find((a) => a.startsWith(`--${name}=`));
    if (inline !== undefined) return inline.slice(name.length + 3);
    const i = argv.indexOf(`--${name}`);
    const next = i >= 0 ? argv[i + 1] : undefined;
    return next !== undefined && !next.startsWith('--') ? next : undefined;
  };
  const has = (name: string) => argv.includes(`--${name}`) || argv.some((a) => a === `--${name}=true`);
  const engine = get('engine') ?? 'infer';
  if (engine !== 'infer' && engine !== 'llm') {
    console.error(`--engine 非法：${engine}（可选 infer / llm）`);
    process.exit(2);
  }
  const only = get('only') ?? 'both';
  if (!['both', 'questions', 'variants'].includes(only)) {
    console.error(`--only 非法：${only}（可选 both / questions / variants）`);
    process.exit(2);
  }
  const rawLimit = get('limit');
  return {
    write: has('write'),
    dryRun: has('dry-run'),
    overwrite: has('overwrite'),
    engine,
    minConfidence: Number(get('min-confidence') ?? DEFAULT_MIN_CONFIDENCE),
    concurrency: Number(get('concurrency') ?? 4),
    topic: get('topic'),
    ids: (get('ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    limit: rawLimit === undefined ? Number.POSITIVE_INFINITY : Number(rawLimit),
    json: has('json'),
    top: Number(get('top') ?? 10),
    out: get('out') ?? `temp/assessment-backfill-${new Date().toISOString().slice(0, 10)}.json`,
    only: only as Options['only'],
  };
}

// ── 读取 ──

interface QuestionFile {
  path: string;
  questions: Question[];
}

function readQuestionFiles(): QuestionFile[] {
  return readdirSync(questionsDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const path = resolve(questionsDir, f);
      return { path, questions: JSON.parse(readFileSync(path, 'utf8')) as Question[] };
    });
}

interface VariantPoolFile {
  version: 1;
  generatedAt: number;
  promptVersion: string;
  variants: Record<string, QuestionVariant[]>;
}

interface VariantFile {
  path: string;
  pool: VariantPoolFile;
}

function readVariantFiles(): VariantFile[] {
  return readdirSync(variantsDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const path = resolve(variantsDir, f);
      return { path, pool: JSON.parse(readFileSync(path, 'utf8')) as VariantPoolFile };
    });
}

/** 从选择题里拆出正确项与干扰项文本。 */
function splitOptions(q: Question): { correctOptions: string[]; distractors: string[] } | null {
  const choice = q.formats?.choice;
  if (!choice) return null;
  const answer = new Set(choice.answer);
  return {
    correctOptions: choice.options.filter((_, i) => answer.has(i)),
    distractors: choice.options.filter((_, i) => !answer.has(i)),
  };
}

// ── 候选 ──

interface Candidate {
  kind: 'question' | 'variant';
  id: string;
  topic: string;
  /** infer 的产出；llm 模式会覆盖它。 */
  assessment: Assessment;
  confidence: number;
  signals: string[];
  /** 喂给 LLM 的原始上下文（llm 模式用）。 */
  input: AssessmentInferenceInput;
}

function inferForQuestion(q: Question): Candidate | null {
  const split = splitOptions(q);
  if (!split) return null;
  const input: AssessmentInferenceInput = {
    question: q.question,
    explanation: q.explanation,
    angle: q.angle,
    cognitiveTask: q.cognitiveTask,
    correctOptions: split.correctOptions,
    distractors: split.distractors,
  };
  const r = inferAssessment(input);
  if (!r) return null;
  return {
    kind: 'question',
    id: q.id,
    topic: q.topic,
    assessment: { target: r.target, reasoningGoal: r.reasoningGoal },
    confidence: r.confidence,
    signals: r.signals,
    input,
  };
}

/**
 * 变体自身没有 answer（只有 options），正确项要靠与 canonical 的语义匹配还原。
 * canonical 找不到 / 不是选择题时返回 null —— 宁可跳过，也不猜。
 *
 * 另外：推导结果与 canonical 完全相同时**不声明**（返回 null，让变体继承 canonical）。
 * ADR-077 里 variant 的意义就是「同一 Knowledge 的不同 reasoning path」，声明一条和
 * canonical 一模一样的测量意图等于自证这条变体是 presentation rewrite——那它本就不该
 * 声明测量面（`question:validate-variants` 会把这类条目列进审计清单）。
 */
function inferForVariant(v: QuestionVariant, canonicalId: string, bank: Map<string, Question>): Candidate | null {
  const canonical = bank.get(canonicalId);
  const split = canonical ? splitOptions(canonical) : null;
  if (!canonical || !split || !v.options) return null;

  const correctOptions: string[] = [];
  const distractors: string[] = [];
  for (const option of v.options) {
    const best = Math.max(0, ...split.correctOptions.map((c) => cjkDice(option, c)));
    (best >= VARIANT_OPTION_MATCH ? correctOptions : distractors).push(option);
  }
  const input: AssessmentInferenceInput = {
    question: v.question,
    explanation: canonical.explanation,
    angle: v.angle ?? canonical.angle,
    cognitiveTask: v.cognitiveTask ?? canonical.cognitiveTask,
    correctOptions,
    distractors,
  };
  const r = inferAssessment(input);
  if (!r) return null;

  // canonical 的测量意图：优先用它已落库的值，其次现算一份用于比对。
  const canonicalOwn = canonical.assessment ?? inferForQuestion(canonical)?.assessment;
  if (
    canonicalOwn &&
    canonicalOwn.target === r.target &&
    canonicalOwn.reasoningGoal === r.reasoningGoal
  ) {
    return null;
  }

  return {
    kind: 'variant',
    id: v.id,
    topic: canonical.topic,
    assessment: { target: r.target, reasoningGoal: r.reasoningGoal },
    confidence: r.confidence,
    signals: [...r.signals, `canonical:${canonicalId}`],
    input,
  };
}

// ── LLM 引擎（可选）──

const llmResultSchema = z.object({
  target: z.string().min(1),
  reasoningGoal: z.string().min(1),
});

const LLM_SYSTEM = `你是题库测量意图标注器。给定一道题的题干、解析与选项，输出它要测出的判断与要求考生走完的推理链。

严格输出合法 JSON：
{"target":"...","reasoningGoal":"..."}

target：一句话说明这道题要测出的能力或判断（不是知识点的名字，而是"考生必须做出什么判断"）。
reasoningGoal：用"先…；再…；据此…"写出考生为答对必须走完的推理链，必须落到本题的具体内容上。
不要复述选项全文，不要输出额外解释。`;

async function llmAssess(input: AssessmentInferenceInput): Promise<Assessment> {
  const { callLLM } = await import('../src/ai/pi');
  const entry = {
    id: process.env.ASSESSMENT_PROVIDER ?? process.env.CHALLENGER_PROVIDER ?? 'deepseek',
    enabled: true,
    model: process.env.ASSESSMENT_MODEL ?? process.env.CHALLENGER_MODEL ?? '',
    apiKey: process.env.ASSESSMENT_API_KEY ?? process.env.CHALLENGER_API_KEY ?? '',
    baseUrl: process.env.ASSESSMENT_BASE_URL ?? process.env.CHALLENGER_BASE_URL ?? '',
  };
  const user = [
    `题干：${input.question}`,
    input.explanation ? `解析：${input.explanation}` : '',
    input.correctOptions.length ? `正确项：\n${input.correctOptions.map((s, i) => `${i + 1}. ${s}`).join('\n')}` : '',
    input.distractors.length ? `干扰项：\n${input.distractors.map((s, i) => `${i + 1}. ${s}`).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = await (callLLM as any)(entry, LLM_SYSTEM, user, { jsonMode: true, temperature: 0 });
  const parsed = llmResultSchema.safeParse(JSON.parse(raw as string));
  if (!parsed.success) throw new Error(`LLM 输出不合契约：${parsed.error.message}`);
  return parsed.data;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// ── 主流程 ──

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const files = readQuestionFiles();
  const variantFiles = readVariantFiles();
  const bank = new Map<string, Question>();
  for (const f of files) for (const q of f.questions) bank.set(q.id, q);

  const allQuestions = files.flatMap((f) => f.questions);
  const allVariants = variantFiles.flatMap((f) =>
    Object.entries(f.pool.variants ?? {}).flatMap(([canonicalId, vs]) =>
      vs.map((v) => ({ canonicalId, v, topic: bank.get(canonicalId)?.topic ?? '' })),
    ),
  );

  const inScope = (topic: string, id: string): boolean => {
    if (opts.topic && topic !== opts.topic) return false;
    if (opts.ids.length > 0 && !opts.ids.includes(id)) return false;
    return true;
  };

  // ── 扫描 ──
  const stats = {
    questions: { total: allQuestions.length, withAssessment: 0, inferable: 0, unresolved: 0 },
    variants: { total: allVariants.length, withAssessment: 0, inferable: 0, unresolved: 0 },
    gapTopics: [] as { topic: string; missing: number }[],
  };
  for (const q of allQuestions) if (q.assessment) stats.questions.withAssessment++;
  for (const { v } of allVariants) if (v.assessment) stats.variants.withAssessment++;

  const candidates: Candidate[] = [];
  const gapByTopic = new Map<string, number>();
  /** 扫描范围内每一条的目标值；`undefined` = 应当删除已有 assessment（--overwrite 下的剪枝）。 */
  const planned = new Map<string, Assessment | undefined>();

  if (opts.only !== 'variants') {
    let taken = 0;
    for (const q of allQuestions) {
      if (!inScope(q.topic, q.id)) continue;
      if (q.assessment && !opts.overwrite) continue;
      if (taken >= opts.limit) break;
      taken++;
      const c = inferForQuestion(q);
      const ok = c && c.confidence >= opts.minConfidence ? c : undefined;
      planned.set(`question:${q.id}`, ok?.assessment);
      if (ok) {
        candidates.push(ok);
        stats.questions.inferable++;
      } else {
        stats.questions.unresolved++;
        if (!q.assessment) gapByTopic.set(q.topic, (gapByTopic.get(q.topic) ?? 0) + 1);
      }
    }
  }

  if (opts.only !== 'questions') {
    let taken = 0;
    for (const { canonicalId, v, topic } of allVariants) {
      if (!inScope(topic, v.id)) continue;
      if (v.assessment && !opts.overwrite) continue;
      if (taken >= opts.limit) break;
      taken++;
      const c = inferForVariant(v, canonicalId, bank);
      const ok = c && c.confidence >= opts.minConfidence ? c : undefined;
      planned.set(`variant:${v.id}`, ok?.assessment);
      if (ok) {
        candidates.push(ok);
        stats.variants.inferable++;
      } else {
        stats.variants.unresolved++;
      }
    }
  }

  stats.gapTopics = [...gapByTopic.entries()]
    .map(([topic, missing]) => ({ topic, missing }))
    .sort((a, b) => b.missing - a.missing)
    .slice(0, opts.top);

  const pct = (n: number, d: number): string => (d === 0 ? '0.0' : ((n / d) * 100).toFixed(1));

  if (opts.json) {
    console.log(JSON.stringify({ stats, sample: candidates.slice(0, 3).map((c) => c.assessment) }, null, 2));
    return;
  }

  console.log('── 测量意图（assessment）覆盖率 ──');
  console.log(
    `  题目 : ${stats.questions.total} 题，已落库 ${stats.questions.withAssessment}（${pct(stats.questions.withAssessment, stats.questions.total)}%）` +
      ` · 可推断 ${stats.questions.inferable} · 待 LLM ${stats.questions.unresolved}`,
  );
  console.log(
    `  变体 : ${stats.variants.total} 条，已落库 ${stats.variants.withAssessment}（${pct(stats.variants.withAssessment, stats.variants.total)}%）` +
      ` · 可推断 ${stats.variants.inferable} · 待 LLM ${stats.variants.unresolved}`,
  );
  if (stats.gapTopics.length > 0) {
    console.log(`  推断缺口 top ${stats.gapTopics.length}（抽不到核心断言句，须 LLM 生成）：`);
    for (const g of stats.gapTopics) console.log(`    · ${g.topic}: ${g.missing}`);
  }

  if (!opts.write) {
    console.log('\nℹ 只读报告。加 --write 回填（先 --write --dry-run 预览）。');
    return;
  }
  if (candidates.length === 0) {
    console.log('\n没有可回填的条目。');
    return;
  }

  // ── llm 引擎：覆盖 infer 的产出 ──
  if (opts.engine === 'llm') {
    const failures: string[] = [];
    await mapLimit(candidates, opts.concurrency, async (c) => {
      try {
        c.assessment = await llmAssess(c.input);
        c.signals.push('engine:llm');
      } catch (error) {
        failures.push(`${c.id}: ${error instanceof Error ? error.message : String(error)}`);
        c.signals.push('engine:llm-failed');
      }
    });
    const ok = candidates.length - failures.length;
    console.log(`\nllm 引擎：成功 ${ok} / ${candidates.length}，失败 ${failures.length}`);
    for (const f of failures.slice(0, 5)) console.log(`  ✗ ${f}`);
    if (ok === 0) {
      console.error('llm 引擎全数失败：检查 ASSESSMENT_* / CHALLENGER_* 环境变量，且本模式须用 vite-node 运行。');
      process.exit(1);
    }
    // 失败项保留 infer 产出会混入不同来源，宁可剔除。
    for (let i = candidates.length - 1; i >= 0; i--) {
      if (candidates[i].signals.includes('engine:llm-failed')) candidates.splice(i, 1);
    }
  }

  const pruned = [...planned.values()].filter((a) => a === undefined).length;

  if (opts.dryRun) {
    console.log(
      `\n--dry-run：将写入 ${candidates.length} 条，剪掉 ${pruned} 条已有 assessment，未改动任何文件。前 5 条：`,
    );
    for (const c of candidates.slice(0, 5)) {
      console.log(`\n[${c.kind}] ${c.id}（confidence ${c.confidence.toFixed(2)} · ${c.signals.join(',')}）`);
      console.log(`  target       : ${c.assessment.target}`);
      console.log(`  reasoningGoal: ${c.assessment.reasoningGoal}`);
    }
    return;
  }

  let filesChanged = 0;
  let written = 0;
  let removed = 0;

  /** 按 planned 落值；值为 undefined 表示删除（--overwrite 剪枝）。返回是否发生变化。 */
  const apply = <T extends { assessment?: Assessment }>(entity: T, key: string): boolean => {
    if (!planned.has(key)) return false;
    const next = planned.get(key);
    if (next === undefined) {
      if (entity.assessment === undefined) return false;
      delete entity.assessment;
      removed++;
      return true;
    }
    if (entity.assessment && entity.assessment.target === next.target && entity.assessment.reasoningGoal === next.reasoningGoal) {
      return false;
    }
    entity.assessment = next;
    written++;
    return true;
  };

  for (const f of files) {
    let dirty = false;
    for (const q of f.questions) dirty = apply(q, `question:${q.id}`) || dirty;
    if (dirty) {
      writeFileSync(f.path, `${JSON.stringify(f.questions, null, 2)}\n`, 'utf8');
      filesChanged++;
    }
  }
  for (const f of variantFiles) {
    let dirty = false;
    for (const vs of Object.values(f.pool.variants ?? {})) {
      for (const v of vs) dirty = apply(v, `variant:${v.id}`) || dirty;
    }
    if (dirty) {
      writeFileSync(f.path, `${JSON.stringify(f.pool, null, 2)}\n`, 'utf8');
      filesChanged++;
    }
  }

  const outPath = resolve(process.cwd(), opts.out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: Date.now(),
        engine: opts.engine,
        minConfidence: opts.minConfidence,
        options: { ...opts, limit: String(opts.limit) },
        audit: candidates.map((c) => ({
          id: c.id,
          kind: c.kind,
          topic: c.topic,
          confidence: c.confidence,
          signals: c.signals,
          ...c.assessment,
        })),
      },
      null,
      2,
    ),
    'utf8',
  );

  console.log(`\n✓ 写入 ${written} 条，剪掉 ${removed} 条，改动 ${filesChanged} 个文件。`);
  console.log(`  审计侧车（每条来源与置信度）：${opts.out}`);
  console.log('  下一步：npm run validate:questions 与 npm run question:validate-variants 确认落库无误。');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
