/// <reference types="vite/client" />
// 手动离线变体池组装器（无 LLM key 时的替代通道）：由模型（WorkBuddy）产出改写文本草稿，
// 本脚本复用真实代码路径做校验 + 计算 sourceHash + 组装落盘。
//
// 复用：questionBank（canonical 真源）、validateVariant（全链路唯一门禁）、
//      computeVariantSourceHash（FNV-1a 指纹）、variantPoolSchema（资产契约）。
// 设计：草稿只提供 surface/context 题干；options 省略时自动取 canonical（运行时 Fisher-Yates
//      重排已产生呈现变化，且 100% 过 drift 门禁，避开纯中文选项 fuzzball 分词坑）。
//
// 用法：node node_modules/vite-node/dist/cli.mjs scripts/assemble-variants.ts <草稿.json> <输出文件名> [slug]
//   例：scripts/assemble-variants.ts temp/variant-draft-evaluation.json evaluation.wb-llm-20260903.json evalmanual

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { questionBank } from '../src/data/questionBank';
import { variantPoolSchema, computeVariantSourceHash, type QuestionVariant, type VariantPool, type VariantKind } from '../src/schemas/variant';
import { validateVariant } from '../src/domain/variant';
import { VARIANT_PROMPT_VERSION } from '../src/ai/variant';

interface DraftEntry {
  surface?: string;
  context?: string;
  options?: string[];
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
    const kinds: Array<{ kind: VariantKind; stem: string }> = [];
    if (entry.surface) kinds.push({ kind: 'surface-options', stem: entry.surface });
    if (entry.context) kinds.push({ kind: 'context-options', stem: entry.context });
    if (kinds.length === 0) {
      rejections.push(`✗ ${qid}：草稿未提供 surface/context 题干`);
      continue;
    }
    const list: QuestionVariant[] = [];
    let seq = 0;
    for (const { kind, stem } of kinds) {
      const cand = { question: stem, options: entry.options ?? canonicalOpts };
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

  if (rejections.length > 0) {
    console.error('\n── 门禁拒绝（未落盘）──');
    for (const r of rejections) console.error(r);
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
