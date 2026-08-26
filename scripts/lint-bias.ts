// npm run lint:bias —— 选择题「选项长度泄题」启发式扫描（traditional algorithm，无 LLM）。
// 与 validate:questions（不变量校验）解耦：本脚本只做质量信号，不阻断流程。
// 用法：
//   node scripts/lint-bias.ts            # 仅报告 strong（最长项即正确项且明显偏长）
//   node scripts/lint-bias.ts --soft     # 同时报告 mean 失衡
//   node scripts/lint-bias.ts --json     # 机器可读输出
//
// 为什么独立成脚本而非塞进 validate：本题库历史题中「正确项天然更长」曾较普遍（约 244/532 道选择题为 strong 档），
// 直接进 validate 会产生大量噪声；把它做成可单独运行的 lint，便于在出题/变体后按需检查。

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Question } from '../src/types.ts';
import { detectOptionLengthBias } from '../src/domain/bias.ts';

const dataDir = fileURLToPath(new URL('../src/data/questions/', import.meta.url));

const args = process.argv.slice(2);
const includeSoft = args.includes('--soft');
const asJson = args.includes('--json');
const verbose = args.includes('--all') || args.includes('--verbose');

const questions = readdirSync(dataDir)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .flatMap((f) => JSON.parse(readFileSync(dataDir + f, 'utf8')) as Question[]);

interface Hit {
  id: string;
  severity: string;
  detail: string;
  maxCorrect: number;
  maxDistractor: number;
}

const hits: Hit[] = [];
for (const q of questions) {
  const cf = q.formats?.choice;
  if (!cf || !Array.isArray(cf.options) || !Array.isArray(cf.answer)) continue;
  const r = detectOptionLengthBias(cf.options, cf.answer);
  if (!r.biased) continue;
  if (!includeSoft && r.severity !== 'strong') continue;
  hits.push({ id: q.id, severity: r.severity, detail: r.detail, maxCorrect: r.maxCorrect, maxDistractor: r.maxDistractor });
}

if (asJson) {
  console.log(JSON.stringify(hits, null, 2));
} else {
  const strong = hits.filter((h) => h.severity === 'strong').length;
  const soft = hits.length - strong;
  const preview = verbose ? hits : hits.slice(0, 10);
  for (const h of preview) console.warn(`⚠ [${h.severity}] ${h.id}: ${h.detail}`);
  if (!verbose && hits.length > preview.length) {
    console.warn(`  …（另有 ${hits.length - preview.length} 道，使用 --all 查看全部）`);
  }
  console.log(
    `\n${includeSoft ? '（含 soft）' : '（仅 strong）'}共 ${hits.length} 道选择题存在选项长度偏差` +
      `（strong=${strong}${includeSoft ? `, soft=${soft}` : ''} / 选择题总数 ${questions.filter((q) => q.formats?.choice).length}）`,
  );
  console.log('提示：历史 strong 档长度泄题已于 2026-08-27 批量改写清零；本 lint 保留作新题/变体的回归探针。新变体已由 generateVariant 自动重试修正。');
}
