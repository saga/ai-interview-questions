// npm run question:cognitive-task —— 认知任务（assessment contract 第四维）的覆盖率报告与回填。
//
// 与 assessment 回填同一套方法论，但策略更保守：angle→cognitiveTask **不是单射**
// （mechanism 可以是 explain / diagnose / apply），所以只在「题面显式提问方式」或
// 「seed 校准过的 angle 先验」命中时才写，推断不出一律留空交人工撰写
// （`scripts/assessment-manual.ts --field=cognitive-task`）。
//
// 用法：
//   npm run question:cognitive-task                          # 覆盖率报告 + 规则命中分布
//   npm run question:cognitive-task -- --json                # 机器可读
//   npm run question:cognitive-task -- --write --dry-run     # 预览
//   npm run question:cognitive-task -- --write               # 回填
//   npm run question:cognitive-task -- --write --overwrite   # 覆盖已有值（含剪枝：推不出就删）

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Question } from '../src/schemas/question.ts';
import type { CognitiveTask } from '../src/schemas/common.ts';
import { inferCognitiveTask } from '../src/domain/cognitiveTaskInference.ts';

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

const readQuestions = (): { path: string; questions: Question[] }[] =>
  readdirSync(questionsDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const path = resolve(questionsDir, f);
      return { path, questions: JSON.parse(readFileSync(path, 'utf8')) as Question[] };
    });

const write = has('write');
const dryRun = has('dry-run');
const overwrite = has('overwrite');
const json = has('json');
const topic = arg('topic');
const ids = (arg('ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const files = readQuestions();
const all = files.flatMap((f) => f.questions);
const targets = all.filter((q) => {
  if (topic && q.topic !== topic) return false;
  if (ids.length > 0 && !ids.includes(q.id)) return false;
  if (!overwrite && q.cognitiveTask) return false;
  return true;
});

const planned = new Map<string, CognitiveTask | undefined>();
const ruleHits: Record<string, number> = {};
let unresolved: { id: string; angle?: string; stem: string }[] = [];

for (const q of targets) {
  const r = inferCognitiveTask({ question: q.question, angle: q.angle });
  if (!r) {
    planned.set(q.id, undefined);
    unresolved.push({ id: q.id, angle: q.angle, stem: (q.question ?? '').slice(0, 48) });
    continue;
  }
  planned.set(q.id, r.task);
  ruleHits[r.rule] = (ruleHits[r.rule] ?? 0) + 1;
}

// 审计侧车
mkdirSync(resolve(root, 'temp'), { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);
const auditPath = resolve(root, `temp/cognitive-task-backfill-${stamp}.json`);
const audit = targets.map((q) => ({
  id: q.id,
  angle: q.angle,
  planned: planned.get(q.id) ?? null,
  before: q.cognitiveTask ?? null,
}));

let written = 0;
let removed = 0;
if (write) {
  for (const f of files) {
    let touched = false;
    for (const q of f.questions) {
      if (!planned.has(q.id)) continue;
      const next = planned.get(q.id);
      if (next === undefined) {
        if (q.cognitiveTask === undefined) continue;
        delete q.cognitiveTask;
        removed++;
        touched = true;
        continue;
      }
      if (q.cognitiveTask === next) continue;
      q.cognitiveTask = next;
      written++;
      touched = true;
    }
    if (touched && !dryRun) writeFileSync(f.path, `${JSON.stringify(f.questions, null, 2)}\n`, 'utf8');
  }
  if (!dryRun) writeFileSync(auditPath, JSON.stringify(audit, null, 2), 'utf8');
}

const withTask = all.filter((q) => q.cognitiveTask).length;
if (json) {
  console.log(
    JSON.stringify(
      { total: all.length, withTask, planned: planned.size, written, removed, unresolved: unresolved.length, ruleHits },
      null,
      2,
    ),
  );
} else {
  console.log('── 认知任务（cognitiveTask）覆盖率 ──');
  console.log(
    `  题目 : ${all.length} 题，已落库 ${withTask}（${((withTask / all.length) * 100).toFixed(1)}%）` +
      ` · 本轮可判定 ${planned.size - unresolved.length} · 待人工 ${unresolved.length}`,
  );
  console.log(`  规则命中：${JSON.stringify(ruleHits)}`);
  if (write && !dryRun) console.log(`  ✓ 写入 ${written} 条${removed > 0 ? `，清理 ${removed} 条` : ''} → 审计 ${auditPath}`);
  else if (dryRun) console.log(`  --dry-run：将写入 ${planned.size - unresolved.length} 条，未改动文件。`);
  else console.log('  ℹ 只读报告。加 --write 回填（先 --write --dry-run 预览）。');
  if (unresolved.length > 0) {
    console.log(`  待人工样例（前 5 条）：`);
    for (const u of unresolved.slice(0, 5)) console.log(`    [${u.angle}] ${u.id} · ${u.stem}`);
  }
}
