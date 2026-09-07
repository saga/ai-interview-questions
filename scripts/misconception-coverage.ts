/// <reference types="vite/client" />
// misconceptionMap 覆盖率报告（plan0907 P1-3）。
//
// 为什么单开一个脚本：评审指出「选择题 → 误解诊断 → adaptive」这条链在题库侧覆盖率太低，
// 但仓库里从来没有一个地方**量化**它——13.7% 这个数字此前只能靠临时脚本算。
// 没有度量就无法判断补齐进度，也无法决定「先补哪些题」。本脚本是那把尺子。
//
// 三层口径（缺一不可）：
//   1. 题级 `misconceptions[]`   —— 有没有「误区清单」（LLM 或人工产出）；
//   2. `misconceptionMap`        —— 干扰项 ↔ 误区是否**绑定**（backfill 脚本可自动做）；
//   3. 绑定率 mapped distractors / 全部 distractors —— 覆盖是「有 map」还是「真绑上了」。
// 只统计「有 map 的题数」会高估：一道题只绑 1 个干扰项也算覆盖，但诊断收益有限。
//
// 用法：
//   npm run question:misconceptions
//   npm run question:misconceptions -- --json           # 机器可读，供 CI / 看板
//   npm run question:misconceptions -- --top=20         # 列出最该补的 20 个 topic

// 刻意不 import `src/data/questionBank`（那是浏览器打包路径，用 import.meta.glob）：
// 直接 fs 读 JSON。Node 原生跑 TS，相对导入必须带 .ts 扩展名（同 question-coverage.ts）。
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Question } from '../src/schemas/question.ts';

const questionsDir = fileURLToPath(new URL('../src/data/questions/', import.meta.url));

function readQuestions(): Question[] {
  return readdirSync(questionsDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .flatMap((f) => JSON.parse(readFileSync(questionsDir + f, 'utf8')) as Question[]);
}

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const topArg = args.find((a) => a.startsWith('--top='));
const top = topArg ? Number(topArg.split('=')[1]) : 15;

interface Row {
  topic: string;
  questions: number;
  withList: number;
  withMap: number;
  distractors: number;
  mapped: number;
}

function main(): void {
  const rows = new Map<string, Row>();
  for (const q of readQuestions()) {
    const cf = q.formats.choice;
    if (!cf) continue;
    const row = rows.get(q.topic) ?? { topic: q.topic, questions: 0, withList: 0, withMap: 0, distractors: 0, mapped: 0 };
    row.questions += 1;
    const list = q.misconceptions ?? [];
    if (list.length > 0) row.withList += 1;
    const map = cf.misconceptionMap;
    if (map) row.withMap += 1;
    const answer = new Set(cf.answer);
    for (let i = 0; i < cf.options.length; i++) {
      if (answer.has(i)) continue;
      row.distractors += 1;
      if (map?.[i] != null) row.mapped += 1;
    }
    rows.set(q.topic, row);
  }

  const all = [...rows.values()];
  const sum = (pick: (r: Row) => number) => all.reduce((n, r) => n + pick(r), 0);
  const total = {
    questions: sum((r) => r.questions),
    withList: sum((r) => r.withList),
    withMap: sum((r) => r.withMap),
    distractors: sum((r) => r.distractors),
    mapped: sum((r) => r.mapped),
  };
  const pct = (a: number, b: number) => (b === 0 ? 0 : Math.round((a / b) * 1000) / 10);

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          total,
          coverage: {
            listPct: pct(total.withList, total.questions),
            mapPct: pct(total.withMap, total.questions),
            bindingPct: pct(total.mapped, total.distractors),
          },
          topics: all.sort((a, b) => b.distractors - b.mapped - (a.distractors - a.mapped)),
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log('── misconceptionMap 覆盖率（选择题诊断能力）──');
  console.log(`  选择题        : ${total.questions}`);
  console.log(`  有误区清单    : ${total.withList}（${pct(total.withList, total.questions)}%）`);
  console.log(`  有选项绑定    : ${total.withMap}（${pct(total.withMap, total.questions)}%）`);
  console.log(`  干扰项绑定率  : ${total.mapped}/${total.distractors}（${pct(total.mapped, total.distractors)}%）`);
  console.log('\n  缺口最大的 topic（未绑定干扰项数降序；先补这些收益最高）：');
  const gaps = all
    .map((r) => ({ ...r, gap: r.distractors - r.mapped }))
    .sort((a, b) => b.gap - a.gap || a.topic.localeCompare(b.topic))
    .slice(0, top);
  for (const r of gaps) {
    if (r.gap === 0) break;
    console.log(`    · ${r.topic}：${r.questions} 题 / 未绑定 ${r.gap} 个干扰项（清单 ${r.withList} · 有 map ${r.withMap}）`);
  }
  console.log(
    '\n  补齐路径：题级清单缺失 → 用 `npm run backfill:misconceptions -- --from-nodes --dry-run` 以知识节点误解做种；' +
      '\n  仍配不上的需要 LLM 生成题级 misconceptions（本仓库暂无该脚本）。',
  );
}

main();
