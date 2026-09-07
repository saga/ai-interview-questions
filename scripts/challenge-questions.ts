/// <reference types="vite/client" />
// 批量题目质询（plan0907 P1-2：deterministic 门禁 + LLM Challenger + 人工验收 三层中的第二层）。
//
// 为什么单独成脚本：`questionChallenger` 此前只挂在 UI 的「单题质询」按钮上（QuestionCard），
// 题库治理侧没有任何入口 —— 机器 detector 抓不到的语义质量问题（多选正确项互为换述、
// distractor 不像工程师误区、解析不支持答案）全靠人肉抽检。本脚本把它接进离线管线。
//
// 分层定位（与 plan0907 P1-2 一致）：
//   deterministic（validate-questions / lint-bias / lint-length / question:audit）= hard gate
//   challenger（本脚本）                                                        = 语义质量审计，默认不阻断
//   human                                                                       = 最终验收
// 因此默认退出码恒为 0；只有显式 --gate 才在有 blocker（reject 或任一 critical）时退出 1。
// 这样 LLM 的偶发误判不会直接卡住 CI，但 --gate 可用于「新批次入库前」的准入检查。
//
// 用法：
//   npm run question:challenge -- --ids=q-1,q-2
//   npm run question:challenge -- --topic=knowledge-distillation --limit=10 --out=temp/challenge.json
//   npm run question:challenge -- --ids=q-1 --dry-run          # 只打印待质询清单与 prompt，不调用 LLM
//   npm run question:challenge -- --topic=rag --gate           # 有 blocker 时退出 1
//
// 引擎配置走环境变量（不读 localStorage——Node 侧没有浏览器存储）：
//   CHALLENGER_PROVIDER  引擎 id，默认 deepseek
//   CHALLENGER_MODEL     模型 id
//   CHALLENGER_API_KEY   API Key（也可复用 <ENGINE>_API_KEY）
//   CHALLENGER_BASE_URL  可选，自建网关 / 代理

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { questionBank } from '../src/data/questionBank';
import type { Question } from '../src/schemas/question';
import type { ProviderEntry } from '../src/schemas/ai-config';
import { challengeQuestion, summarizeChallenges, type ChallengeOutcome, type ChallengeSummary } from '../src/ai/questionChallenger';
import { callLLM } from '../src/ai/pi';

interface Options {
  ids: string[];
  topic?: string;
  angle?: string;
  limit: number;
  out: string;
  gate: boolean;
  dryRun: boolean;
  concurrency: number;
}

// 同时支持 `--key=value` 与 `--key value`：`npm run x -- --topic=rag` 传入的是**单个** token，
// 只认后者会静默丢掉整个参数（本脚本首版就踩了：--topic / --limit 全被忽略，白跑 20 题）。
function parseArgs(argv: string[]): Options {
  const get = (name: string): string | undefined => {
    const inline = argv.find((a) => a.startsWith(`--${name}=`));
    if (inline !== undefined) return inline.slice(name.length + 3);
    const i = argv.indexOf(`--${name}`);
    const next = i >= 0 ? argv[i + 1] : undefined;
    return next !== undefined && !next.startsWith('--') ? next : undefined;
  };
  const has = (name: string) => argv.includes(`--${name}`) || argv.some((a) => a === `--${name}=true`);
  return {
    ids: (get('ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    topic: get('topic'),
    angle: get('angle'),
    limit: Math.max(1, Number(get('limit') ?? 20) || 20),
    out: get('out') ?? 'temp/challenge-report.json',
    gate: has('gate'),
    dryRun: has('dry-run'),
    concurrency: Math.max(1, Number(get('concurrency') ?? 3) || 3),
  };
}

function selectQuestions(opts: Options): Question[] {
  const all = questionBank.questions;
  const byId = new Set(opts.ids);
  const picked = all.filter((q) => {
    if (byId.size > 0) return byId.has(q.id);
    if (opts.topic && q.topic !== opts.topic) return false;
    if (opts.angle && q.angle !== opts.angle) return false;
    return true;
  });
  return picked.slice(0, opts.limit);
}

function buildEntry(): ProviderEntry {
  const id = (process.env.CHALLENGER_PROVIDER ?? 'deepseek').trim();
  const model = (process.env.CHALLENGER_MODEL ?? '').trim();
  const apiKey = (process.env.CHALLENGER_API_KEY ?? process.env[`${id.toUpperCase()}_API_KEY`] ?? '').trim();
  const baseUrl = process.env.CHALLENGER_BASE_URL?.trim();
  if (!model) throw new Error('缺少 CHALLENGER_MODEL（例：deepseek-chat）');
  if (!apiKey) throw new Error(`缺少密钥：设置 CHALLENGER_API_KEY 或 ${id.toUpperCase()}_API_KEY`);
  return { id: id as ProviderEntry['id'], enabled: true, model, apiKey, ...(baseUrl ? { baseUrl } : {}) };
}

/** 并发受限的 map：质询是网络 IO，串行太慢；无上限又会打爆限流。 */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

function printSummary(s: ChallengeSummary, gate: boolean): void {
  console.log('── 题目质询报告（LLM Challenger）──');
  console.log(`  质询题数    : ${s.total}（成功 ${s.judged} · 失败 ${s.failed}）`);
  console.log(`  结论分布    : reject ${s.verdicts.reject} · revise ${s.verdicts.revise} · accept ${s.verdicts.accept} · skipped ${s.verdicts.skipped}`);
  console.log(`  区分度分布  : high ${s.values.high} · medium ${s.values.medium} · low ${s.values.low} · 未给 ${s.values.unknown}`);
  console.log('  维度命中（critical / warning）:');
  for (const [dim, n] of Object.entries(s.dimensions)) {
    if (n.critical === 0 && n.warning === 0) continue;
    console.log(`    · ${dim}: ${n.critical} / ${n.warning}`);
  }
  console.log(`  blockers    : ${s.blockers.length}（reject 或含 critical）`);
  for (const b of s.blockers.slice(0, 20)) {
    console.log(`    ✗ ${b.id}${b.dimensions.length ? ` [${b.dimensions.join(', ')}]` : ''} —— ${b.summary}`);
  }
  console.log(`  人工复核队列: ${s.reviewQueue.length} 条（按严重度排序，前 10 条）`);
  for (const r of s.reviewQueue.slice(0, 10)) {
    console.log(`    • ${r.id}（score ${r.score}）${r.reasons[0] ?? ''}`);
  }
  if (gate && s.blockers.length > 0) {
    console.log(`\n✗ --gate：存在 ${s.blockers.length} 条 blocker，准入检查不通过。`);
  } else {
    console.log('\nℹ 质询层是语义质量审计，不是 hard gate；未加 --gate 时退出码恒为 0。');
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const targets = selectQuestions(opts);
  if (targets.length === 0) {
    console.error('没有匹配到题目。用 --ids= / --topic= / --angle= 指定范围（默认 --limit=20）。');
    process.exit(1);
  }
  console.log(`待质询 ${targets.length} 题：${targets.slice(0, 5).map((q) => q.id).join(', ')}${targets.length > 5 ? ' …' : ''}`);

  if (opts.dryRun) {
    for (const q of targets.slice(0, 3)) console.log(`\n--- ${q.id} ---\n${q.question}`);
    console.log('\n--dry-run：未调用 LLM。');
    return;
  }

  const entry = buildEntry();
  const outcomes = await mapLimit(targets, opts.concurrency, async (q): Promise<ChallengeOutcome> => {
    try {
      const challenge = await challengeQuestion(q, (system, user) =>
        callLLM(entry, system, user, { jsonMode: true, temperature: 0 }),
      );
      return { id: q.id, challenge };
    } catch (error) {
      return { id: q.id, error: error instanceof Error ? error.message : String(error) };
    }
  });

  const summary = summarizeChallenges(outcomes);
  const outPath = resolve(process.cwd(), opts.out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(
    outPath,
    JSON.stringify({ generatedAt: Date.now(), options: { ...opts }, summary, outcomes }, null, 2),
    'utf8',
  );
  printSummary(summary, opts.gate);
  console.log(`\n报告已写入 ${opts.out}`);
  if (opts.gate && summary.blockers.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
