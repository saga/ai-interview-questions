/// <reference types="vite/client" />
// 临时脚本：以「大模型手写」方式产出离线变体池，并用仓库真实代码逐条校验。跑完即删。
//
// 设计说明：validateVariant 的 optionChangedTooMuch 门槛（fuzz.token_set_ratio < 45 拒）在中文上极严苛——
// 实测仅改 4 个字就掉到 44，手工逐选项改写 168 项不可靠。故变体「改写」落在题干（surface 中性改写 /
// context 加工程场景），选项由脚本取 canonical 原文；运行时 applyVariant 仍对选项做 Fisher–Yates 重排，
// 呈现顺序已变化，属合法轻量变体。
//
// 运行：node node_modules/vite-node/dist/cli.mjs scripts/build-variants-wb.ts

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { questionBank } from '../src/data/questionBank';
import { computeVariantSourceHash, variantPoolSchema, type VariantPool, type QuestionVariant } from '../src/schemas/variant';
import { validateVariant } from '../src/domain/variant';
import { AUTHORED } from './variant-draft';

const SLUG = 'wb-llm-20260902';
const PROMPT_VERSION = 'v3';

function main(): void {
  const byId = new Map(questionBank.questions.map((q) => [q.id, q]));
  const variants: Record<string, QuestionVariant[]> = {};
  let total = 0;
  const failures: string[] = [];

  for (const [qid, list] of Object.entries(AUTHORED)) {
    const canonical = byId.get(qid);
    if (!canonical) {
      failures.push(`✗ 题目不存在：${qid}`);
      continue;
    }
    const isChoice = !!canonical.formats.choice;
    const produced: QuestionVariant[] = [];
    list.forEach((a, seq) => {
      const candidate = { question: a.question, options: isChoice ? canonical.formats.choice!.options : undefined };
      const check = validateVariant(canonical, candidate, isChoice ? 'choice' : 'open');
      if (!check.ok) {
        failures.push(`✗ ${qid} [${a.kind}] 校验未过：${check.code} ${check.reason ?? ''}`);
        return;
      }
      if (check.warning) console.warn(`    • ${qid} [${a.kind}] 软信号：${check.warning}`);
      produced.push({
        id: `${qid}__${a.kind}__${SLUG}__${seq}`,
        kind: a.kind,
        question: a.question,
        options: isChoice ? canonical.formats.choice!.options : undefined,
        generatedAt: Date.now(),
        generator: 'offline',
        promptVersion: PROMPT_VERSION,
        sourceHash: computeVariantSourceHash({
          id: canonical.id,
          question: canonical.question,
          options: canonical.formats.choice?.options,
        }),
      });
    });
    if (produced.length > 0) variants[qid] = produced;
    total += produced.length;
  }

  if (failures.length > 0) {
    console.error('\n变体校验存在失败项，未写盘：\n' + failures.join('\n'));
    process.exit(1);
  }

  const pool: VariantPool = { version: 1, generatedAt: Date.now(), promptVersion: PROMPT_VERSION, variants };
  const parsed = variantPoolSchema.safeParse(pool);
  if (!parsed.success) {
    console.error('✗ 变体池 schema 校验失败：', parsed.error.issues);
    process.exit(1);
  }

  const dir = resolve(process.cwd(), 'src/data/variants');
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, `wiki-skill-evolution-2026-08.${SLUG}.json`);
  writeFileSync(file, JSON.stringify(parsed.data, null, 2), 'utf8');
  console.log(`\n✓ 已写盘：${file}\n  题目覆盖：${Object.keys(variants).length}\n  变体总数：${total}`);
}

main();
