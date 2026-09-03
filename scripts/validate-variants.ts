/// <reference types="vite/client" />
// scripts/validate-variants.ts —— 离线变体池审计 + **发布门禁**（双模式 Variant 设计配套）。
//
// 2026-09-03：从「只读审计报告」升级为**真正的 release gate**（P0-3）。
// 此前它只打印统计、永远 exit 0 —— 池子里有 stale 或近重复也能一路进仓库、进构建。
// 现在：stale > 0 / 近重复 > 0 / 语言质量不合格 > 0 → exit 1，阻断发布。
//
// 三类检查：
//   1. stale       —— canonical 缺失或 sourceHash 对不上（原题已改，变体失真）
//   2. 近重复      —— variant-vs-variant 选项级 CJK-Dice ≥ 阈值（改了等于没改）
//   3. 语言质量    —— 确定性语言门禁（乱码/句读崩坏/从句倒装等，见 domain/languageSanity）
//
// 用法：npx vite-node scripts/validate-variants.ts [--json] [--dup-threshold 88]
//
// 退出码：0 = 池健康；1 = 存在必须处理的问题。
// 过渡期若需「只看不拦」，加 --no-fail（会明确标注退出码被降级，不要用于 CI）。

import { questionBank } from '../src/data/questionBank';
import { variantPool } from '../src/data/variantBank';
import { isVariantStale } from '../src/domain/variantPool';
// 近重复规则与阈值统一由 domain 提供：离线生成器（question-variants / assemble-variants）
// 与本审计脚本共用同一条规则，避免「生成管线拒绝的批次、审计口径却不同」。
import { findNearDuplicateVariants, VARIANT_DUP_THRESHOLD } from '../src/domain/variant';
import { checkLanguageSanity, formatSanityIssues } from '../src/domain/languageSanity';
import type { Question } from '../src/schemas/question';

interface CliOptions {
  json: boolean;
  dupThreshold: number;
  /** 过渡期开关：只报告不阻断。CI 与发布前不得使用。 */
  noFail: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const out: CliOptions = { json: false, dupThreshold: VARIANT_DUP_THRESHOLD, noFail: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--no-fail') out.noFail = true;
    else if (a === '--dup-threshold')
      out.dupThreshold = Math.max(50, Math.min(100, Number(argv[++i]) || VARIANT_DUP_THRESHOLD));
  }
  return out;
}

interface StaleEntry {
  questionId: string;
  variantId: string;
  kind: string;
  reason: string;
}

interface DupPair {
  questionId: string;
  a: string;
  b: string;
  ratio: number;
}

interface SanityEntry {
  questionId: string;
  variantId: string;
  kind: string;
  detail: string;
}

interface Report {
  covered: number;
  total: number;
  stale: StaleEntry[];
  dupPairs: DupPair[];
  sanity: SanityEntry[];
  dupThreshold: number;
  /** 是否达到发布标准（stale/近重复/语言质量全为 0）。 */
  healthy: boolean;
}

function buildReport(dupThreshold: number): Report {
  const byId = new Map<string, Question>();
  for (const q of questionBank.questions) byId.set(q.id, q);

  const stale: StaleEntry[] = [];
  const dupPairs: DupPair[] = [];
  const sanity: SanityEntry[] = [];
  let total = 0;
  let covered = 0;

  for (const [qid, list] of Object.entries(variantPool.variants)) {
    if (list.length > 0) covered++;
    total += list.length;
    const canonical = byId.get(qid);

    // ── 1. stale 标记：canonical 缺失，或 sourceHash 与当前 canonical 内容指纹不一致 ──
    for (const v of list) {
      if (!canonical) {
        stale.push({ questionId: qid, variantId: v.id, kind: v.kind, reason: 'canonical 缺失（题目已从题库移除）' });
        continue;
      }
      if (isVariantStale(v, canonical)) {
        stale.push({ questionId: qid, variantId: v.id, kind: v.kind, reason: 'sourceHash 与原题不一致（原题已改）' });
      }
    }

    // ── 2. variant-vs-variant 近重复（规则在 domain/variant，与生成管线同源）──
    for (const { i, j, ratio } of findNearDuplicateVariants(list, dupThreshold)) {
      dupPairs.push({ questionId: qid, a: list[i].id, b: list[j].id, ratio });
    }

    // ── 3. 语言质量（确定性门禁，与生成管线同一套规则）──
    if (canonical) {
      for (const v of list) {
        const result = checkLanguageSanity(
          { stem: v.question, options: v.options },
          { stem: canonical.question, options: canonical.formats?.choice?.options },
        );
        if (!result.ok) {
          sanity.push({ questionId: qid, variantId: v.id, kind: v.kind, detail: formatSanityIssues(result) });
        }
      }
    }
  }

  return {
    covered,
    total,
    stale,
    dupPairs,
    sanity,
    dupThreshold,
    healthy: stale.length === 0 && dupPairs.length === 0 && sanity.length === 0,
  };
}

function printReport(r: Report, noFail: boolean): void {
  console.log('── 变体池校验 ──');
  console.log(`  题目覆盖数  : ${r.covered}`);
  console.log(`  变体总数    : ${r.total}`);

  console.log(`  stale 数    : ${r.stale.length}`);
  for (const s of r.stale) {
    console.log(`    ✗ ${s.questionId} / ${s.variantId} [${s.kind}] —— ${s.reason}`);
  }

  console.log(`  近重复对数  : ${r.dupPairs.length}（阈值 CJK-Dice ≥ ${r.dupThreshold}）`);
  for (const d of r.dupPairs) {
    console.log(`    • ${d.questionId}: ${d.a} ⇄ ${d.b}（相似度 ${d.ratio}）`);
  }

  console.log(`  语言质量不合格: ${r.sanity.length}`);
  for (const s of r.sanity) {
    console.log(`    ✗ ${s.questionId} / ${s.variantId} [${s.kind}] —— ${s.detail}`);
  }

  if (r.healthy) {
    console.log('\n✓ 池健康：无 stale、无近重复、无语言质量问题。');
    return;
  }

  console.log('\n✗ 池不健康，必须处理后再发布：');
  if (r.stale.length > 0) console.log(`    · ${r.stale.length} 条 stale —— 重跑 scripts/question-variants.ts 重新生成`);
  if (r.dupPairs.length > 0)
    console.log(`    · ${r.dupPairs.length} 对近重复 —— 选项改写幅度不足，重生成或删除其中一条`);
  if (r.sanity.length > 0) console.log(`    · ${r.sanity.length} 条语言质量不合格 —— 重生成（确定性门禁已拦住同类候选）`);
  if (noFail) {
    console.log('\n⚠ --no-fail：已按要求**不阻断**，退出码降级为 0。此开关仅供过渡期人工核查，禁止用于 CI。');
  }
}

function main(): void {
  const { json, dupThreshold, noFail } = parseArgs(process.argv.slice(2));
  const report = buildReport(dupThreshold);

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report, noFail);
  }

  // 发布门禁：任何一类问题存在即 exit 1（--no-fail 时降级）。
  if (!report.healthy && !noFail) process.exit(1);
}

main();
