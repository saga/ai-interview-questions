// scripts/variant-bench.ts —— 变体生成真实耗时基准（ADR-036 第四轮 P2 配套）。
//
// 目的：在真实 LLM 上实测「轻量变体」的端到端成本，用第四轮新加的可观测性
// （usageTelemetry.getVariantTelemetry：avg/p95 延迟 + fallback 率）回答用户的疑问：
//   「改完后组卷到底省了多少？gate 是不是太严？」
//
// 注意：为保持 Node 侧 tsc 构建（tsconfig.node.json 不含 vite/client）不被
// src/data/knowledgeMap 的 import.meta.glob 拖垮，本脚本只依赖 src/ai/pi 的
// callLLM/extractJSON（不拉 knowledge 链），并就地复刻轻量变体管线。VARIANT_SYSTEM
// 与 src/ai/variant.ts 的 v3 保持一致；结构校验与 src/domain/variant.ts 的 validateVariant
// 对齐（规范化 → 结构 → 长度泄题）。**不要**改成直接 import domain/variant——它会经
// knowledge/nodes 拉进 knowledgeMap 的 import.meta.glob，破坏 tsc -b。
//
// 用法（需要真实 API key，放在环境变量里；本沙箱无 key，请在本机跑）：
//   VARIANT_API_KEY=sk-xxx VARIANT_MODEL=deepseek-chat \
//     npx vite-node scripts/variant-bench.ts --n 10 --parallel
//
// 参数：
//   --n <k>          取前 k 道选择题（默认 10）
//   --parallel       用 Promise.all 并发（模拟 buildSession 启动路径，默认）
//   --sequential      串行调用（看纯求和耗时，作对照）
//   --provider <id>   deepseek / openrouter / local（默认 deepseek）
//   --base-url <url> 本地 OpenAI 兼容服务地址（provider=local 或自定义网关时用）
//   --dry-run        **不联网**：用内置合成 LLM 跑通整条管线（读题 → 解析 → 校验 → 遥测 → 汇总），
//                    验证本脚本自身的统计口径（avg/p95/fallback 归因）与管线接线。
//                    合成延迟与失败，数字不代表真实模型性能。建议带 key 跑真实基准前先跑一次确认脚本无误。
//   --fail-rate <pct> dry-run 下注入的失败比例（默认 20）；0 表示全部通过（仅看延迟统计）
//   --latency <ms>    dry-run 下模拟的单次延迟基准值（默认 1200ms，叠加确定性 ±30% 抖动）

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { callLLM, extractJSON } from '../src/ai/pi';
import {
  recordVariantRound,
  getVariantTelemetry,
  resetUsageTelemetry,
} from '../src/ai/usageTelemetry';
import { detectOptionLengthBias } from '../src/domain/bias';
import { parseAIConfig } from '../src/schemas/ai-config';
import type { AIConfig, ProviderEntry } from '../src/schemas/ai-config';
import type { Question } from '../src/schemas/question';

// 与 src/ai/variant.ts 的 VARIANT_SYSTEM（v3）保持一致。
const VARIANT_SYSTEM = `[PROMPT-VERSION v3]

对已有面试题做轻量语义变换。

任务：
1. 改写题干，使其表达方式与原题不同。
2. 对每个选项做自然的措辞改写（逐项改写现有文本，不要重新设计选项）。
3. 保持每个选项原本表达的技术含义不变。
4. 不新增信息，不删除关键条件。
5. 不改变任何选项的正确 / 错误属性。
6. 不改变选项数量。
7. 不创造新的 distractor。
8. 不交换选项顺序（顺序由程序在后续步骤统一处理）。
9. 不生成答案。
10. 不生成解析。

题干可以：
- 改变措辞和句式
- 改变提问方式
- 加入简短工程背景
- 调整表达视角

选项只能做：
- 同义改写
- 句式调整
- 表达简化或自然化
- 保持原有技术结论不变

选项一一对应（重要）：
- 输出的第 N 个选项必须是输入第 N 个选项的改写
- 只允许改变表达，不允许改变因果关系、适用条件、范围、数量或真假属性
- 不要给某个选项补充解释、理由或额外结论（例如把「增大 batch size」写成
  「增大 batch size 可以显著减少单请求的 prefill 计算」——这已经改变了原选项的语义）

不要进行深度重新设计。不要改变知识点或难度。

只输出 JSON：

选择题：
{
  "question": "改写后的题干",
  "options": ["改写后的选项1", "改写后的选项2", "改写后的选项3", "改写后的选项4"]
}

开放题：
{
  "question": "改写后的题干"
}`;

const FORBIDDEN = ['原题', '上述', '下文', '本文', '原文章', '原方案', '该方案', '前文', '题目中', '题干中'];

function parseArgs(argv: string[]) {
  const out = {
    n: 10,
    parallel: true,
    provider: 'deepseek',
    baseUrl: '' as string | undefined,
    dryRun: false,
    failRate: 20,
    latency: 1200,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--n') out.n = Number(argv[++i]) || 10;
    else if (a === '--sequential') out.parallel = false;
    else if (a === '--provider') out.provider = argv[++i] || 'deepseek';
    else if (a === '--base-url') out.baseUrl = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--fail-rate') out.failRate = Math.min(100, Math.max(0, Number(argv[++i]) || 0));
    else if (a === '--latency') out.latency = Number(argv[++i]) || 1200;
  }
  return out;
}

function loadChoiceQuestions(n: number): Question[] {
  const dir = fileURLToPath(new URL('../src/data/questions/', import.meta.url));
  const all = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .flatMap((f) => JSON.parse(readFileSync(dir + f, 'utf8')) as unknown[])
    .filter(
      (q): q is Question =>
        !!q && typeof q === 'object' && 'formats' in q && !!(q as Question).formats?.choice,
    );
  return all.slice(0, n);
}

function buildConfig(): AIConfig | null {
  const apiKey = process.env.VARIANT_API_KEY;
  const model = process.env.VARIANT_MODEL;
  if (!apiKey || !model) {
    console.error(
      '✗ 缺少 VARIANT_API_KEY / VARIANT_MODEL 环境变量，无法构造真实 provider。\n' +
        '  例：VARIANT_API_KEY=sk-xxx VARIANT_MODEL=deepseek-chat npx vite-node scripts/variant-bench.ts',
    );
    return null;
  }
  const entry: ProviderEntry = {
    id: (process.env.VARIANT_PROVIDER as ProviderEntry['id']) ?? 'deepseek',
    enabled: true,
    model,
    apiKey,
    ...(process.env.VARIANT_BASE_URL ? { baseUrl: process.env.VARIANT_BASE_URL } : {}),
  };
  // 用 schema 解析以填充其余默认值，避免手工构造缺字段导致 createLLMProvider 判无效。
  return parseAIConfig({ providers: [entry] });
}

/**
 * 复刻 domain/variant.ts 的 validateVariant（ADR-068 后口径）：
 *   规范化 → 结构（数量/空串/去重）→ 长度泄题。
 * 题干锚定已降级为 warning（不再阻断），故此处不复刻，与生产「不阻断」行为一致。
 * 注意：跳过 knowledge 节点 required 的锚定近似（纯 CPU，不影响延迟量级）。
 */
function structuralCheck(q: Question, v: { question?: string; options?: string[] }): string | null {
  if (!v?.question?.trim()) return 'empty-question';
  if (FORBIDDEN.some((w) => v.question!.includes(w))) return 'forbidden-reference';
  if (q.formats.choice) {
    if (!Array.isArray(v.options)) return 'missing-options';
    const cf = q.formats.choice;
    // 先规范化再校验（与 validateVariant 一致）：保证校验对象 === 最终展示文本
    const options = v.options.map((o) => String(o).replace(/\s+/g, ' ').trim());
    if (options.length !== cf.options.length) return 'option-count-mismatch';
    if (options.some((o) => !o)) return 'empty-option';
    if (new Set(options).size !== options.length) return 'duplicate-option';
    // 抗暗示：第五轮起此检查位于 validateVariant 内，基准必须同步计入，否则会少报 fallback
    if (detectOptionLengthBias(options, cf.answer).biased) return 'option-length-bias';
  }
  return null;
}

async function generateVariantOnce(entry: ProviderEntry, q: Question) {
  const isChoice = !!q.formats.choice;
  const user = JSON.stringify({
    topic: q.topic,
    requiredConcepts: q.tags ?? [],
    question: q.question,
    ...(isChoice ? { options: q.formats.choice?.options } : {}),
  });
  const raw = await callLLM(entry, VARIANT_SYSTEM, user, { jsonMode: true });
  const out = extractJSON<{ question?: string; options?: string[] }>(raw);
  const err = structuralCheck(q, out);
  if (err) {
    const e = new Error(err) as Error & { reason?: string };
    e.reason = err;
    throw e;
  }
  return { question: out.question ?? '', options: out.options };
}

/**
 * dry-run 合成 LLM 输出：复刻「LLM 返回 {question, options}」的结构。
 * fail=true 时制造重复选项（options[1]=options[0]），使 structuralCheck 返回 'duplicate-option'，
 * 以验证 fallback 归因链路；否则返回通过校验的变体。
 * 合成题干时剥离 canonical 中可能含有的禁用指代词（原题/下文/…），避免假阳性 forbidden-reference；
 * 真实链路里变体题干由 LLM 重写，不会原样带出 canonical 的指代词。
 */
function dryVariant(q: Question, fail: boolean): { question?: string; options?: string[] } {
  const src = q.formats.choice?.options ?? ['A', 'B', 'C', 'D'];
  const cleanQ = q.question.replace(new RegExp(FORBIDDEN.join('|'), 'g'), '');
  if (fail) {
    const opts = [...src];
    opts[Math.min(1, opts.length - 1)] = opts[0];
    return { question: `改写：${cleanQ}`, options: opts };
  }
  return { question: `改写：${cleanQ}`, options: src.map((o) => `改写：${o}`) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const questions = loadChoiceQuestions(args.n);
  if (questions.length === 0) {
    console.error('✗ 没读到任何选择题');
    process.exit(1);
  }

  resetUsageTelemetry(); // 清空 variant 累计（resetUsageTelemetry 同时清 variantRounds）
  const perCall: { id: string; ms: number; ok: boolean; detail: string }[] = [];
  const wallStart = Date.now();

  if (args.dryRun) {
    console.log(
      `▶ DRY-RUN（不联网）：${questions.length} 题，` +
        `fail-rate=${args.failRate}%，base-latency=${args.latency}ms\n`,
    );
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      // 确定性按 failRate% 注入失败（前 round(n*failRate/100) 题），便于复现
      const fail = args.failRate > 0 && i < Math.round(questions.length * (args.failRate / 100));
      const out = dryVariant(q, fail);
      const err = structuralCheck(q, out);
      // 确定性 ±30% 抖动，验证 avg/p95 计算而非真实延迟
      const ms = Math.round(args.latency * (1 + (((i * 37) % 60) - 30) / 100));
      if (err) {
        recordVariantRound({ questionId: q.id, latencyMs: ms, fallbackReason: err });
        perCall.push({ id: q.id, ms, ok: false, detail: err });
      } else {
        recordVariantRound({ questionId: q.id, latencyMs: ms });
        perCall.push({ id: q.id, ms, ok: true, detail: 'ok' });
      }
    }
  } else {
    const config = buildConfig();
    if (!config) process.exit(2);
    const entry = config.providers[0];
    if (!entry?.apiKey) {
      console.error('✗ provider 配置无效');
      process.exit(3);
    }
    console.log(`▶ 真实变体基准：${questions.length} 题，${args.parallel ? '并发(Promise.all)' : '串行'}\n`);

    const one = async (q: Question) => {
      const startedAt = Date.now();
      try {
        await generateVariantOnce(entry, q);
        const ms = Date.now() - startedAt;
        recordVariantRound({ questionId: q.id, latencyMs: ms });
        perCall.push({ id: q.id, ms, ok: true, detail: 'ok' });
      } catch (err) {
        const ms = Date.now() - startedAt;
        const reason = (err as { reason?: unknown })?.reason;
        const fb = typeof reason === 'string' ? reason : 'generation-error';
        recordVariantRound({ questionId: q.id, latencyMs: ms, fallbackReason: fb });
        perCall.push({ id: q.id, ms, ok: false, detail: fb });
      }
    };
    if (args.parallel) {
      await Promise.all(questions.map(one));
    } else {
      for (const q of questions) await one(q);
    }
  }

  const wallMs = Date.now() - wallStart;
  const t = getVariantTelemetry();
  const sumMs = perCall.reduce((s, c) => s + c.ms, 0);
  console.log('── 每题延迟 ──');
  for (const c of perCall) {
    console.log(`  ${c.ok ? '✓' : '✗'} ${c.id.padEnd(28)} ${String(c.ms).padStart(5)}ms  ${c.detail}`);
  }
  console.log('\n── 汇总（来自 usageTelemetry.getVariantTelemetry）──');
  console.log(`  题数            : ${t.total}`);
  console.log(`  fallback 数/率  : ${t.fallbackCount} / ${t.fallbackRate}%`);
  console.log(`  avg 延迟        : ${t.avgLatencyMs}ms`);
  console.log(`  p95 延迟        : ${t.p95LatencyMs}ms`);
  console.log(`\n── 墙钟 ──`);
  if (args.dryRun) {
    console.log(`  dry-run 墙钟    : ${wallMs}ms（无网络 I/O，仅本地计算）`);
  } else {
    console.log(`  ${args.parallel ? '并发/Promise.all' : '串行'}: ${wallMs}ms（生产 buildSession 形态）`);
  }
  console.log(`  串行求和参考    : ${sumMs}ms`);
  console.log(
    `\n解读：轻量变体是 one-shot 语义改写 + 程序确定性变换；fallback 率高说明 gate 偏严，` +
      `需回到 domain/variant.ts 放宽；墙钟 ≈ max(单次延迟) 说明 N 题 = N 次请求（瓶颈在启动并发）。`,
  );
}

// 单一入口。此前文件末尾有两个 main 调用，基准主流程会执行两遍
// ——批量 LLM 调用翻倍，且 fallback 率 / p95 等 telemetry 统计被污染。
main().catch((e) => {
  console.error('基准异常：', e);
  process.exit(1);
});
