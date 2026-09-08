// 变体 sourceHash 重设基线（re-baseline）+ stale 归因报告（P1-10 stale repair 流水线）。
//
// 背景：sourceHash 覆盖 canonical 的「题面 + 选项 + 元数据」，其中 `cognitiveTask` 是
// **条件入指纹**（src/schemas/variant.ts）：未声明时不出该键，声明后其变化即判 stale。
// 因此给存量题补写 cognitiveTask（ADR-077 第四维）会让它的变体全部变 stale ——
// 但变体**文本没变**，变的是它继承来的元数据，且按 ADR-077 未自声明的变体本就恒取
// canonical 当前值，所以「重新对齐指纹」才是正确处置，而不是重跑 LLM 重新生成。
//
// 归因规则（stale repair，不是只有 stale 检测）：
//   - 变体带 `sourceSnapshot`（新资产）：逐字段 diff，快照 vs 当前 canonical。
//     变化全在 metadata（topic/subtopic/angle/difficulty/cognitiveTask/tags）→
//     自动重算 hash 落盘（--write），绝不调 LLM；题面/选项变了 → 真实漂移，列出，
//     由 `scripts/question-variants.ts --stale` 走重新生成。
//   - 无快照（存量）：legacy 规则——旧指纹 == 去掉 cognitiveTask 后的指纹才重设基线，
//     其余一律真实漂移。
//
// 用法：
//   node scripts/refresh-variant-hash.ts                # 只读报告
//   node scripts/refresh-variant-hash.ts --write        # 落盘
//   node scripts/refresh-variant-hash.ts --write --dry-run

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Question } from '../src/schemas/question.ts';
import { computeVariantSourceHash, variantSourceOf } from '../src/schemas/variant.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const has = (name: string) => process.argv.includes(`--${name}`);
const write = has('write');
const dryRun = has('dry-run');

// ── canonical ────────────────────────────────────────────────────────────────
const questionsDir = resolve(root, 'src/data/questions');
const byId = new Map<string, Question>();
for (const f of readdirSync(questionsDir).filter((n) => n.endsWith('.json')).sort()) {
  for (const q of JSON.parse(readFileSync(resolve(questionsDir, f), 'utf8')) as Question[]) {
    byId.set(q.id, q);
  }
}

// ── 变体池（Record<canonicalId, Variant[]>）───────────────────────────────────
interface RawVariant {
  id: string;
  sourceHash?: string;
  sourceSnapshot?: Record<string, unknown>;
}
const variantsDir = resolve(root, 'src/data/variants');
const files = readdirSync(variantsDir)
  .filter((n) => n.endsWith('.json'))
  .sort()
  .map((f) => {
    const path = resolve(variantsDir, f);
    const pool = JSON.parse(readFileSync(path, 'utf8')) as { variants: Record<string, RawVariant[]> };
    return { file: f, path, pool };
  });

interface Row {
  file: string;
  canonicalId: string;
  variantId: string;
  from: string;
  to: string;
  changedFields: string[];
}
const rebased: Row[] = [];
const fresh: string[] = [];
const genuine: Row[] = [];
const orphan: string[] = [];

const META = ['topic', 'subtopic', 'angle', 'difficulty', 'cognitiveTask', 'tags'];
const CONTENT = ['question', 'options'];
const normVal = (x: unknown) => JSON.stringify(Array.isArray(x) ? [...x].map(String).sort() : (x ?? ''));

for (const { file, pool } of files) {
  for (const [canonicalId, list] of Object.entries(pool.variants)) {
    const q = byId.get(canonicalId);
    if (!q) {
      orphan.push(`${file} · ${canonicalId}`);
      continue;
    }
    const src = variantSourceOf(q);
    const hNow = computeVariantSourceHash(src);
    const hLegacy = computeVariantSourceHash({ ...src, cognitiveTask: undefined });
    const curSnap: Record<string, unknown> = {
      id: src.id,
      topic: src.topic,
      subtopic: src.subtopic,
      angle: src.angle,
      difficulty: src.difficulty,
      cognitiveTask: src.cognitiveTask,
      tags: src.tags,
      question: src.question,
      options: src.options,
    };
    for (const v of list) {
      const old = v.sourceHash ?? '';
      if (old === hNow) {
        fresh.push(v.id);
        continue;
      }
      // 快照归因（新资产）：知道 canonical 哪个字段变了，才知道要不要调 LLM。
      if (v.sourceSnapshot) {
        const changed = [...META, ...CONTENT].filter((f) => normVal(v.sourceSnapshot![f]) !== normVal(curSnap[f]));
        const contentChanged = changed.some((f) => CONTENT.includes(f));
        if (!contentChanged) {
          // 仅 metadata 变化（或快照全同但算法升级）→ 重算 hash 即可，不调 LLM。
          rebased.push({ file, canonicalId, variantId: v.id, from: old, to: hNow, changedFields: changed });
          v.sourceHash = hNow;
          v.sourceSnapshot = { ...curSnap };
          continue;
        }
        genuine.push({ file, canonicalId, variantId: v.id, from: old, to: hNow, changedFields: changed });
        continue;
      }
      // legacy（无快照存量）：只认 cognitiveTask 引起的漂移。
      if (old === hLegacy) {
        rebased.push({ file, canonicalId, variantId: v.id, from: old, to: hNow, changedFields: ['cognitiveTask'] });
        v.sourceHash = hNow;
        continue;
      }
      genuine.push({ file, canonicalId, variantId: v.id, from: old, to: hNow, changedFields: [] });
    }
  }
}

if (write && !dryRun) {
  const touched = new Set([...rebased].map((r) => r.file));
  for (const { file, path, pool } of files) {
    if (!touched.has(file)) continue;
    writeFileSync(path, `${JSON.stringify(pool, null, 2)}\n`, 'utf8');
  }
}

const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - s.length));
console.log('── 变体 stale repair（归因 + 重设基线）──');
console.log(`  变体总数    : ${fresh.length + rebased.length + genuine.length}`);
console.log(`  已新鲜      : ${fresh.length}`);
console.log(`  可重设基线  : ${rebased.length}（仅 metadata 变化/算法升级，重算 hash，不调 LLM）`);
for (const r of rebased.slice(0, 10)) {
  console.log(`    ✓ ${pad(r.variantId, 60)} 变化字段: ${r.changedFields.join('/') || '（无，算法口径）'}`);
}
console.log(`  真实漂移    : ${genuine.length}（题面/选项变化，需 --stale 重新生成）`);
if (orphan.length > 0) console.log(`  ⚠ 孤儿变体  : ${orphan.length}（canonical 不存在，删除）`);

if (genuine.length > 0) {
  console.log('\n  真实漂移明细（前 20）：');
  for (const r of genuine.slice(0, 20)) {
    console.log(`    ✗ ${pad(r.variantId, 60)} ${r.from} → ${r.to}  变化: ${r.changedFields.join('/') || '（无快照，走 legacy）'}`);
  }
}
if (orphan.length > 0) {
  console.log('\n  孤儿变体（前 10）：');
  for (const o of orphan.slice(0, 10)) console.log(`    ✗ ${o}`);
}

if (write) {
  console.log(dryRun ? '\n  --dry-run：未改动文件。' : `\n  ✓ 已落盘 ${rebased.length} 条指纹，改动 ${new Set(rebased.map((r) => r.file)).size} 个文件。`);
} else {
  console.log('\n  ℹ 只读报告。加 --write 落盘（先 --write --dry-run 预览）。');
}
