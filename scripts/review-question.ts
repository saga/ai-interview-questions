// npm run question:review -- <question-id> [--json]
// Lightweight, offline single-question review. Shows the question, its same
// (topic × angle) siblings, lexical near-duplicate candidates, option-length
// cue, and a REVIEW checklist. No DB / external API. The verdict is advisory
// only — it is a signal, not a hard gate.

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseQuestionArray, type Question } from '../src/schemas/question.ts';
import { detectOptionLengthRatio } from '../src/domain/bias.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const questionsDir = resolve(root, 'src/data/questions');

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readJsonArrays<T>(directory: string): T[] {
  return readdirSync(directory)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .flatMap((file) => JSON.parse(readFileSync(resolve(directory, file), 'utf8')) as T[]);
}

function normalizedText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '');
}

// Character-bigram Jaccard: cheap, dependency-free proxy for "same question
// phrased differently". The dedicated semantic check lives in `question:analysis --semantic`.
function bigramSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const ba = new Set<string>();
  for (let i = 0; i < a.length - 1; i++) ba.add(a.slice(i, i + 2));
  const bb = new Set<string>();
  for (let i = 0; i < b.length - 1; i++) bb.add(b.slice(i, i + 2));
  if (!ba.size || !bb.size) return 0;
  let inter = 0;
  for (const g of ba) if (bb.has(g)) inter++;
  return inter / (ba.size + bb.size - inter);
}

const targetId = process.argv[2] ?? arg('--id');
const asJson = process.argv.includes('--json');
if (!targetId) {
  console.error('用法：npm run question:review -- <question-id> [--json]');
  process.exit(2);
}

const all = readJsonArrays<Question>(questionsDir);
const target = all.find((q) => q.id === targetId);
if (!target) {
  console.error(`未找到题目：${targetId}`);
  process.exit(1);
}

const sameCell = all.filter((q) => q.id !== target.id && q.topic === target.topic && q.angle === target.angle);
const targetNorm = normalizedText(target.question);
const neighbors = all
  .filter((q) => q.id !== target.id)
  .map((q) => ({ id: q.id, score: bigramSimilarity(targetNorm, normalizedText(q.question)) }))
  .filter((n) => n.score >= 0.8)
  .sort((a, b) => b.score - a.score)
  .slice(0, 5);

const choice = target.formats?.choice;
const lengthReport = choice ? detectOptionLengthRatio(choice.options) : null;
const answerSet = new Set<number>(choice?.answer ?? []);
const optionLengths = (choice?.options ?? []).map((o) => o.length);
const maxLen = optionLengths.length ? Math.max(...optionLengths) : 0;
const answerIsLongest = choice ? choice.options.some((o, i) => answerSet.has(i) && o.length === maxLen) : false;

const flags: string[] = [];
if (lengthReport?.biased) flags.push('选项长度比 > 1.8（长度泄题风险）');
if (answerIsLongest) flags.push('正确项恰好最长（可能靠信息量而非判断胜出）');
if (sameCell.length >= 3) flags.push(`同 topic×angle 已有 ${sameCell.length} 题（重复堆砌风险）`);
if (neighbors.length) flags.push(`${neighbors.length} 个近重复候选`);

let verdict: 'KEEP' | 'REVIEW' | 'REWRITE';
if (lengthReport?.biased || answerIsLongest) verdict = 'REWRITE';
else if (flags.length) verdict = 'REVIEW';
else verdict = 'KEEP';

if (asJson) {
  console.log(
    JSON.stringify(
      {
        target,
        sameCellCount: sameCell.length,
        sameCellIds: sameCell.map((q) => q.id),
        nearDuplicates: neighbors,
        optionLength: lengthReport,
        answerIsLongest,
        verdict,
        flags,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const line = (s = '') => console.log(s);
line(`Review: ${target.id}`);
line(`  topic=${target.topic}   angle=${target.angle ?? '<none>'}   difficulty=${target.difficulty}`);
line('');
line(`Q: ${target.question}`);
if (target.explanation) line(`A(explanation): ${target.explanation}`);
if (choice) {
  line('');
  choice.options.forEach((opt, i) => {
    const mark = answerSet.has(i) ? ' ✓' : '  ';
    line(`  ${i}${mark} [${opt.length}] ${opt}`);
  });
  line(`  answer = [${choice.answer.join(', ')}]  (${choice.type})`);
}
line('');
line('── 信号 ──────────────────────────────────────────');
line(`  同 (topic×angle) 在题库中已有：${sameCell.length} 题` + (sameCell.length ? ` → ${sameCell.map((q) => q.id).join(', ')}` : ''));
if (lengthReport) {
  const tag = lengthReport.biased ? '⚠ 长度失衡' : 'OK';
  line(`  选项长度比：${lengthReport.maxLen}/${lengthReport.minLen} = ${lengthReport.ratio.toFixed(1)}×  ${tag}`);
}
line(`  近重复候选（词面，非语义；语义见 question:analysis --semantic）：${neighbors.length ? neighbors.map((n) => `${n.id}(${(n.score * 100).toFixed(0)}%)`).join(', ') : '无'}`);
line('');
line('── REVIEW checklist ─────────────────────────────');
line('  [auto]  Concept Scope      ：确认只测一个核心 Concept（concepts 首项）。混多独立主题？Y/N 人工判断');
line(`  [auto]  Cognitive Task     ：angle=${target.angle ?? '<none>'} 是否与所考认知任务一致（判断机制/比较/debug/工程判断，而非记术语）？人工判断`);
line(
  `  [auto]  Answer Determinism ：type=${choice?.type ?? 'open-only'} → ` +
    (choice?.type === 'single'
      ? '确保恰好一个选项在题干约束下恒成立'
      : choice?.type === 'multiple'
        ? '确保每个正确项独立成立、每个错误项独立可解释地错'
        : '仅开放题，无 choice 确定性约束'),
);
line(
  `  [auto]  Option Quality      ：` +
    (answerIsLongest ? '⚠ 正确项恰为最长，可能靠信息量胜出而非技术判断' : '正确项未因"更完整/更多组件"自然胜出 OK（需人工确认同决策层级）'),
);
line('  [manual] Diagnostic Value   ：考生答错后能否较明确反映缺哪个 Concept/机制/判断？人工判断');
line('');
line('── 结论（仅供参考，非硬门禁）──────────────────────');
line(`  ${verdict}` + (flags.length ? `  ← ${flags.join('；')}` : '  ← 未发现自动告警项，仍需人工确认清单'));
