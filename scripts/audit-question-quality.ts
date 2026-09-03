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
//
// ── 2026-09-03 人工抽检基线（20 条分层抽样，seed 20260902）─────────────────
// 结论表见 docs/improvement_plan/quality-audit-2026-09-03.md。核心一条：
//   **探测器只能排人工复核的先后顺序，不能直接当改写清单。**
// 实测精确率：① 0/4 = 0% · ② 1/7 = 14% · ③ 3/8 = 38% · ④ 1/1（样本不足）· 总体 5/20 = 25%
// 据此做了两处调整：
//   ① 判据在多选上不成立（多选正确项本就该跨考察点）→ 默认停用，--all-detectors 复现
//   ② 阈值太松（1.6× 命中的多是「完整论证的正常长度」）→ 收紧到 markers≥5 且 ratio≥2.0
//   ③ 调阈值无效（判「是」与判误报的 ratio 区间完全重叠），降级为排序信号，见 question_curate.py Rule K

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as fuzz from 'fuzzball';
import type { Question } from '../src/schemas/question';

const dataDir = fileURLToPath(new URL('../src/data/', import.meta.url));
const asJson = process.argv.includes('--json');
const topArgIdx = process.argv.indexOf('--top');
const topN = topArgIdx >= 0 ? Number(process.argv[topArgIdx + 1]) : 15;
const onlyArgIdx = process.argv.indexOf('--only');
const only = onlyArgIdx >= 0 ? Number(process.argv[onlyArgIdx + 1]) : null;

// ── 人工抽检基线（A-8 后半）─────────────────────────────────────────────
// 探测器只能给候选集，精确率（命中且确为缺陷的比例）必须靠人工判断。
// 为了让这一步**可复现、可交接**，这里提供：
//   --sample <n>           从全部命中里按探测器**分层**抽 n 条（比例配额 + 最大余数法）
//   --seed <n>             伪随机种子（默认 20260902），同种子必得同一样本
//   --review-sheet <file>  把抽中的题连同题干/选项/正确项标注写成 Markdown 复核表
// 三者都不改变脚本的只读性质：仍恒 exit 0，仍不加门禁。
const sampleArgIdx = process.argv.indexOf('--sample');
const sampleN = sampleArgIdx >= 0 ? Math.max(0, Number(process.argv[sampleArgIdx + 1]) || 0) : 0;
const seedArgIdx = process.argv.indexOf('--seed');
const seed = seedArgIdx >= 0 ? Number(process.argv[seedArgIdx + 1]) || 20260902 : 20260902;
const sheetArgIdx = process.argv.indexOf('--review-sheet');
const sheetPath = sheetArgIdx >= 0 ? process.argv[sheetArgIdx + 1] : null;
// 精确率 0/4、判据在多选上不成立的探测器，默认不输出；加此开关可复现旧行为。
const allDetectors = process.argv.includes('--all-detectors');

/** mulberry32：小而够用的确定性 PRNG，保证 --seed 可复现。 */
function mulberry32(a: number): () => number {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 分层抽样：按 detector 分组，配额按各组命中占比分配（最大余数法补齐到 n），
 * 组内用带种子的洗牌取样。目的是让小类（如 ④ 只有 3 条）也进得了样本，
 * 否则按比例抽样会把它们整个漏掉，基线就只反映 ②③ 两个大头。
 */
function stratifiedSample(all: Finding[], n: number, seedValue: number): Finding[] {
  if (n <= 0 || all.length === 0) return [];
  const groups = new Map<DetectorId, Finding[]>();
  for (const f of all) {
    const g = groups.get(f.detector) ?? [];
    g.push(f);
    groups.set(f.detector, g);
  }
  const ids = [...groups.keys()];
  const rand = mulberry32(seedValue);

  // 组内洗牌（Fisher–Yates，用同一 rand 流，保证整体可复现）
  const shuffled = new Map<DetectorId, Finding[]>();
  for (const id of ids) {
    const arr = [...groups.get(id)!];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    shuffled.set(id, arr);
  }

  // 比例配额（向下取整），并保底每层 1 条——否则占比小的层会被整个漏掉：
  // n=20 时 ④ 的比例配额只有 3/266×20 ≈ 0.23 → floor 0，基线就只反映 ②③ 两个大头。
  const quota = new Map<DetectorId, number>();
  const take = new Map<DetectorId, number>();
  const minEach = n >= ids.length ? 1 : 0;
  for (const id of ids) {
    const q = (groups.get(id)!.length / all.length) * n;
    quota.set(id, q);
    take.set(id, Math.max(Math.floor(q), minEach));
  }
  // 余额按「配额余数」从大到小补；每轮只补 1 条，避免余额被一个大组吃掉。
  // 反向情况（n 小于层数导致保底后超采）则从超出最多的层往回收。
  let left = n - [...take.values()].reduce((s, t) => s + t, 0);
  while (left > 0) {
    const cands = ids.filter((id) => take.get(id)! < groups.get(id)!.length);
    if (cands.length === 0) break; // 各层命中数都不足配额，样本注定小于 n
    cands.sort((a, b) => quota.get(b)! - take.get(b)! - (quota.get(a)! - take.get(a)!));
    take.set(cands[0], take.get(cands[0])! + 1);
    left--;
  }
  while (left < 0) {
    const cands = ids.filter((id) => take.get(id)! > minEach);
    if (cands.length === 0) break;
    cands.sort((a, b) => take.get(b)! - take.get(a)!);
    take.set(cands[0], take.get(cands[0])! - 1);
    left++;
  }

  const out: Finding[] = [];
  for (const id of ids) out.push(...shuffled.get(id)!.slice(0, take.get(id)!));
  return out;
}

interface Finding {
  id: string;
  detector: DetectorId;
  detail: string;
}

type DetectorId = 'mixed-correct-level' | 'stuffed-option' | 'density-cueing' | 'single-judgement';

/** 实测精确率（20 条人工抽检，seed 20260902）——直接显示在审计输出里，别再凭直觉信任探测器。 */
const DETECTOR_PRECISION: Record<DetectorId, string> = {
  'mixed-correct-level': '精确率 0/4 = 0%，判据不成立，默认停用',
  'stuffed-option': '精确率 1/7 = 14%（阈值已收紧，待重测）',
  'density-cueing': '精确率 3/8 = 38%，仅作排序信号，不得据以改写',
  'single-judgement': '精确率 1/1（样本不足，全库仅 3 条）',
};

const DETECTOR_LABEL: Record<DetectorId, string> = {
  'mixed-correct-level': '① 正确项认知层级不一致（定义/收益/反面/条件混杂）',
  'stuffed-option': '② 选项塞整段答案（多从句 / 显著长于中位数）',
  'density-cueing': '③ 信息密度泄题（正确项具体度显著高于干扰项）',
  'single-judgement': '④ 多选只考一个判断（正确项互为复述）',
};

const DETECTOR_ORDER = Object.keys(DETECTOR_LABEL) as DetectorId[];
/** 默认不启用的探测器（人工抽检判据不成立）。 */
const DISABLED_BY_DEFAULT: DetectorId[] = ['mixed-correct-level'];
function isEnabled(id: DetectorId): boolean {
  return allDetectors || !DISABLED_BY_DEFAULT.includes(id);
}

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
  // 人工抽检 0/4：四条全是多选，而多选的正确项本就应该分属不同考察点，
  // 「跨层级」是多选的固有形态。没有任何阈值能救 ⇒ 默认停用。
  if (correct.length >= 3 && isEnabled('mixed-correct-level')) {
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

  // ② 选项塞整段答案：单选项 ≥5 个从句标记，且长度 ≥ 同题其它选项长度中位数 2.0 倍。
  // 原阈值（≥3 标记 / ≥1.6×）人工抽检 1/7：命中的多是「完整论证的正常长度」，
  // 或最长的根本是干扰项而非正确项（agentic-43 / ai-engineering-001），长度信号不成立。
  const othersMedian = options.map((_, i) => median(options.filter((__, j) => j !== i).map((o) => o.length)));
  options.forEach((opt, i) => {
    const markers = clauseMarkers(opt);
    const ratio = othersMedian[i] > 0 ? opt.length / othersMedian[i] : 0;
    if (markers >= 5 && ratio >= 2.0) {
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
const byId = new Map<string, Question>();
for (const q of questions) byId.set(q.id, q);

/** 单条 finding 的人工复核卡：给足判据（题干/选项/正确项/解析），再留待填结论。 */
function renderReviewCard(h: Finding, idx: number): string {
  const q = byId.get(h.id);
  const lines: string[] = [`### ${idx}. \`${h.id}\``, '', `**探测器**：${DETECTOR_LABEL[h.detector]}`, '', `**命中详情**：${h.detail}`, ''];
  if (!q) {
    lines.push('> ⚠️ 题库中找不到该 id（题已删除或改过 id），本条作废，不计入分母。', '');
    return lines.join('\n');
  }
  lines.push(`**题干**：${q.question}`, '');
  const choice = q.formats.choice;
  if (choice) {
    lines.push(`**选项**（✓ = 正确项，${choice.type === 'single' ? '单选' : '多选'}）：`, '');
    choice.options.forEach((o, i) => {
      lines.push(`- ${String.fromCharCode(65 + i)}. ${o}${choice.answer.includes(i) ? '　✓' : ''}`);
    });
    lines.push('', `**解析**：${q.explanation}`, '');
  }
  lines.push('**是否确为缺陷**： ☐ 是（需改写）　☐ 否（误报）', '', '**理由**：', '');
  return lines.join('\n');
}

function buildReviewSheet(sample: Finding[]): string {
  const hitQuestions = new Set(all.map((f) => f.id)).size;
  const head = [
    '# 题库内容质量 · 人工抽检复核表',
    '',
    `- 生成命令：\`npm run question:quality -- --sample ${sampleN} --seed ${seed} --review-sheet <path>\``,
    `- 生成时间：${new Date().toISOString()}`,
    `- 总体：${choiceTotal} 道选择题，命中 ${all.length} 条信号，涉及 ${hitQuestions} 道题（${((hitQuestions / choiceTotal) * 100).toFixed(1)}%）`,
    `- 本样本：${sample.length} 条（按探测器分层、比例配额 + 最大余数法，种子 ${seed}）`,
    '',
    '## 判定口径',
    '',
    '判定「是（需改写）」的标准只有一条：**这道题的干扰项是否已经失去区分度**，',
    '即不看解析也能靠长度/具体度/表述严谨度把正确项挑出来，或多个正确项其实只是同一句话的复述。',
    '仅「选项偏长」但干扰项同样有实质内容、需要真懂才能排除的，判**误报**。',
    '',
    '---',
    '',
  ];
  const body: string[] = [];
  let cardNo = 0;
  for (const id of DETECTOR_ORDER) {
    const group = sample.filter((f) => f.detector === id);
    if (group.length === 0) continue;
    const total = all.filter((f) => f.detector === id).length;
    body.push(`## ${DETECTOR_LABEL[id]}`, '', `> 该类共命中 ${total} 条，本样本抽 ${group.length} 条。`, '');
    for (const h of group) body.push(renderReviewCard(h, ++cardNo), '---', '');
  }
  const tail = [
    '## 汇总口径',
    '',
    '精确率 = 「是（需改写）」条数 ÷ 已判定条数（作废条不计入分母）。分探测器各算一次，再算总体。',
    '',
    '| 精确率 | 结论 |',
    '| ----- | ---- |',
    '| ≥ 60% | 可直接用于排人工复核优先级 |',
    '| 40–60% | 可用，但先收紧阈值再日常使用 |',
    '| < 40% | 阈值太松，先调探测器，不要按清单改写 |',
    '',
    '判定完成后把结论贴回 `ACTION_CHECKLIST.md` 第 8 项，并记录「命中数 / 抽样数 / 精确率」。',
    '',
  ];
  return [...head, ...body, ...tail].join('\n');
}

const sample = stratifiedSample(all, sampleN, seed);

if (asJson) {
  console.log(JSON.stringify(sampleN > 0 ? sample : all, null, 2));
} else {
  console.log(
    `题库内容质量审计（只读检测，非门禁）：${choiceTotal} 道选择题，命中 ${all.length} 条嫌疑信号\n` +
      '注意：以下均为词汇/统计层面的嫌疑信号，不是语义判定；命中 = 值得人工复核，不等于必须改写。\n',
  );
  for (const id of DETECTOR_ORDER) {
    const hits = all.filter((f) => f.detector === id);
    const tag = isEnabled(id) ? DETECTOR_PRECISION[id] : `已停用（${DETECTOR_PRECISION[id]}；--all-detectors 复现）`;
    console.log(`${DETECTOR_LABEL[id]}  →  ${hits.length} 条　[${tag}]`);
    const show = only != null ? hits.slice(0, only) : hits.slice(0, topN);
    for (const h of show) console.log(`    · ${h.id}：${h.detail}`);
    if (hits.length > show.length) console.log(`    …另有 ${hits.length - show.length} 条（--top N 调整显示量）`);
    console.log('');
  }
  const ids = new Set(all.map((f) => f.id));
  console.log(`汇总：${ids.size} 道不同题目命中（占选择题 ${((ids.size / choiceTotal) * 100).toFixed(1)}%）`);

  if (sampleN > 0) {
    console.log(`\n── 分层抽样（n=${sampleN}，seed=${seed}）──`);
    for (const id of DETECTOR_ORDER) {
      const g = sample.filter((f) => f.detector === id);
      const total = all.filter((f) => f.detector === id).length;
      if (total === 0) continue;
      console.log(`  ${DETECTOR_LABEL[id]}：抽 ${g.length} / ${total}`);
    }
    if (sample.length < sampleN) {
      console.log(`  ⚠ 实际只抽到 ${sample.length} 条（某些类的命中数不足配额）`);
    }
  }

  if (sheetPath) {
    if (sample.length === 0) {
      console.log('\n⚠ 未生成复核表：请先指定 --sample N（>0）。');
    } else {
      writeFileSync(sheetPath, buildReviewSheet(sample), 'utf8');
      console.log(`\n✓ 复核表已写入：${sheetPath}（${sample.length} 条待人工判定）`);
    }
  }

  console.log(
    '\n用法：--json 输出结构化结果喂给 LLM challenger；--top N 控制每类显示条数；--only N 等价于 --top N；\n' +
      '      --sample N --seed S 做可复现的分层抽样；--review-sheet <file> 导出 Markdown 人工复核表。',
  );
}
