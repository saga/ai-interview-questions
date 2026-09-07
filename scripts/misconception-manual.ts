// 题级 misconceptions + misconceptionMap 的人工撰写闭环。
//
// 与 assessment-manual.ts / backfill-cognitive-task.ts 同一套方法论：
// 「规则能推的脚本推，推不出的交人工，人工结果用同一条 schema 门禁落库」。
// 这里**没有规则推断**——误解文本必须由理解题干/干扰项后生成，机械模板只会产出
// 「认为<option 原文>」这种同义反复，而诊断要说清「学习者信了什么才选错」。
//
// 为什么 map 不用人工写：
//   `misconceptionMap[i]` 只是「选项 i → misconceptions 下标」的对齐关系。
//   让撰写的 `misconceptions` 数组**按干扰项升序 1:1 对齐**，脚本即可推导出 map
//   （正确项恒 null），人工只产出文本。既省一半输出，也消除下标写错这类静默错误。
//   同一题里两条误解文本相同会自动合并（map 指向同一个下标）。
//
// 用法：
//   node scripts/misconception-manual.ts --status
//   node scripts/misconception-manual.ts --dump --out=temp/mis-pending.json [--topic=evaluation]
//   node scripts/misconception-manual.ts --dump --out=temp/mis-1.json --limit=60
//   node scripts/misconception-manual.ts --apply --file=temp/mis-authored-01.json [--dry-run]
//
// 撰写格式（misconceptions 按干扰项升序 1:1 对齐）：
//   [{ "id": "xxx", "misconceptions": ["认为…", "认为…"] }]

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { Question } from '../src/schemas/question.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const questionsDir = resolve(root, 'src/data/questions');

function arg(name: string): string | undefined {
  const inline = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (inline !== undefined) return inline.slice(name.length + 3);
  const i = process.argv.indexOf(`--${name}`);
  const next = i >= 0 ? process.argv[i + 1] : undefined;
  return next !== undefined && !next.startsWith('--') ? next : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

type Loaded = { file: string; path: string; questions: Question[] };
const load = (): Loaded[] =>
  readdirSync(questionsDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => {
      const path = resolve(questionsDir, file);
      return { file, path, questions: JSON.parse(readFileSync(path, 'utf8')) as Question[] };
    });

/** 干扰项下标（升序）。无选择题或无干扰项（全对题）时返回空数组。 */
function distractorIndices(q: Question): number[] {
  const c = q.formats?.choice;
  if (!c) return [];
  const ans = c.answer ?? [];
  return c.options.map((_, i) => i).filter((i) => !ans.includes(i));
}

const files = load();
const all = files.flatMap((f) => f.questions);
const byId = new Map(all.map((q) => [q.id, q]));

// ── --status ────────────────────────────────────────────────────────────────
if (has('status')) {
  let withMis = 0;
  let withMap = 0;
  let distractors = 0;
  let bound = 0;
  for (const q of all) {
    if ((q.misconceptions?.length ?? 0) > 0) withMis++;
    const c = q.formats?.choice;
    if (!c) continue;
    if (c.misconceptionMap) withMap++;
    const d = distractorIndices(q);
    distractors += d.length;
    for (const i of d) if (c.misconceptionMap?.[i] != null) bound++;
  }
  console.log(`题目  : ${all.length}`);
  console.log(`  带 misconceptions : ${withMis}/${all.length}（缺 ${all.length - withMis}）`);
  console.log(`  带 misconceptionMap: ${withMap}/${all.length}（缺 ${all.length - withMap}）`);
  console.log(`干扰项: ${distractors} 个，已绑定 ${bound}（${((bound / distractors) * 100).toFixed(1)}%），未绑定 ${distractors - bound}`);
  process.exit(0);
}

// ── --dump ──────────────────────────────────────────────────────────────────
const out = arg('out');
if (has('dump')) {
  if (!out) {
    console.error('✗ --dump 需要 --out=<file>');
    process.exit(1);
  }
  const topic = arg('topic');
  const limit = Number(arg('limit') ?? '0');
  const offset = Number(arg('offset') ?? '0');
  const pending = all
    .filter((q) => (q.misconceptions?.length ?? 0) === 0)
    .filter((q) => !topic || q.topic === topic)
    .map((q) => ({ q, d: distractorIndices(q) }))
    .filter(({ d }) => d.length > 0);

  const slice = pending.slice(offset, limit > 0 ? offset + limit : undefined);
  // 带上题干：干扰项是完整句，但「它错在哪」常常只有结合题干才看得出
  // （同一句话在另一道题里可能是对的）。题干均值 ~77 字，代价可接受。
  const payload = slice.map(({ q, d }, seq) => ({
    seq,
    id: q.id,
    topic: q.topic,
    question: q.question,
    distractors: d.map((i) => ({ i, text: q.formats!.choice!.options[i] })),
  }));
  writeFileSync(resolve(root, out), `${JSON.stringify(payload, null, 1)}\n`, 'utf8');
  console.log(`✓ 导出 ${payload.length} 题 / ${payload.reduce((n, p) => n + p.distractors.length, 0)} 个干扰项 → ${out}`);
  console.log(`  （待撰写总数 ${pending.length} 题，本次 offset=${offset}${limit ? ` limit=${limit}` : ''}）`);
  process.exit(0);
}

// ── --apply ─────────────────────────────────────────────────────────────────
const file = arg('file');
if (has('apply')) {
  if (!file) {
    console.error('✗ --apply 需要 --file=<file>');
    process.exit(1);
  }
  const dryRun = has('dry-run');
  const authoredSchema = z.object({
    id: z.string().min(1),
    misconceptions: z.array(z.string().min(6)).min(1),
  });

  const raw = JSON.parse(readFileSync(resolve(root, file), 'utf8')) as unknown;
  const parsed = z.array(authoredSchema).safeParse(raw);
  if (!parsed.success) {
    console.error('✗ 撰写文件格式不合法（整批中止，未落盘）：');
    for (const e of parsed.error.issues.slice(0, 10)) {
      console.error(`    · ${e.path.join('.')} — ${e.message}`);
    }
    process.exit(1);
  }

  // 全有或全无：先逐条做业务校验，任何一条不过就整批中止。
  const errors: string[] = [];
  const plan: { q: Question; file: string; misconceptions: string[]; map: (number | null)[] }[] = [];
  for (const item of parsed.data) {
    const q = byId.get(item.id);
    if (!q) {
      errors.push(`${item.id} — 题库里找不到`);
      continue;
    }
    const d = distractorIndices(q);
    if (d.length === 0) {
      errors.push(`${item.id} — 没有干扰项（全对题），不该写误解`);
      continue;
    }
    if (item.misconceptions.length !== d.length) {
      errors.push(
        `${item.id} — 误解条数 ${item.misconceptions.length} 与干扰项数 ${d.length} 不一致（须 1:1 对齐）`,
      );
      continue;
    }
    // 去重：相同文本合并为同一条，map 指向同一下标。
    const uniq: string[] = [];
    const idxOf: number[] = [];
    for (const m of item.misconceptions) {
      const at = uniq.indexOf(m);
      if (at >= 0) {
        idxOf.push(at);
      } else {
        uniq.push(m);
        idxOf.push(uniq.length - 1);
      }
    }
    const options = q.formats!.choice!.options;
    const map: (number | null)[] = options.map(() => null);
    d.forEach((optIdx, k) => {
      map[optIdx] = idxOf[k];
    });
    plan.push({ q, file: '', misconceptions: uniq, map });
  }

  if (errors.length > 0) {
    console.error(`✗ 业务校验未通过（${errors.length} 条，整批中止，未落盘）：`);
    for (const e of errors.slice(0, 20)) console.error(`    · ${e}`);
    process.exit(1);
  }

  if (dryRun) {
    console.log(`--dry-run：校验通过，将写入 ${plan.length} 题，未改动文件。`);
    process.exit(0);
  }

  const touched = new Map<string, Loaded>();
  for (const p of plan) {
    p.q.misconceptions = p.misconceptions;
    p.q.formats!.choice!.misconceptionMap = p.map;
    const owner = files.find((f) => f.questions.includes(p.q));
    if (owner) touched.set(owner.file, owner);
  }
  for (const f of touched.values()) {
    writeFileSync(f.path, `${JSON.stringify(f.questions, null, 2)}\n`, 'utf8');
  }
  console.log(`✓ 写入 ${plan.length} 题，改动 ${touched.size} 个文件。`);
  process.exit(0);
}

console.error('用法：--status | --dump --out=<file> [--topic=] [--limit=] [--offset=] | --apply --file=<file> [--dry-run]');
process.exit(1);
