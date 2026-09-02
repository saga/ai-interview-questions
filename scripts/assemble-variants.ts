/// <reference types="vite/client" />
// 手动离线变体池组装器（无 LLM key 时的替代通道）：由模型（WorkBuddy）产出改写文本草稿，
// 本脚本复用真实代码路径做校验 + 计算 sourceHash + 组装落盘。
//
// 复用：questionBank（canonical 真源）、validateVariant（全链路唯一门禁）、
//      computeVariantSourceHash（FNV-1a 指纹）、variantPoolSchema（资产契约）、
//      findNearDuplicateVariants（变体间去重，**与生成管线同一条规则**）。
//
// ⚠️ 2026-09-03 修正：本脚本原先「options 省略时自动取 canonical」，注释给的理由是
//    「避开纯中文选项 fuzzball 分词坑」。实测该理由不成立：中文选项做轻改后
//    option-vs-canonical 相似度落在 46~88，drift 门禁（<45 拒）放得过去。
//    真正的问题在反方向——只改题干、选项照抄时，sibling 相似度高达 88~96，
//    被去重门禁（≥88 判近重复）判死。首批量产因此产生 79 对近重复（81% 的题）。
//    现在 options 是**必填**：要让两个变体真的不同，必须连选项一起改。
//
// 用法：node node_modules/vite-node/dist/cli.mjs scripts/assemble-variants.ts <草稿.json> <输出文件名> [slug]
//   例：scripts/assemble-variants.ts temp/variant-draft-evaluation.json evaluation.wb-llm-20260903.json evalmanual

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { questionBank } from '../src/data/questionBank';
import { variantPoolSchema, computeVariantSourceHash, type QuestionVariant, type VariantPool, type VariantKind } from '../src/schemas/variant';
import { validateVariant, findNearDuplicateVariants, VARIANT_DUP_THRESHOLD } from '../src/domain/variant';
import { VARIANT_PROMPT_VERSION } from '../src/ai/variant';

/**
 * 草稿条目。
 *
 * `surfaceOptions` / `contextOptions` 是 2026-09-03 加的**必需**字段：两个变体若共用同一套
 * 选项，题干再怎么换、整体相似度也压不到 88 以下（实测题干相似度 55 时整体仍有 90，
 * 因为选项文本量通常大于题干），必然被去重门禁判为近重复。
 * 保留 `options` 只为单变体草稿图方便；两变体共用它会被门禁拦下并给出明确提示。
 */
interface DraftEntry {
  surface?: string;
  context?: string;
  /** 两变体共用（仅单变体时可用；两变体共用会被去重门禁拒绝）。 */
  options?: string[];
  surfaceOptions?: string[];
  contextOptions?: string[];
}

const DRAFT_PATH = process.argv[2] ?? 'temp/variant-draft-wiki.json';
const OUT_FILE = process.argv[3] ?? 'wiki-skill-evolution.json';
const SLUG = process.argv[4] ?? 'wikimanual';

function main(): void {
  const draft = JSON.parse(readFileSync(resolve(process.cwd(), DRAFT_PATH), 'utf8')) as Record<string, DraftEntry>;
  const byId = new Map(questionBank.questions.map((q) => [q.id, q]));

  const variants: Record<string, QuestionVariant[]> = {};
  const rejections: string[] = [];
  let count = 0;

  for (const [qid, entry] of Object.entries(draft)) {
    const q = byId.get(qid);
    if (!q) {
      rejections.push(`✗ ${qid}：题库中找不到该题目（canonical 缺失）`);
      continue;
    }
    if (!q.formats.choice) {
      rejections.push(`✗ ${qid}：非选择题，本组装器暂只支持 choice`);
      continue;
    }
    const canonicalOpts = q.formats.choice.options;
    const kinds: Array<{ kind: VariantKind; stem: string; options?: string[] }> = [];
    if (entry.surface) kinds.push({ kind: 'surface-options', stem: entry.surface, options: entry.surfaceOptions ?? entry.options });
    if (entry.context) kinds.push({ kind: 'context-options', stem: entry.context, options: entry.contextOptions ?? entry.options });
    if (kinds.length === 0) {
      rejections.push(`✗ ${qid}：草稿未提供 surface/context 题干`);
      continue;
    }
    // 选项必须由草稿显式给出，且两个变体要各不相同。
    // 旧版在此回退到 canonicalOpts（照抄原题选项），理由是「避开纯中文 fuzzball 分词坑」——
    // 实测该理由不成立（轻改后 46~88，drift 门禁放得过），而照抄的代价是 sibling 相似度
    // 88~96、被去重门禁判死。首批量产 79 对近重复即由此而来。
    if (kinds.length > 1 && kinds.some((k) => !k.options)) {
      rejections.push(
        `✗ ${qid}：多 variant 草稿必须给每个 variant 各自的选项（surfaceOptions / contextOptions）。` +
          `共用或照抄原题选项会让两个变体相似度 ≥88，被去重门禁判为近重复。`,
      );
      continue;
    }
    const list: QuestionVariant[] = [];
    let seq = 0;
    for (const { kind, stem, options } of kinds) {
      if (!options) {
        rejections.push(`✗ ${qid} [${kind}]：草稿未提供选项（canonical 选项不再被静默沿用）`);
        continue;
      }
      const cand = { question: stem, options };
      const check = validateVariant(q, cand, 'choice');
      if (!check.ok) {
        rejections.push(`✗ ${qid} [${kind}] 门禁未过：${check.code} ${check.reason ?? ''}`);
        continue;
      }
      if (check.warning) {
        console.log(`  • ${qid} [${kind}] 软信号：${check.warning}`);
      }
      list.push({
        id: `${qid}__${kind}__${SLUG}__${seq++}`,
        kind,
        question: stem,
        options: cand.options,
        generatedAt: Date.now(),
        generator: 'offline',
        promptVersion: VARIANT_PROMPT_VERSION,
        sourceHash: computeVariantSourceHash({
          id: q.id,
          question: q.question,
          options: canonicalOpts,
        }),
      });
      count++;
    }
    if (list.length > 0) variants[qid] = list;
  }

  // variant-vs-variant 去重：与生成管线（question-variants.ts）和池审计
  // （validate-variants.ts）同一条规则、同一个阈值。此前本通道完全绕过它，
  // 导致「生成管线会拒绝的批次，这里却能照常落盘」——首批量产 117/117 题的
  // 双变体选项雷同，就这样进了池子。
  const dupReport: string[] = [];
  for (const [qid, list] of Object.entries(variants)) {
    for (const { i, j, ratio } of findNearDuplicateVariants(list)) {
      dupReport.push(`✗ ${qid}：${list[i].id} ⇄ ${list[j].id}（相似度 ${ratio} ≥ ${VARIANT_DUP_THRESHOLD}）`);
    }
  }

  if (rejections.length > 0) {
    console.error('\n── 门禁拒绝（未落盘）──');
    for (const r of rejections) console.error(r);
    process.exit(1);
  }

  if (dupReport.length > 0) {
    console.error(`\n── 近重复拒绝（未落盘）：${dupReport.length} 对 ──`);
    for (const d of dupReport) console.error(d);
    console.error(
      '\n原因：同一题两个变体的**选项**太像。近重复门禁只比选项（题干本就该随变体不同），\n' +
        '实测档位：逐字照抄 = 100 · 同义轻改 ≈ 91 · 重述改写 ≈ 54；阈值 88。\n' +
        '只改题干没用——它压根不进相似度计算；轻改选项也不够（91 仍被判死）。\n' +
        '修法：给每个 variant 各自的选项做「重述级」改写（换句式与表述角度，保留技术结论），\n' +
        '把 sibling 压到 ≈54，同时 option-vs-canonical 仍在 drift 门禁（<35 拒）之上。',
    );
    process.exit(1);
  }

  const pool: VariantPool = {
    version: 1,
    generatedAt: Date.now(),
    promptVersion: VARIANT_PROMPT_VERSION,
    variants,
  };
  const parsed = variantPoolSchema.safeParse(pool);
  if (!parsed.success) {
    console.error('✗ 池未通过 schema 校验：', parsed.error.issues);
    process.exit(1);
  }

  const dir = resolve(process.cwd(), 'src/data/variants');
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, OUT_FILE);
  writeFileSync(file, JSON.stringify(parsed.data, null, 2), 'utf8');
  console.log(`\n✓ 落盘 ${file}`);
  console.log(`  题目数：${Object.keys(variants).length} / 草稿 ${Object.keys(draft).length}`);
  console.log(`  变体数：${count}`);
  console.log(`  promptVersion：${VARIANT_PROMPT_VERSION}`);
}

main();
