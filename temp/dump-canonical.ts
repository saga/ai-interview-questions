// 抽取变体池所引用题目的 canonical 数据 + 现有变体 stem，供无 key 自生成改写使用。
// 复用现有 stem（题干已多样化），只重写两套选项（surfaceOptions / contextOptions）。
// 用法：node node_modules/vite-node/dist/cli.mjs temp/dump-canonical.ts <pool.json> [pool2.json ...]
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { questionBank } from '../src/data/questionBank';

const pools = process.argv.slice(2);
if (pools.length === 0) {
  console.error('usage: dump-canonical.ts <pool.json> ...');
  process.exit(1);
}
const byId = new Map(questionBank.questions.map((q) => [q.id, q]));

for (const poolFile of pools) {
  const pool = JSON.parse(readFileSync(resolve(process.cwd(), poolFile), 'utf8'));
  const qids: string[] = Object.keys(pool.variants ?? {});
  const out: Record<string, unknown> = {};
  let missing = 0;
  for (const qid of qids) {
    const q = byId.get(qid);
    if (!q || !q.formats.choice) {
      missing++;
      continue;
    }
    const cf = q.formats.choice;
    const list: any[] = pool.variants[qid] ?? [];
    const surface = list.find((v) => v.kind === 'surface-options');
    const context = list.find((v) => v.kind === 'context-options');
    out[qid] = {
      canonicalQuestion: q.question,
      canonicalOptions: cf.options,
      answer: cf.answer,
      surfaceStem: surface?.question ?? null,
      contextStem: context?.question ?? null,
    };
  }
  const base = poolFile.split('/').pop()!.replace(/\.json$/, '');
  const outFile = resolve(process.cwd(), `temp/canonical-${base}.json`);
  writeFileSync(outFile, JSON.stringify(out, null, 2), 'utf8');
  console.log(`✓ ${base}: ${Object.keys(out).length} 题抽出（缺失 ${missing}），→ ${outFile}`);
}
