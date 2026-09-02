/// <reference types="vite/client" />
// scripts/validate-variants.ts —— 离线变体池审计（双模式 Variant 设计配套）。
//
// 只读审计：校验池的 shape（schema 已在 variantBank 加载时 fail-fast）、标记 stale 变体、
// 并报告变体间近重复（variant-vs-variant 去重检查）。不写回任何文件（离线资产以生成器产出为准）。
//
// 用法：npx vite-node scripts/validate-variants.ts [--json] [--dup-threshold 88]

import { questionBank } from '../src/data/questionBank';
import { variantPool } from '../src/data/variantBank';
import { isVariantStale } from '../src/domain/variantPool';
// 近重复规则与阈值统一由 domain 提供：离线生成器（question-variants / assemble-variants）
// 与本审计脚本共用同一条规则，避免「生成管线拒绝的批次、审计口径却不同」。
import { findNearDuplicateVariants, VARIANT_DUP_THRESHOLD } from '../src/domain/variant';
import type { Question } from '../src/schemas/question';

function parseArgs(argv: string[]): { json: boolean; dupThreshold: number } {
  const out = { json: false, dupThreshold: VARIANT_DUP_THRESHOLD };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--dup-threshold') out.dupThreshold = Math.max(50, Math.min(100, Number(argv[++i]) || VARIANT_DUP_THRESHOLD));
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

function main(): void {
  const { json, dupThreshold } = parseArgs(process.argv.slice(2));
  const byId = new Map<string, Question>(questionBank.questions.map((q) => [q.id, q]));

  const stale: StaleEntry[] = [];
  const dupPairs: DupPair[] = [];
  let total = 0;
  let covered = 0;

  for (const [qid, list] of Object.entries(variantPool.variants)) {
    if (list.length > 0) covered++;
    total += list.length;
    const canonical = byId.get(qid);

    // stale 标记：canonical 缺失，或 sourceHash 与当前 canonical 内容指纹不一致。
    for (const v of list) {
      if (!canonical) {
        stale.push({ questionId: qid, variantId: v.id, kind: v.kind, reason: 'canonical 缺失（题目已从题库移除）' });
        continue;
      }
      if (isVariantStale(v, canonical)) {
        stale.push({ questionId: qid, variantId: v.id, kind: v.kind, reason: 'sourceHash 与原题不一致（原题已改）' });
      }
    }

    // variant-vs-variant 近重复（规则在 domain/variant，与生成管线同源）
    for (const { i, j, ratio } of findNearDuplicateVariants(list, dupThreshold)) {
      dupPairs.push({ questionId: qid, a: list[i].id, b: list[j].id, ratio });
    }
  }

  if (json) {
    console.log(JSON.stringify({ covered, total, stale, dupPairs, dupThreshold }, null, 2));
    return;
  }

  console.log('── 变体池校验 ──');
  console.log(`  题目覆盖数  : ${covered}`);
  console.log(`  变体总数    : ${total}`);
  console.log(`  stale 数    : ${stale.length}`);
  for (const s of stale) {
    console.log(`    ✗ ${s.questionId} / ${s.variantId} [${s.kind}] —— ${s.reason}`);
  }
  console.log(`  近重复对数  : ${dupPairs.length}（阈值 CJK-Dice ≥ ${dupThreshold}）`);
  for (const d of dupPairs) {
    console.log(`    • ${d.questionId}: ${d.a} ⇄ ${d.b}（相似度 ${d.ratio}）`);
  }
  if (stale.length === 0 && dupPairs.length === 0) {
    console.log('\n✓ 池健康：无 stale、无近重复。');
  }
}

main();
