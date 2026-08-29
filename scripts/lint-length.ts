// npm run lint:length —— 选项「长度比泄题」门禁（最长/最短选项长度比 > 1.8）。
//
// 设计（与 lint:bias 一致，但更聚焦）：
//   - 默认扫描全库并【仅报告】，不阻断流程。历史题库存在大量存量失衡（约 253 道），
//     直接进 validate 会让它永远红，故做成可单独运行的 lint。
//   - --changed：按 git diff 取变更题目文件，仅对其中【新增的题目 ID】做门禁，
//     命中即 exit 1。用于 CI 防止"长度泄题"再次被批量引入（对应 AGENTS.md §4.2）。
//   - --json：机器可读输出。
//
// 阈值来源：detectOptionLengthRatio（src/domain/bias.ts），默认 1.8。

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Question } from '../src/schemas/question.ts';
import { detectOptionLengthRatio } from '../src/domain/bias.ts';

const dataDir = fileURLToPath(new URL('../src/data/questions/', import.meta.url));
const THRESHOLD = 1.8;
const QUESTIONS_PREFIX = 'src/data/questions/';

const args = process.argv.slice(2);
const changedOnly = args.includes('--changed');
const asJson = args.includes('--json');
const verbose = args.includes('--all') || args.includes('--verbose');
const baseArgIndex = args.indexOf('--base');
const baseArg = baseArgIndex >= 0 ? args[baseArgIndex + 1] : undefined;

interface Hit {
  id: string;
  file: string;
  maxLen: number;
  minLen: number;
  ratio: number;
  maxIdx: number;
  minIdx: number;
}

function git(argv: string[]): string {
  try {
    return execFileSync('git', argv, { encoding: 'utf8' }).toString();
  } catch {
    return '';
  }
}

// 变更的"新增题目 ID"集合；非 --changed 模式返回 null（即不限制，全库扫描）。
function changedNewQuestionIds(): Set<string> | null {
  if (!changedOnly) return null;
  const base = baseRef();
  const files = git(['diff', '--name-only', base, '--', QUESTIONS_PREFIX])
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.startsWith(QUESTIONS_PREFIX) && s.endsWith('.json'));
  const newIds = new Set<string>();
  for (const file of files) {
    const headIds = collectIds(git(['show', `HEAD:${file}`]));
    const baseIds = collectIds(git(['show', `${base}:${file}`])); // 新增文件在 base 不存在 → 空集合
    for (const id of headIds) if (!baseIds.has(id)) newIds.add(id);
  }
  return newIds;
}

function baseRef(): string {
  if (baseArg) return baseArg;
  for (const candidate of ['origin/main', 'origin/master', 'main', 'master']) {
    const ref = git(['merge-base', 'HEAD', candidate]).trim();
    if (ref) return ref;
  }
  return 'HEAD~1';
}

function collectIds(raw: string): Set<string> {
  const ids = new Set<string>();
  if (!raw) return ids;
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) for (const q of arr) if (q && typeof q.id === 'string') ids.add(q.id);
  } catch {
    /* ignore malformed */
  }
  return ids;
}

function loadAllWithFile(): { file: string; questions: Question[] }[] {
  return readdirSync(dataDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({ file: f, questions: JSON.parse(readFileSync(dataDir + f, 'utf8')) as Question[] }));
}

const gateIds = changedNewQuestionIds();
const hits: Hit[] = [];
let scanned = 0;
for (const { file, questions } of loadAllWithFile()) {
  for (const q of questions) {
    if (!q.id || !q.formats?.choice) continue;
    if (gateIds && !gateIds.has(q.id)) continue; // --changed：只看新增题目
    scanned++;
    const r = detectOptionLengthRatio(q.formats.choice.options, THRESHOLD);
    if (r.biased) {
      hits.push({ id: q.id, file, maxLen: r.maxLen, minLen: r.minLen, ratio: r.ratio, maxIdx: r.maxIdx, minIdx: r.minIdx });
    }
  }
}

if (asJson) {
  console.log(JSON.stringify({ threshold: THRESHOLD, changedOnly, scanned, hits }, null, 2));
  process.exit(changedOnly && hits.length ? 1 : 0);
}

const preview = verbose ? hits : hits.slice(0, 15);
for (const h of preview) {
  console.warn(`⚠ [length-ratio] ${h.id} (${h.file}): 最长 ${h.maxLen} / 最短 ${h.minLen} = ${h.ratio.toFixed(1)}× > 1.8`);
}
if (!verbose && hits.length > preview.length) {
  console.warn(`  …（另有 ${hits.length - preview.length} 道，使用 --all 查看全部）`);
}

const scope = changedOnly ? '本次变更文件中的新增题目' : '全库';
console.log(
  `\n[${changedOnly ? 'changed' : 'all'}] 共扫描选择题 ${scanned} 道，选项长度比 > 1.8 的 ${hits.length} 道（阈值 ${THRESHOLD}，${scope}）`,
);
if (changedOnly) {
  console.log('提示：新题长度比 > 1.8 会在 CI 失败；请让各选项篇幅接近后再提交（历史存量失衡由 question:audit 以 P2 持续可见）。');
}
// 仅 --changed 模式硬失败；全库默认仅报告（历史存量失衡多，不能让它永远红）。
process.exit(changedOnly && hits.length ? 1 : 0);
