// npm run fix:bias —— 批量修复选择题「选项长度泄题」（root-cause 根治，复用 anti-cueing 思路）。
//
// 目标：对 lint:bias 标记的 strong 档选择题，用 LLM「只重排选项长度」，保持：
//   - 题干（formats.choice.question）不变
//   - 正确选项索引（answer）不变
//   - 各选项语义（正确项结论、干扰项错误结论）不变
//   - 选项数量不变
//   - 解析（explanation）/ open 格式等其他字段不变
// 仅把「正确项系统性最长 + 极短干扰项」的不均衡改写为各选项篇幅/细节相近。
//
// 安全模型：
//   - 候选写盘到 src/data/questions.biasfix/（与源结构同构），不触碰源文件；
//     仅当显式传 --merge 时才把候选覆写回 src/data/questions/（用户 review 后手动触发）。
//   - 进度写 biasfix-report.json（resume 用），不会因中途失败丢失已完成的题。
//   - 绝不自动 git commit。
//
// Provider 配置来源（按优先级）：
//   1. --config <path>  JSON 文件（ProviderEntry，或 {providers:[...]} / AIConfig 形态）
//   2. 环境变量 FIXBIAS_PROVIDER / FIXBIAS_MODEL / FIXBIAS_API_KEY / FIXBIAS_BASE_URL / FIXBIAS_ACCOUNT_ID
//   3. 默认文件 data/provider.local.json（已被 .gitignore 忽略，切勿提交）
//
// 用法：
//   node scripts/fix-bias.ts --dry-run            # 仅列出命中，不调 LLM
//   node scripts/fix-bias.ts --only <id>          # 单题冒烟
//   node scripts/fix-bias.ts --limit 20           # 前 20 道
//   node scripts/fix-bias.ts                      # 全量（244 道），后台跑
//   node scripts/fix-bias.ts --merge              # review 后把候选覆写回源（需先跑出候选）

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ProviderEntry, Question } from '../src/types.ts';
import { detectOptionLengthBias } from '../src/domain/bias.ts';
import { callLLM, extractJSON } from '../src/ai/pi.ts';

const dataDir = fileURLToPath(new URL('../src/data/questions/', import.meta.url));
const outDir = fileURLToPath(new URL('../src/data/questions.biasfix/', import.meta.url));
const reportPath = fileURLToPath(new URL('../biasfix-report.json', import.meta.url));
const defaultConfigPath = fileURLToPath(new URL('../data/provider.local.json', import.meta.url));

// ── 参数 ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const arg = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const onlyId = arg('only');
const limitArg = Number.parseInt(arg('limit') ?? '', 10);
const limit = Number.isNaN(limitArg) ? Infinity : limitArg;
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const doMerge = args.includes('--merge');
const configPath = arg('config');

// ── Provider 配置 ─────────────────────────────────────────────────────────────
interface ReportRow {
  id: string;
  file: string;
  status: 'fixed' | 'still-biased' | 'failed' | 'skipped';
  attempts: number;
  detail?: string;
}
interface Report {
  generatedAt: string;
  total: number;
  rows: Record<string, ReportRow>;
}

function loadEntry(): ProviderEntry | null {
  let raw: string | undefined;
  if (configPath && existsSync(configPath)) raw = readFileSync(configPath, 'utf8');
  else if (existsSync(defaultConfigPath)) raw = readFileSync(defaultConfigPath, 'utf8');
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      const entry: Partial<ProviderEntry> =
        'providers' in parsed && Array.isArray(parsed.providers)
          ? parsed.providers.find((p: ProviderEntry) => p.enabled !== false)
          : parsed;
      if (entry && entry.id && entry.model) {
        return {
          id: entry.id,
          enabled: true,
          model: entry.model,
          apiKey: entry.apiKey ?? '',
          baseUrl: entry.baseUrl ?? '',
          ...(entry.accountId ? { accountId: entry.accountId } : {}),
        };
      }
    } catch {
      /* fall through to env */
    }
  }
  const id = process.env.FIXBIAS_PROVIDER;
  const model = process.env.FIXBIAS_MODEL;
  if (id && model) {
    return {
      id: id as ProviderEntry['id'],
      enabled: true,
      model,
      apiKey: process.env.FIXBIAS_API_KEY ?? '',
      baseUrl: process.env.FIXBIAS_BASE_URL ?? '',
      ...(process.env.FIXBIAS_ACCOUNT_ID ? { accountId: process.env.FIXBIAS_ACCOUNT_ID } : {}),
    };
  }
  return null;
}

// ── 加载题目（按文件分组，便于按原结构写回候选）──────────────────────────────
interface FileBundle {
  file: string;
  questions: Question[];
}
function loadFiles(): FileBundle[] {
  return readdirSync(dataDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({
      file: f,
      questions: JSON.parse(readFileSync(dataDir + f, 'utf8')) as Question[],
    }));
}

// 仅 choice 且命中 strong 长度泄题
function isStrongBias(q: Question): boolean {
  const cf = q.formats?.choice;
  if (!cf || !Array.isArray(cf.options) || !Array.isArray(cf.answer)) return false;
  const r = detectOptionLengthBias(cf.options, cf.answer);
  return r.biased && r.severity === 'strong';
}

// ── 聚焦重排提示词 ───────────────────────────────────────────────────────────
const SYSTEM = `你是一位严谨的考试命题编辑。你的任务是修复一道选择题里「选项长度泄题」的问题：当前正确答案恰好是明显最长/最啰嗦的选项，存在通过篇幅暗示答案的泄题风险。

要求：
- 仅改写选项文本（options），不要改动题干、不要改动正确选项的位置（answer 索引）、不要增删选项数量。
- 正确选项必须保持与原来完全一致的结论/语义（它仍是正确答案，索引不变）。
- 每个干扰项（错误选项）必须保持与原来一致的错误结论/语义。
- 让所有选项的篇幅长度与工程细节丰富度尽量接近：正确项不要比干扰项系统性更长；过短的干扰项要补充等量的合理细节，过长的正确项要适度精简（但不削弱其正确结论）。
- 输出严格为 JSON：{"options": ["...","...","...","..."]}，不要任何额外文字。`;

function buildUser(q: Question): string {
  const cf = q.formats!.choice!;
  return `【题干】
${cf.question ?? q.question}

【正确选项索引】${JSON.stringify(cf.answer)}

【当前选项】
${JSON.stringify(cf.options, null, 2)}

请把上述选项改写为篇幅均衡的版本（保持各自语义与答案索引不变），仅返回 options 数组。`;
}

// 一次性重试（更强约束）
const RETRY_USER_SUFFIX =
  '\n\n【修正】上一版仍存在长度泄题：请务必让四个选项字符数接近（最大/最小差距控制在 1.5× 以内），正确项不得明显长于干扰项。';

// ── 带 429 退避的调用 ───────────────────────────────────────────────────────
async function rebalance(entry: ProviderEntry, q: Question): Promise<string[]> {
  const user = buildUser(q);
  const out1 = extractJSON<{ options?: unknown }>(await callLLM(entry, SYSTEM, user));
  const opts1 = asOptions(out1?.options);
  if (opts1) {
    const cf = q.formats!.choice!;
    if (!detectOptionLengthBias(opts1, cf.answer).biased) return opts1;
  }
  const out2 = extractJSON<{ options?: unknown }>(
    await callLLM(entry, SYSTEM, user + RETRY_USER_SUFFIX),
  );
  const opts2 = asOptions(out2?.options);
  if (opts2) return opts2;
  throw new Error('LLM 未返回合法 options 数组');
}

function asOptions(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  if (!v.every((x) => typeof x === 'string' && x.trim().length > 0)) return null;
  return v as string[];
}

async function callWithRetry(entry: ProviderEntry, q: Question, maxRetry = 4): Promise<string[]> {
  let lastErr: unknown;
  for (let i = 0; i <= maxRetry; i++) {
    try {
      return await rebalance(entry, q);
    } catch (err) {
      lastErr = err;
      const msg = String(err).toLowerCase();
      const isRate = msg.includes('429') || msg.includes('rate') || msg.includes('too many requests');
      if (isRate && i < maxRetry) {
        const wait = Math.min(30000, 5000 * 2 ** i);
        console.warn(`  ⏳ 触发限流，退避 ${wait / 1000}s 后重试（${i + 1}/${maxRetry}）`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

// ── 主流程 ───────────────────────────────────────────────────────────────────
async function main() {
  const files = loadFiles();
  const all = files.flatMap((b) => b.questions.map((q) => ({ q, file: b.file })));
  const flagged = all.filter(({ q }) => isStrongBias(q));

  // resume：读取已有报告
  let report: Report = { generatedAt: new Date().toISOString(), total: flagged.length, rows: {} };
  if (existsSync(reportPath) && !force) {
    try {
      report = JSON.parse(readFileSync(reportPath, 'utf8')) as Report;
      report.rows ??= {};
    } catch {
      /* ignore */
    }
  }

  let targets = flagged;
  if (onlyId) targets = flagged.filter(({ q }) => q.id === onlyId);
  targets = targets.slice(0, limit);

  console.log(`命中 strong 长度泄题的选择题：${flagged.length} 道；本次处理：${targets.length} 道`);

  if (dryRun) {
    for (const { q, file } of targets) console.log(`  · [${file}] ${q.id}`);
    console.log('（dry-run 完成，未调用 LLM，未写盘）');
    return;
  }

  const entry = loadEntry();
  if (!entry) {
    console.error(
      '✗ 未找到可用的 Provider 配置。请提供其一：\n' +
        `  1) 默认文件 ${defaultConfigPath}（ProviderEntry JSON，已被 .gitignore 忽略）\n` +
        '  2) 环境变量 FIXBIAS_PROVIDER / FIXBIAS_MODEL / FIXBIAS_API_KEY [ / FIXBIAS_BASE_URL ]\n' +
        '  3) --config <path> 指定 JSON',
    );
    process.exit(2);
  }
  console.log(`使用 Provider：${entry.id} / ${entry.model}`);

  mkdirSync(outDir, { recursive: true });
  // 候选按文件收集（只写有改动的题文件）
  const outBundles: Record<string, Question[]> = {};

  for (const { q, file } of targets) {
    const prev = report.rows[q.id];
    if (prev && prev.status === 'fixed' && !force) {
      console.log(`  ⊙ 跳过已完成：${q.id}`);
      continue;
    }
    process.stdout.write(`  → ${q.id} … `);
    try {
      const newOptions = await callWithRetry(entry, q);
      const cf = q.formats!.choice!;
      if (newOptions.length !== cf.options.length) throw new Error('选项数量变化，拒绝应用');
      if (detectOptionLengthBias(newOptions, cf.answer).biased) {
        report.rows[q.id] = { id: q.id, file, status: 'still-biased', attempts: 1, detail: '重试后仍命中长度泄题' };
        console.log('仍偏置，标记待人工');
        continue;
      }
      const fixed: Question = {
        ...q,
        formats: { ...q.formats, choice: { ...cf, options: newOptions } },
      };
      (outBundles[file] ??= []).push(fixed);
      report.rows[q.id] = { id: q.id, file, status: 'fixed', attempts: 1 };
      console.log('已修复 ✓');
    } catch (err) {
      report.rows[q.id] = { id: q.id, file, status: 'failed', attempts: 1, detail: String(err).slice(0, 200) };
      console.log('失败 ✗', String(err).slice(0, 120));
    }
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
  }

  // 写候选文件（合并该文件中已修复的题 + 其余原题，保持完整结构）
  for (const b of files) {
    const fixedMap = new Map((outBundles[b.file] ?? []).map((q) => [q.id, q]));
    if (fixedMap.size === 0) continue;
    const merged = b.questions.map((q) => fixedMap.get(q.id) ?? q);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(outDir + b.file, JSON.stringify(merged, null, 2));
  }

  const counts = Object.values(report.rows).reduce<Record<string, number>>((a, r) => {
    a[r.status] = (a[r.status] ?? 0) + 1;
    return a;
  }, {});
  console.log('\n=== 进度报告 ===');
  console.log('累计状态：', counts);
  console.log(`候选目录：${outDir}`);
  console.log(`报告文件：${reportPath}`);
  if (Object.keys(outBundles).length > 0) {
    console.log('review 后可用 `node scripts/fix-bias.ts --merge` 把候选覆写回源文件。');
  }
}

// ── --merge：把候选覆写回源（需先跑出候选）──────────────────────────────────
function merge() {
  if (!existsSync(outDir)) {
    console.error('✗ 没有候选目录，请先跑一次 fix:bias（不带 --merge）。');
    process.exit(1);
  }
  let n = 0;
  for (const f of readdirSync(outDir).filter((x) => x.endsWith('.json'))) {
    const src = dataDir + f;
    if (!existsSync(src)) continue;
    writeFileSync(src, readFileSync(outDir + f, 'utf8'));
    n++;
  }
  console.log(`✓ 已将 ${n} 个候选文件覆写回 ${dataDir}（未提交 git，请人工 review 后自行 commit）。`);
}

if (doMerge) merge();
else main().catch((e) => {
  console.error(e);
  process.exit(1);
});
