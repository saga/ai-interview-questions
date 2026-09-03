/// <reference types="vite/client" />
// scripts/question-variants.ts —— 离线变体池生成器（双模式 Variant 设计的 Offline 路径）。
//
// 设计红线（见用户设计 spec + docs/DECISIONS.md）：
//   - 变体作为题库资产（离线预生成、提交进仓库），训练时零 LLM 直接落地；
//   - 复用 ai/variant.generateVariant（不写第二套 LLM 实现）+ domain/variant.validateVariant（全链路唯一校验门禁）；
//   - 离线比 runtime 更严格：**超采—漏斗**（A-10）── 先生成 count × oversample 个候选，
//     过 validateVariant（确定性）+ 去重，再由 variantChallenger 五维质询打分，
//     按分排序取 top count 落盘。不再「先到先得」——因为通过硬门槛 ≠ 是好变体；
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
//   --oversample <n>      超采倍数：先生成 count × n 个候选再筛到 count（默认 3；设 1 = 不超采）
//   --no-challenger       跳过 quality challenger（只跑确定性门禁 + 去重，先到先得）
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
import { challengeVariant, type VariantShape } from '../src/ai/variantChallenger';
import { getAvailableVariants, isVariantStale } from '../src/domain/variantPool';
import { computeVariantSourceHash, variantSourceOf } from '../src/schemas/variant';
import {
  variantPoolSchema,
  type VariantPool,
  type QuestionVariant,
  type VariantKind,
} from '../src/schemas/variant';
import { questionBank } from '../src/data/questionBank';
import { variantPool } from '../src/data/variantBank';
import { isEntryValid } from '../src/ai/provider';
import { validateVariant, variantOptionText, VARIANT_DUP_THRESHOLD } from '../src/domain/variant';
import { checkLanguageSanity, formatSanityIssues } from '../src/domain/languageSanity';
// cjkDice 定义在 domain/textSimilarity（variant.ts 只 import 未 re-export），
// 去重度量必须与 validate-variants.ts / domain 用的是同一个实现，故直接从源头导入。
import { cjkDice } from '../src/domain/textSimilarity';
import type { ProviderEntry } from '../src/schemas/ai-config';
import type { CompleteFn } from '../src/types';
import type { Question } from '../src/schemas/question';

const KIND_ORDER: VariantKind[] = ['surface', 'context', 'surface-options', 'context-options'];

interface CliOptions {
  ids?: string[];
  topics?: string[];
  count: number;
  oversample: number;
  challenger: boolean;
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
    // 超采倍数 3：目标 5 条就生成 15 个候选再筛。质询器会误杀（宁严勿松），
    // 不超采则一旦某题候选质量普遍偏低就只能留下次品或留不满。
    oversample: 3,
    challenger: true,
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
    else if (a === '--oversample') out.oversample = Math.max(1, Number(next()) || 3);
    else if (a === '--no-challenger') out.challenger = false;
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
  --oversample <n>     超采倍数：先生成 count × n 个候选再筛到 count（默认 3）
  --no-challenger      跳过 quality challenger（只跑确定性门禁 + 去重，先到先得）
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

/** 用于去重的指纹文本：仅选项（规范化后），复用 domain 的 variantOptionText。
 *  近重复门禁只比对选项——题干本就该随变体不同，不应计入相似度。 */
function fingerprint(_question: string, options?: string[]): string {
  return variantOptionText({ options });
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
  /** 被确定性语言质量门禁（language sanity）否掉的候选数 */
  sanity: number;
  duplicates: number;
  /** 通过确定性门禁 + 去重、进入质询阶段的候选数 */
  survived: number;
  /** 被 quality challenger 否掉的候选数 */
  challenged: number;
}

interface ProduceCtx {
  opts: CliOptions;
  complete: CompleteFn | null;
  slug: string;
  promptVersion: string;
}

/** 质询后的候选，带打分，用于排序取 top-N。 */
interface ScoredCandidate {
  kind: VariantKind;
  shape: VariantShape;
  score: number;
  summary: string;
}

async function produceForQuestion(q: Question, ctx: ProduceCtx): Promise<QuestionResult> {
  const format: 'choice' | 'open' = q.formats.choice ? 'choice' : 'open';
  const existing = getAvailableVariants(variantPool, q.id);
  const usedTexts = new Set<string>(existing.map((v) => fingerprint(v.question, v.options)));
  const stats = { candidates: 0, rejected: 0, sanity: 0, duplicates: 0, survived: 0, challenged: 0 };
  const want = ctx.opts.count;
  // 超采：目标 want 条，先生成 want × oversample 个候选。（A-10）
  // 旧实现是「生成到够数为止」，先到先得——通过硬门槛的次品会挤掉后面更好的候选。
  const budget = want * ctx.opts.oversample;
  let seq = existing.length;

  if (ctx.opts.dryRun) {
    const kinds = ctx.opts.kind
      ? [ctx.opts.kind]
      : KIND_ORDER.slice(0, ctx.opts.count);
    const funnel = ctx.opts.challenger
      ? `超采 ${budget} 候选 → 质询筛选 → 取 top ${want}`
      : `生成 ${budget} 候选 → 先到先得取 ${want}（challenger 已关闭）`;
    console.log(
      `  · ${q.id} [${format}]  → 计划 ${ctx.opts.count} 个变体（风格：${kinds.join(', ')}；已有 ${existing.length} 条；${funnel}）`,
    );
    return { questionId: q.id, format, variants: [], ...stats };
  }

  // ── 阶段 1：超采 + 确定性门禁 + 去重 ──
  const survivors: Array<{ kind: VariantKind; shape: VariantShape }> = [];
  while (survivors.length < budget && stats.candidates < budget * 2) {
    const kind = ctx.opts.kind ?? KIND_ORDER[stats.candidates % KIND_ORDER.length];
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
    // 语言质量门禁（确定性，零 LLM 成本）：必须排在 5D challenger **之前**。
    // 理由：challenger 被告知了标准答案，只回答「结论还在不在」，
    // 天然看不见语言质量——实测 42 条翻译腔变体它一条都没拦住（最小 dice 39 > 阈值 35）。
    // 先用零成本的纯函数筛掉语言垃圾，再让昂贵的 LLM 质询去看语义。
    const sanity = checkLanguageSanity(
      { stem: gen.question, options: gen.options },
      { stem: q.question, options: format === 'choice' ? q.formats.choice?.options : undefined },
    );
    if (!sanity.ok) {
      stats.sanity++;
      console.warn(`    ✗ ${q.id} 语言质量未过（${kind}）：${formatSanityIssues(sanity)}`);
      continue;
    }
    const text = fingerprint(gen.question, gen.options);
    let dup = false;
    for (const b of usedTexts) {
      if (cjkDice(text, b) >= VARIANT_DUP_THRESHOLD) {
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
    survivors.push({ kind, shape: { question: gen.question, options: gen.options } });
  }
  stats.survived = survivors.length;

  // ── 阶段 2：quality challenger 打分（离线才付得起；--no-challenger 可关闭）──
  let ranked: ScoredCandidate[];
  if (!ctx.opts.challenger) {
    ranked = survivors.map((s) => ({ ...s, score: 1, summary: 'challenger 已关闭' }));
  } else {
    const scored: ScoredCandidate[] = [];
    for (const s of survivors) {
      let ch;
      try {
        ch = await challengeVariant(q, s.shape, format, ctx.complete!);
      } catch (err) {
        // 质询调用失败按不合格处理：宁可少留一条，也不要把未经验证的变体永久落盘。
        stats.challenged++;
        console.warn(`    ✗ ${q.id} 质询调用失败（${s.kind}）：${(err as Error).message}`);
        continue;
      }
      if (!ch.ok) {
        stats.challenged++;
        console.warn(`    ✗ ${q.id} 质询未过（${s.kind}）：${ch.failed.join(',')} — ${ch.summary.slice(0, 80)}`);
        continue;
      }
      scored.push({ ...s, score: ch.score, summary: ch.summary });
    }
    ranked = scored;
  }

  // ── 阶段 3：取 top want 落盘 ──
  const kept = ranked.slice(0, want);
  const produced: QuestionVariant[] = kept.map((c) => ({
    id: `${q.id}__${c.kind}__${ctx.slug}__${seq++}`,
    kind: c.kind,
    question: c.shape.question,
    options: q.formats.choice ? c.shape.options : undefined,
    generatedAt: Date.now(),
    generator: 'offline' as const,
    promptVersion: ctx.promptVersion,
    sourceHash: computeVariantSourceHash(variantSourceOf(q)),
  }));

  if (produced.length < want) {
    console.warn(
      `    ⚠ ${q.id} 仅生成 ${produced.length}/${want} 条（候选 ${stats.candidates}，校验拒 ${stats.rejected}，` +
        `语言拒 ${stats.sanity}，重复 ${stats.duplicates}，过闸 ${stats.survived}，质询否 ${stats.challenged}）`,
    );
  } else {
    console.log(
      `    ✓ ${q.id} 生成 ${produced.length} 条（候选 ${stats.candidates}，校验拒 ${stats.rejected}，` +
        `语言拒 ${stats.sanity}，重复 ${stats.duplicates}，过闸 ${stats.survived}，质询否 ${stats.challenged}）`,
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
  const totalSanity = rows.reduce((s, r) => s + r.sanity, 0);
  const totalDuplicates = rows.reduce((s, r) => s + r.duplicates, 0);
  const totalSurvived = rows.reduce((s, r) => s + r.survived, 0);
  const totalChallenged = rows.reduce((s, r) => s + r.challenged, 0);

  if (opts.dryRun) {
    // dry-run 下 produceForQuestion 不产出 variants（也不联网），故用计划数而非实际数。
    const planned = targets.length * opts.count;
    const plannedCandidates = planned * opts.oversample;
    const funnel = opts.challenger
      ? `先超采 ${plannedCandidates} 个候选，经校验/去重/质询后取 top ${opts.count}/题`
      : `生成 ${plannedCandidates} 个候选，经校验/去重后先到先得取 ${opts.count}/题（challenger 已关闭）`;
    console.log(
      `\n[DRY-RUN] 计划生成 ${planned} 条变体（${targets.length} 题 × ${opts.count}；${funnel}）。不联网、不落盘。\n` +
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
  console.log(`  校验拒绝    : ${totalRejected}（结构/漂移）`);
  console.log(`  语言质量拒绝: ${totalSanity}（确定性门禁，先于质询）`);
  console.log(`  近重复丢弃  : ${totalDuplicates}`);
  console.log(`  过闸候选    : ${totalSurvived}${opts.challenger ? '（进入质询）' : ''}`);
  if (opts.challenger) {
    const keepRate = totalSurvived > 0 ? ((totalSurvived - totalChallenged) / totalSurvived) * 100 : 0;
    console.log(`  质询否决    : ${totalChallenged}（留存率 ${keepRate.toFixed(1)}%）`);
  } else {
    console.log('  质询否决    : —（--no-challenger，先到先得）');
  }
  console.log(`  超采倍数    : ${opts.oversample}（目标 ${targets.length * opts.count} 条，候选 ${targets.length * opts.count * opts.oversample}）`);
  console.log(`  输出文件    : ${file}`);
  console.log(`\n提示：下次训练会自动经 import.meta.glob 合并本文件；可用 npx vite-node scripts/validate-variants.ts 校验池。`);
}

main().catch((e) => {
  console.error('变体生成异常：', e);
  process.exit(1);
});
