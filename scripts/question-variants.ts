/// <reference types="vite/client" />
// scripts/question-variants.ts —— 离线变体池生成器（双模式 Variant 设计的 Offline 路径）。
//
// 设计红线（见用户设计 spec + docs/DECISIONS.md）：
//   - 变体作为题库资产（离线预生成、提交进仓库），训练时零 LLM 直接落地；
//   - 复用 ai/variant.generateVariant（不写第二套 LLM 实现）+ domain/variant.validateVariant（全链路唯一校验门禁）；
//   - 离线比 runtime 更严格：多候选 → 严格校验 → fuzzball 去重 → 达 count 即停；
//   - 变体**不写回** Question JSON，单独落 src/data/variants/<slug>.json（按 batch 聚合）；
//   - 运行时生成结果不落盘（那是 Runtime 路径的事，本脚本只产出离线资产）。
//
// 运行（vite-node 才能解析 src 里的 import.meta.glob 题库/变体池）：
//   VARIANT_API_KEY=sk-xxx VARIANT_MODEL=deepseek-chat \
//     npx vite-node scripts/question-variants.ts --ids q-1,q-2 --count 2
//   npx vite-node scripts/question-variants.ts --topics transformer-attention --missing-only --concurrency 4
//   npx vite-node scripts/question-variants.ts --dry-run --ids q-1   # 不联网、不落盘，仅打印计划
//
// 参数：
//   --ids <csv>          只生成指定题目 id（逗号分隔）
//   --topics <csv>       只生成指定 topic 的题目
//   --count <n>          每题变体数量（默认 2）
//   --kind <k>           固定风格：surface|context|surface-options|context-options（默认按 4 种轮换）
//   --missing-only       仅生成池里还没有任何变体的题目
//   --stale              额外纳入「池中已有 stale 变体」的题目（重新生成）
//   --dry-run            不联网、不落盘，仅打印将生成的计划
//   --concurrency <n>    并发题数（默认 1，串行）
//   --prompt-version <v> 覆盖 promptVersion（默认从 VARIANT_SYSTEM 解析）
//   --out <dir>          输出目录（默认 src/data/variants）
//   --help               打印帮助

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { callLLM } from '../src/ai/pi';
import { generateVariant, VARIANT_PROMPT_VERSION } from '../src/ai/variant';
import { validateVariant } from '../src/domain/variant';
import { getAvailableVariants, isVariantStale } from '../src/domain/variantPool';
import { normalizeOptionText } from '../src/domain/options';
import { computeVariantSourceHash } from '../src/schemas/variant';
import {
  variantPoolSchema,
  type VariantPool,
  type QuestionVariant,
  type VariantKind,
} from '../src/schemas/variant';
import { questionBank } from '../src/data/questionBank';
import { variantPool } from '../src/data/variantBank';
import { isEntryValid } from '../src/ai/provider';
import type { ProviderEntry } from '../src/schemas/ai-config';
import type { CompleteFn } from '../src/types';
import type { Question } from '../src/schemas/question';
import * as fuzz from 'fuzzball';

const KIND_ORDER: VariantKind[] = ['surface', 'context', 'surface-options', 'context-options'];
/** 变体-vs-变体近重复阈值（token_set_ratio）：≥ 此值视为重复、丢弃候选。 */
const DUP_THRESHOLD = 88;

interface CliOptions {
  ids?: string[];
  topics?: string[];
  count: number;
  kind?: VariantKind;
  missingOnly: boolean;
  stale: boolean;
  dryRun: boolean;
  concurrency: number;
  promptVersion?: string;
  out: string;
}

function parseArgs(argv: string[]): CliOptions {
  const out: CliOptions = {
    count: 2,
    missingOnly: false,
    stale: false,
    dryRun: false,
    concurrency: 1,
    out: 'src/data/variants',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else if (a === '--ids') out.ids = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--topics') out.topics = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--count') out.count = Math.max(1, Number(next()) || 2);
    else if (a === '--kind') {
      const k = next() as VariantKind;
      if (!KIND_ORDER.includes(k)) {
        console.error(`✗ 非法 --kind：${k}（可选 ${KIND_ORDER.join(' | ')}）`);
        process.exit(1);
      }
      out.kind = k;
    } else if (a === '--missing-only') out.missingOnly = true;
    else if (a === '--stale') out.stale = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--concurrency') out.concurrency = Math.max(1, Number(next()) || 1);
    else if (a === '--prompt-version') out.promptVersion = next();
    else if (a === '--out') out.out = next();
    else {
      console.error(`✗ 未知参数：${a}`);
      process.exit(1);
    }
  }
  return out;
}

function printHelp(): void {
  console.log(`离线变体池生成器（vite-node 运行）

用法：npx vite-node scripts/question-variants.ts [选项]

选项：
  --ids <csv>          只生成指定题目 id
  --topics <csv>       只生成指定 topic 的题目
  --count <n>          每题变体数量（默认 2）
  --kind <k>           固定风格：surface|context|surface-options|context-options
  --missing-only       仅生成池里还没有任何变体的题目
  --stale              额外纳入「池中已有 stale 变体」的题目
  --dry-run            不联网、不落盘，仅打印计划
  --concurrency <n>    并发题数（默认 1）
  --prompt-version <v> 覆盖 promptVersion（默认从 VARIANT_SYSTEM 解析）
  --out <dir>          输出目录（默认 src/data/variants）
  --help               打印本帮助

环境变量（真实生成时需要）：
  VARIANT_PROVIDER / VARIANT_MODEL / VARIANT_API_KEY
  （或 AI_PROVIDER_ID / AI_PROVIDER_MODEL / AI_PROVIDER_API_KEY）
  VARIANT_BASE_URL / VARIANT_ACCOUNT_ID 可选`);
}

function loadProviderEntry(): ProviderEntry {
  const id = (process.env.VARIANT_PROVIDER ?? process.env.AI_PROVIDER_ID) as ProviderEntry['id'] | undefined;
  const model = process.env.VARIANT_MODEL ?? process.env.AI_PROVIDER_MODEL;
  const apiKey = process.env.VARIANT_API_KEY ?? process.env.AI_PROVIDER_API_KEY;
  const baseUrl = process.env.VARIANT_BASE_URL ?? process.env.AI_PROVIDER_BASE_URL;
  const accountId = process.env.VARIANT_ACCOUNT_ID ?? process.env.AI_PROVIDER_ACCOUNT_ID;
  if (!id || !model || !apiKey) {
    throw new Error(
      '缺少 provider 配置：请设置 VARIANT_PROVIDER / VARIANT_MODEL / VARIANT_API_KEY（或 AI_PROVIDER_*）环境变量。\n' +
        '  例：VARIANT_API_KEY=sk-xxx VARIANT_MODEL=deepseek-chat npx vite-node scripts/question-variants.ts',
    );
  }
  const entry: ProviderEntry = {
    id,
    enabled: true,
    model,
    apiKey,
    ...(baseUrl ? { baseUrl } : {}),
    ...(accountId ? { accountId } : {}),
  };
  if (!isEntryValid(entry)) {
    throw new Error(`provider 配置非法：${JSON.stringify({ id, hasModel: Boolean(model), hasKey: Boolean(apiKey) })}`);
  }
  return entry;
}

/** 用于去重的指纹文本：题干 + 选项（规范化后）。 */
function fingerprint(question: string, options?: string[]): string {
  const opts = (options ?? []).map(normalizeOptionText).join(' | ');
  return `${normalizeOptionText(question)} || ${opts}`;
}

function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function deriveSlug(opts: CliOptions): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '');
  if (opts.ids?.length) return `ids-${shortHash(opts.ids.join(','))}`;
  if (opts.topics?.length) return `topics-${shortHash(opts.topics.join(','))}`;
  return `batch-${stamp}`;
}

interface QuestionResult {
  questionId: string;
  format: 'choice' | 'open';
  variants: QuestionVariant[];
  candidates: number;
  rejected: number;
  duplicates: number;
}

interface ProduceCtx {
  opts: CliOptions;
  complete: CompleteFn | null;
  slug: string;
  promptVersion: string;
}

async function produceForQuestion(q: Question, ctx: ProduceCtx): Promise<QuestionResult> {
  const format: 'choice' | 'open' = q.formats.choice ? 'choice' : 'open';
  const existing = getAvailableVariants(variantPool, q.id);
  const usedTexts = new Set<string>(existing.map((v) => fingerprint(v.question, v.options)));
  const produced: QuestionVariant[] = [];
  const stats = { candidates: 0, rejected: 0, duplicates: 0 };
  const budget = ctx.opts.count * 4;
  let seq = existing.length;

  if (ctx.opts.dryRun) {
    const kinds = ctx.opts.kind
      ? [ctx.opts.kind]
      : KIND_ORDER.slice(0, ctx.opts.count);
    console.log(
      `  · ${q.id} [${format}]  → 计划 ${ctx.opts.count} 个变体（风格：${kinds.join(', ')}；已有 ${existing.length} 条）`,
    );
    return { questionId: q.id, format, variants: [], ...stats };
  }

  while (produced.length < ctx.opts.count && stats.candidates < budget) {
    const kind = ctx.opts.kind ?? KIND_ORDER[produced.length % KIND_ORDER.length];
    let gen;
    try {
      gen = await generateVariant(q, ctx.complete!, format, undefined, kind);
    } catch (err) {
      stats.candidates++;
      stats.rejected++;
      console.warn(`    ✗ ${q.id} LLM 调用失败（${kind}）：${(err as Error).message}`);
      continue;
    }
    stats.candidates++;
    const check = validateVariant(q, gen, format);
    if (!check.ok) {
      stats.rejected++;
      console.warn(`    ✗ ${q.id} 校验未过（${kind}）：${check.code} ${check.reason ?? ''}`);
      continue;
    }
    const text = fingerprint(gen.question, gen.options);
    let dup = false;
    for (const b of usedTexts) {
      if (fuzz.token_set_ratio(text, b) >= DUP_THRESHOLD) {
        dup = true;
        break;
      }
    }
    if (dup) {
      stats.duplicates++;
      console.warn(`    • ${q.id} 近重复被丢弃（${kind}）`);
      continue;
    }
    usedTexts.add(text);
    produced.push({
      id: `${q.id}__${kind}__${ctx.slug}__${seq++}`,
      kind,
      question: gen.question,
      options: q.formats.choice ? gen.options : undefined,
      generatedAt: Date.now(),
      generator: 'offline',
      promptVersion: ctx.promptVersion,
      sourceHash: computeVariantSourceHash({
        id: q.id,
        question: q.question,
        options: q.formats.choice?.options,
      }),
    });
  }

  if (produced.length < ctx.opts.count) {
    console.warn(
      `    ⚠ ${q.id} 仅生成 ${produced.length}/${ctx.opts.count} 条（候选 ${stats.candidates}，拒绝 ${stats.rejected}，重复 ${stats.duplicates}）`,
    );
  } else {
    console.log(
      `    ✓ ${q.id} 生成 ${produced.length} 条（候选 ${stats.candidates}，拒绝 ${stats.rejected}，重复 ${stats.duplicates}）`,
    );
  }
  return { questionId: q.id, format, variants: produced, ...stats };
}

function selectTargets(opts: CliOptions): Question[] {
  let qs = questionBank.questions;
  if (opts.ids) {
    const set = new Set(opts.ids);
    qs = qs.filter((q) => set.has(q.id));
  }
  if (opts.topics) {
    const set = new Set(opts.topics);
    qs = qs.filter((q) => set.has(q.topic));
  }
  const missing = new Set(
    questionBank.questions.filter((q) => getAvailableVariants(variantPool, q.id).length === 0).map((q) => q.id),
  );
  const staleQs = new Set(
    questionBank.questions
      .filter((q) => getAvailableVariants(variantPool, q.id).some((v) => isVariantStale(v, q)))
      .map((q) => q.id),
  );
  qs = qs.filter(
    (q) => (opts.missingOnly ? missing.has(q.id) : true) || (opts.stale ? staleQs.has(q.id) : false),
  );
  return qs;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const slug = deriveSlug(opts);
  const promptVersion = opts.promptVersion ?? VARIANT_PROMPT_VERSION;

  const targets = selectTargets(opts);
  if (targets.length === 0) {
    console.error('✗ 没有匹配的题目（检查 --ids/--topics/--missing-only/--stale）');
    process.exit(1);
  }

  console.log(
    `▶ 离线变体生成：${targets.length} 题，每题 ${opts.count} 个，风格=${opts.kind ?? '轮换4种'}，promptVersion=${promptVersion}` +
      `${opts.dryRun ? '  [DRY-RUN]' : ''}\n`,
  );

  const providerEntry = opts.dryRun ? ({} as ProviderEntry) : loadProviderEntry();
  const complete: CompleteFn | null = opts.dryRun
    ? null
    : (system, user) => callLLM(providerEntry, system, user, { jsonMode: true });

  const ctx: ProduceCtx = { opts, complete, slug, promptVersion };
  const queue = targets.slice();

  const workers = Array.from({ length: Math.min(opts.concurrency, targets.length) }, async () => {
    const local: QuestionResult[] = [];
    let q: Question | undefined;
    while ((q = queue.shift())) local.push(await produceForQuestion(q, ctx));
    return local;
  });
  const rows = (await Promise.all(workers)).flat();

  const totalVariants = rows.reduce((s, r) => s + r.variants.length, 0);
  const totalCandidates = rows.reduce((s, r) => s + r.candidates, 0);
  const totalRejected = rows.reduce((s, r) => s + r.rejected, 0);
  const totalDuplicates = rows.reduce((s, r) => s + r.duplicates, 0);

  if (opts.dryRun) {
    console.log(
      `\n[DRY-RUN] 计划生成 ${totalVariants} 条变体（不联网、不落盘）。` +
        ` 将写入：${resolve(process.cwd(), opts.out, `${slug}.json`)}`,
    );
    return;
  }

  if (totalVariants === 0) {
    console.log('\n⚠ 未生成任何变体（候选全部被拒或近重复），未写入文件。');
    return;
  }

  const variants: Record<string, QuestionVariant[]> = {};
  for (const r of rows) {
    if (r.variants.length > 0) variants[r.questionId] = r.variants;
  }
  const pool: VariantPool = {
    version: 1,
    generatedAt: Date.now(),
    promptVersion,
    variants,
  };
  const parsed = variantPoolSchema.safeParse(pool);
  if (!parsed.success) {
    console.error('✗ 生成的变体池未通过 schema 校验：', parsed.error.issues);
    process.exit(1);
  }

  const dir = resolve(process.cwd(), opts.out);
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, `${slug}.json`);
  writeFileSync(file, JSON.stringify(parsed.data, null, 2), 'utf8');

  console.log('\n── 汇总 ──');
  console.log(`  题目数      : ${targets.length}`);
  console.log(`  生成变体数  : ${totalVariants}`);
  console.log(`  LLM 候选数  : ${totalCandidates}`);
  console.log(`  校验拒绝    : ${totalRejected}`);
  console.log(`  近重复丢弃  : ${totalDuplicates}`);
  console.log(`  输出文件    : ${file}`);
  console.log(`\n提示：下次训练会自动经 import.meta.glob 合并本文件；可用 npx vite-node scripts/validate-variants.ts 校验池。`);
}

main().catch((e) => {
  console.error('变体生成异常：', e);
  process.exit(1);
});
