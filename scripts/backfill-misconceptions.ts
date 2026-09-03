// npm run backfill:misconceptions —— 为已有 misconceptions 的选择题回填 misconceptionMap。
//
// 背景（P0-5 数据层）：misconceptionMap[i] = 选项 i 体现的误解在题目级 misconceptions 中的下标，
// null = 未标注（仅干扰项需要标注）。此前题库只有 misconceptions 数组、没有选项级映射，
// 选择题答错无法定位「用户错在哪个认知误区」。本脚本按「选项文本 vs 误解文本」的相似度
// 自动配对，人工复核后即为结构化反证信号（无需 LLM、零成本）。
//
// ⚠️ 上限（2026-09-04 实测）：本脚本只能处理**已有 `misconceptions` 数组**的题。
// 全库 1311 道选择题里只有 **149 道**有该数组（97 已有 map、52 待回填）；
// 其余 1162 道没有任何误解标注，脚本无米下锅——要覆盖它们必须先由 LLM 生成 misconceptions，
// 那是另一件事，不在本脚本能力范围内。
//
// 度量与阈值的标定（2026-09-04，不再拍脑袋）：
//   以 97 道题里 **168 个已人工标注的干扰项**为标尺，比较两种度量在 top-1 下标上的准确率：
//     bigram-Dice（本脚本原先的自研实现，阈值 0.40）→ 覆盖 64%，准确率 98.1%，
//       但对待回填的 96 个干扰项命中 **0 个**（最高分仅 0.391）——阈值定在分布之外，等于空跑。
//     cjkDice（ADR-072 的仓库标准度量）→ 阈值 0.30：覆盖 79%，准确率 **95.5%**；
//       阈值 0.35/0.40/0.45：准确率 96.0/96.6/96.3% —— **曲线是平的**。
//   ⇒ 精度不随阈值上升而改善，说明误差不集中在低分段；取 0.30 换取最大覆盖。
//   另人工复核 0.30~0.40 边界带 21 条，确认 19 条正确（2 条语义错配），与 95.5% 一致。
//   改用 cjkDice 同时消除「本脚本另有一套中文相似度实现」的口径分裂（同 ADR-072 的理由）。
//
// 安全模型（宁缺毋滥，不做猜测）：
//   - 只标注相似度 ≥ 阈值的错误选项；低于阈值一律 null（留待人工补齐）；
//   - 正确选项恒为 null（正确项不体现误解）；
//   - 已有 misconceptionMap 的题不动（人工标注优先）；
//   - 无命中映射的题不写 misconceptionMap（保持文件最小 diff）；
//   - 只写回发生变化的文件，输出逐题配对报告供人工复核；
//   - 写回是确定性的（无 LLM），可直接覆写源文件；--dry-run 先预览。
//
// 用法：
//   node scripts/backfill-misconceptions.ts --dry-run           # 只打印配对报告，不写盘
//   node scripts/backfill-misconceptions.ts --threshold 40      # 提高门槛（默认 30，0~100）
//   node scripts/backfill-misconceptions.ts                     # 写回

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Question } from '../src/schemas/question.ts';
import { cjkDice } from '../src/domain/textSimilarity.ts';

const dataDir = fileURLToPath(new URL('../src/data/questions/', import.meta.url));
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const thresholdArg = args.find((a) => a.startsWith('--threshold='));
/** 与 `cjkDice` 同量纲（0~100）；标定见文件头。 */
const THRESHOLD = thresholdArg ? Number(thresholdArg.split('=')[1]) : 30;

interface ReportRow {
  file: string;
  id: string;
  optionIndex: number;
  misconceptionIndex: number;
  score: number;
  option: string;
  misconception: string;
}

const report: ReportRow[] = [];
let filesChanged = 0;

for (const f of readdirSync(dataDir).filter((x) => x.endsWith('.json')).sort()) {
  const src = dataDir + f;
  const questions = JSON.parse(readFileSync(src, 'utf8')) as Question[];
  let dirty = false;

  for (const q of questions) {
    const cf = q.formats.choice;
    const misconceptions = q.misconceptions ?? [];
    if (!cf || misconceptions.length === 0) continue;
    const answer = new Set(cf.answer);
    if (cf.misconceptionMap) continue; // 已有映射的题不动（人工标注优先）

    const map: (number | null)[] = cf.options.map(() => null);
    for (let i = 0; i < cf.options.length; i++) {
      if (answer.has(i)) continue; // 正确选项不体现误解
      let bestScore = 0;
      let bestIdx = -1;
      for (let j = 0; j < misconceptions.length; j++) {
        const s = cjkDice(cf.options[i], misconceptions[j]);
        if (s > bestScore) {
          bestScore = s;
          bestIdx = j;
        }
      }
      if (bestScore >= THRESHOLD) {
        map[i] = bestIdx;
        report.push({ file: f, id: q.id, optionIndex: i, misconceptionIndex: bestIdx, score: bestScore, option: cf.options[i], misconception: misconceptions[bestIdx] });
      }
    }

    if (map.some((x) => x != null)) {
      q.formats.choice!.misconceptionMap = map;
      dirty = true;
    }
  }

  if (dirty) {
    filesChanged++;
    if (!dryRun) writeFileSync(src, JSON.stringify(questions, null, 2) + '\n');
  }
}

// ── 报告 ──
report.sort((a, b) => b.score - a.score);
const matched = report.length;
const ids = new Set(report.map((r) => r.id)).size;
console.log(`\n相似度阈值：cjkDice ≥ ${THRESHOLD}｜配对 ${matched} 个选项（覆盖 ${ids} 道题）｜改动 ${filesChanged} 个文件${dryRun ? '（dry-run，未写盘）' : ''}`);
if (dryRun) {
  console.log('\n逐题配对（按相似度降序，供复核；可 --threshold 调整门槛）：');
  for (const r of report) {
    console.log(`${r.score.toFixed(3)}  ${r.id} opt${r.optionIndex}~mis${r.misconceptionIndex}（${r.file}）`);
    console.log(`   选项：${r.option.slice(0, 60)}${r.option.length > 60 ? '…' : ''}`);
    console.log(`   误解：${r.misconception.slice(0, 60)}${r.misconception.length > 60 ? '…' : ''}`);
  }
  console.log('\n复核确认后去掉 --dry-run 重跑即写回。');
} else {
  console.log('已写回。建议跑 npx vitest run src/schemas/question.test.ts 确认 schema 校验通过。');
}
