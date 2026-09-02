// npm run question:quality —— 题库**内容质量**只读审计（检测，不改写、不设门禁）。
//
// 与 `validate-questions.ts` 的分工：后者管**数据契约**（topic 有节点、answer 不越界、
// 选项不重复），本脚本管**内容质量**——数据在结构上完全合法、但考不到东西的那些题。
//
// 关键立场：**长度平衡 ≠ 选项质量平衡**。下面四个探测器全是**词汇/统计层面的嫌疑信号**，
// 没有一个是语义判定。它们的作用是给 LLM challenger 与人工复核排优先级，
// 不是给题定罪——命中率高的是"值得看"，不是"必须改"。
//
// 因此：本脚本**永远 exit 0**，不新增任何 lint 硬门禁（见 ACTION_CHECKLIST.md A-8）。
// 借鉴 validate-questions.ts：fs 直读 JSON（不经 Vite / import.meta.glob），Node 原生运行 TS。

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as fuzz from 'fuzzball';
import type { Question } from '../src/schemas/question';

const dataDir = fileURLToPath(new URL('../src/data/', import.meta.url));
const asJson = process.argv.includes('--json');
const topArgIdx = process.argv.indexOf('--top');
const topN = topArgIdx >= 0 ? Number(process.argv[topArgIdx + 1]) : 15;
const onlyArgIdx = process.argv.indexOf('--only');
const only = onlyArgIdx >= 0 ? Number(process.argv[onlyArgIdx + 1]) : null;

interface Finding {
  id: string;
  detector: DetectorId;
  detail: string;
}

type DetectorId = 'mixed-correct-level' | 'stuffed-option' | 'density-cueing' | 'single-judgement';

const DETECTOR_LABEL: Record<DetectorId, string> = {
  'mixed-correct-level': '① 正确项认知层级不一致（定义/收益/反面/条件混杂）',
  'stuffed-option': '② 选项塞整段答案（多从句 / 显著长于中位数）',
  'density-cueing': '③ 信息密度泄题（正确项具体度显著高于干扰项）',
  'single-judgement': '④ 多选只考一个判断（正确项互为复述）',
};

// ── ① 认知层级分类：纯词汇线索，仅作粗分类用 ──────────────────────────────
const LEVEL_RULES: Array<{ level: string; re: RegExp }> = [
  { level: '反面比较', re: /(不[会能]|无法|不能|反而|失败|导致|风险|缺点|误|错误|避免)/ },
  { level: '条件', re: /(当|如果|若|只有|除非|前提|在.{0,6}情况下|仅当)/ },
  { level: '收益/目的', re: /(可以|能够|有助|以便|提升|降低|减少|提高|优化|支持|实现|从而)/ },
  { level: '定义', re: /(是指|指的是|即|定义为|本质|一种|机制|概念)/ },
];

function levelsOf(text: string): Set<string> {
  const levels = new Set<string>();
  for (const { level, re } of LEVEL_RULES) if (re.test(text)) levels.add(level);
  return levels;
}

/** 从句/并列标记计数——塞进一个选项的"小答案"通常靠这些连接词堆出来。 */
function clauseMarkers(text: string): number {
  const m = text.match(/[；;]|，|、|并且|而且|同时|此外|另外|因此|所以|因为|由于|以及|还有/g);
  return m ? m.length : 0;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function audit(q: Question): Finding[] {
  const out: Finding[] = [];
  const choice = q.formats.choice;
  if (!choice) return out;
  const { options, answer } = choice;
  const correct = answer.filter((i) => i < options.length).map((i) => options[i]);
  const distractors = options.filter((_, i) => !answer.includes(i));
  if (correct.length === 0 || distractors.length === 0) return out;

  // ① 正确项层级不一致：≥3 个正确项跨 ≥3 个认知层级 → 不是在同一层面上做判断
  if (correct.length >= 3) {
    const levels = new Set<string>();
    for (const c of correct) for (const l of levelsOf(c)) levels.add(l);
    if (levels.size >= 3) {
      out.push({
        id: q.id,
        detector: 'mixed-correct-level',
        detail: `${correct.length} 个正确项跨 ${levels.size} 个认知层级（${[...levels].join(' / ')}）`,
      });
    }
  }

  // ② 选项塞整段答案：单选项 ≥3 个从句标记，且长度 ≥ 同题其它选项长度中位数 1.6 倍
  const othersMedian = options.map((_, i) => median(options.filter((__, j) => j !== i).map((o) => o.length)));
  options.forEach((opt, i) => {
    const markers = clauseMarkers(opt);
    const ratio = othersMedian[i] > 0 ? opt.length / othersMedian[i] : 0;
    if (markers >= 3 && ratio >= 1.6) {
      out.push({
        id: q.id,
        detector: 'stuffed-option',
        detail: `选项 ${i} 含 ${markers} 个从句标记且为其中位数的 ${ratio.toFixed(1)}×：「${opt.slice(0, 40)}…」`,
      });
    }
  });

  // ③ 信息密度泄题：长度 lint 只看全局 max/min，看不出"所有正确项都更具体"这一类。
  //    这里用正确项/干扰项的**平均长度比**（阈值 1.5）+ 具体度标记（数字/英文术语）。
  const specificity = (t: string) => (t.match(/[0-9]+(\.[0-9]+)?%?/g)?.length ?? 0) + (t.match(/[A-Za-z]{2,}/g)?.length ?? 0);
  const meanCorrect = correct.reduce((s, t) => s + t.length, 0) / correct.length;
  const meanDistractor = distractors.reduce((s, t) => s + t.length, 0) / distractors.length;
  const densityRatio = meanDistractor > 0 ? meanCorrect / meanDistractor : 1;
  const specCorrect = correct.reduce((s, t) => s + specificity(t), 0) / correct.length;
  const specDistractor = distractors.reduce((s, t) => s + specificity(t), 0) / distractors.length;
  if (densityRatio >= 1.5 && specCorrect > specDistractor) {
    out.push({
      id: q.id,
      detector: 'density-cueing',
      detail: `正确项均长 ${meanCorrect.toFixed(0)} vs 干扰项 ${meanDistractor.toFixed(0)}（${densityRatio.toFixed(2)}×），具体度 ${specCorrect.toFixed(1)} vs ${specDistractor.toFixed(1)}`,
    });
  }

  // ④ 多选只考一个判断：正确项两两 token_set_ratio ≥70 → 互为复述，实际只考了一个判断点
  if (correct.length >= 2) {
    let maxPair = 0;
    for (let i = 0; i < correct.length; i++) {
      for (let j = i + 1; j < correct.length; j++) {
        maxPair = Math.max(maxPair, fuzz.token_set_ratio(correct[i], correct[j]));
      }
    }
    if (maxPair >= 70) {
      out.push({
        id: q.id,
        detector: 'single-judgement',
        detail: `正确项最高两两相似度 ${maxPair}（≥70），疑似同一判断点的复述`,
      });
    }
  }

  return out;
}

function readJsonDir(dir: string): Question[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .flatMap((f) => JSON.parse(readFileSync(dir + f, 'utf8')) as Question[]);
}

const questions = readJsonDir(dataDir + 'questions/');
const all: Finding[] = questions.flatMap(audit);
const choiceTotal = questions.filter((q) => q.formats.choice).length;

if (asJson) {
  console.log(JSON.stringify(all, null, 2));
} else {
  console.log(
    `题库内容质量审计（只读检测，非门禁）：${choiceTotal} 道选择题，命中 ${all.length} 条嫌疑信号\n` +
      '注意：以下均为词汇/统计层面的嫌疑信号，不是语义判定；命中 = 值得人工复核，不等于必须改写。\n',
  );
  for (const id of Object.keys(DETECTOR_LABEL) as DetectorId[]) {
    const hits = all.filter((f) => f.detector === id);
    console.log(`${DETECTOR_LABEL[id]}  →  ${hits.length} 条`);
    const show = only != null ? hits.slice(0, only) : hits.slice(0, topN);
    for (const h of show) console.log(`    · ${h.id}：${h.detail}`);
    if (hits.length > show.length) console.log(`    …另有 ${hits.length - show.length} 条（--top N 调整显示量）`);
    console.log('');
  }
  const ids = new Set(all.map((f) => f.id));
  console.log(
    `汇总：${ids.size} 道不同题目命中（占选择题 ${((ids.size / choiceTotal) * 100).toFixed(1)}%）\n` +
      '用法：--json 输出结构化结果喂给 LLM challenger；--top N 控制每类显示条数；--only N 等价于 --top N。',
  );
}
