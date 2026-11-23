// npm run lint:length —— 选择题答案长度暗示门禁（ratio ≤1.7、均长差 ≤8、单选正确项领先 ≤4）。
//
// 设计（与 lint:bias 一致，但更聚焦）：
//   - 默认扫描全库并【仅报告】，不阻断流程。历史题库存在大量存量失衡（约 253 道），
//     直接进 validate 会让它永远红，故做成可单独运行的 lint。
//   - --changed：按 git diff 取变更题目文件，对其中【新增或内容发生变化的题目对象】做门禁，
//     命中即 exit 1。修改已有题目的选项不能再通过"ID 已存在"逃过检查。
//   - --json：机器可读输出。
//
// 阈值来源：docs/question-content-spec.md §7；纯函数定义位于 src/domain/bias.ts。

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Question } from '../src/schemas/question.ts';
import { detectAnswerLengthBalance, detectOptionLengthRatio } from '../src/domain/bias.ts';

const dataDir = fileURLToPath(new URL('../src/data/questions/', import.meta.url));
const THRESHOLD = 1.7;
const MAX_AVERAGE_GAP = 8;
const MAX_SINGLE_CORRECT_LEAD = 4;
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
  ratio: number;
  maxLen: number;
  minLen: number;
  meanCorrect: number;
  meanDistractor: number;
  averageGap: number;
  singleCorrectLead: number;
  reasons: string[];
}

function git(argv: string[]): string {
  try {
    return execFileSync('git', argv, { encoding: 'utf8' }).toString();
  } catch {
    return '';
  }
}

// 新增或修改的题目 ID 集合；非 --changed 模式返回 null（即全库扫描）。
function changedQuestionIds(): Set<string> | null {
  if (!changedOnly) return null;
  const base = baseRef();
  const files = git(['diff', '--name-only', base, '--', QUESTIONS_PREFIX])
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.startsWith(QUESTIONS_PREFIX) && s.endsWith('.json'));
  const changedIds = new Set<string>();
  for (const file of files) {
    const currentPath = resolve(process.cwd(), file);
    if (!existsSync(currentPath)) continue;
    const currentQuestions = collectQuestionSignatures(readFileSync(currentPath, 'utf8'));
    const baseQuestions = collectQuestionSignatures(git(['show', `${base}:${file}`]));
    for (const [id, signature] of currentQuestions) {
      if (baseQuestions.get(id) !== signature) changedIds.add(id);
    }
  }
  return changedIds;
}

function baseRef(): string {
  const resolveCommit = (ref: string) => git(['rev-parse', '--verify', `${ref}^{commit}`]).trim();
  if (baseArg) {
    const resolved = resolveCommit(baseArg);
    if (!resolved) throw new Error(`指定的 base commit 不存在：${baseArg}`);
    return resolved;
  }
  const head = resolveCommit('HEAD');
  const explicitCandidates = [
    process.env.GITHUB_BASE_SHA,
    process.env.GITHUB_EVENT_BEFORE,
    process.env.VERCEL_GIT_PREVIOUS_SHA,
  ].filter((value): value is string => Boolean(value && !/^0+$/.test(value)));
  for (const candidate of explicitCandidates) {
    const resolved = resolveCommit(candidate);
    if (resolved) return resolved;
  }
  for (const candidate of ['origin/main', 'origin/master', 'main', 'master']) {
    const mergeBase = git(['merge-base', 'HEAD', candidate]).trim();
    if (mergeBase && mergeBase !== head) return mergeBase;
  }
  const parent = resolveCommit('HEAD^');
  if (parent) return parent;
  throw new Error('无法解析题目变更的 base commit；拒绝以 0 道扫描结果假装通过，请显式传入 --base <sha>');
}

function collectQuestionSignatures(raw: string): Map<string, string> {
  const signatures = new Map<string, string>();
  if (!raw) return signatures;
  try {
    const questions = JSON.parse(raw);
    if (Array.isArray(questions)) {
      for (const question of questions) {
        if (question && typeof question.id === 'string') {
          signatures.set(question.id, JSON.stringify(question));
        }
      }
    }
  } catch {
    // 基线文件不存在或不合法时返回空映射；当前文件由题库契约单独校验。
  }
  return signatures;
}

function loadAllWithFile(): { file: string; questions: Question[] }[] {
  return readdirSync(dataDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({ file: f, questions: JSON.parse(readFileSync(dataDir + f, 'utf8')) as Question[] }));
}

let gateIds: Set<string> | null;
try {
  gateIds = changedQuestionIds();
} catch (error) {
  console.error(`增量题目长度门禁无法确定变更基线：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
const hits: Hit[] = [];
let scanned = 0;
for (const { file, questions } of loadAllWithFile()) {
  for (const q of questions) {
    const choice = q.formats?.choice;
    if (!q.id || !choice) continue;
    if (gateIds && !gateIds.has(q.id)) continue; // --changed：新增和修改过的题目对象
    scanned++;
    const ratio = detectOptionLengthRatio(choice.options, THRESHOLD);
    const balance = detectAnswerLengthBalance(choice.options, choice.answer, choice.type, MAX_AVERAGE_GAP, MAX_SINGLE_CORRECT_LEAD);
    const reasons: string[] = [];
    if (ratio.biased) reasons.push('最长/最短比 ' + ratio.ratio.toFixed(2) + '× > ' + THRESHOLD);
    if (balance.biased) reasons.push(balance.detail);
    if (reasons.length) {
      hits.push({
        id: q.id,
        file,
        ratio: ratio.ratio,
        maxLen: ratio.maxLen,
        minLen: ratio.minLen,
        meanCorrect: balance.meanCorrect,
        meanDistractor: balance.meanDistractor,
        averageGap: balance.averageGap,
        singleCorrectLead: balance.singleCorrectLead,
        reasons,
      });
    }
  }
}

if (asJson) {
  console.log(JSON.stringify({ threshold: THRESHOLD, changedOnly, scanned, hits }, null, 2));
  process.exit(changedOnly && hits.length ? 1 : 0);
}

const preview = verbose ? hits : hits.slice(0, 15);
for (const h of preview) {
  console.warn(`⚠ [answer-length] ${h.id} (${h.file}): ${h.reasons.join('；')}；字符数 ${h.maxLen}/${h.minLen}，正确/干扰均长 ${h.meanCorrect.toFixed(1)}/${h.meanDistractor.toFixed(1)}`);
}
if (!verbose && hits.length > preview.length) {
  console.warn(`  …（另有 ${hits.length - preview.length} 道，使用 --all 查看全部）`);
}

const scope = changedOnly ? '本次新增或修改的题目对象' : '全库';
console.log(
  `\n[${changedOnly ? 'changed' : 'all'}] 共扫描选择题 ${scanned} 道，答案长度暗示命中 ${hits.length} 道（比例上限 ${THRESHOLD}、均长差上限 ${MAX_AVERAGE_GAP}、单选领先上限 ${MAX_SINGLE_CORRECT_LEAD}，${scope}）`,
);
if (changedOnly) {
  console.log('提示：新增或修改题目的长度比、答案均长差或单选最大领先超限，都会在 CI 失败；请重写整组选项，不要用无关文字填充干扰项。');
}
// 仅 --changed 模式硬失败；全库默认仅报告，供历史存量逐步整改。
process.exit(changedOnly && hits.length ? 1 : 0);
