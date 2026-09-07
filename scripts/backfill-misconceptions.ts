// npm run backfill:misconceptions —— 为已有 misconceptions 的选择题回填 misconceptionMap。
//
// 背景（P0-5 数据层）：misconceptionMap[i] = 选项 i 体现的误解在题目级 misconceptions 中的下标，
// null = 未标注（仅干扰项需要标注）。此前题库只有 misconceptions 数组、没有选项级映射，
// 选择题答错无法定位「用户错在哪个认知误区」。本脚本按「选项文本 vs 误解文本」的相似度
// 自动配对，人工复核后即为结构化反证信号（无需 LLM、零成本）。
//
// ⚠️ 上限与「米从哪来」（2026-09-07 更新）：本脚本做的是**选项 ↔ 误解文本的配对**，
// 自己不产出误解文本。两阶段现状：
//   1. 题级 `misconceptions` 数组：全库仅 185/1354 道有（13.7%）——本脚本最早只能吃这一部分；
//   2. `--from-nodes`（本次新增）：题级缺失时用**该知识节点**（question.topic = 节点 id）的
//      `misconceptions` 作种。124 个节点 100% 有误解（均值 2.14 条），且 nodes.test.ts 强制非空，
//      于是「无米下锅」变成「有米可炊」——零 LLM、零成本，且口径与 ADR-072 一致。
// 仍覆盖不到的部分（节点误解与本题干扰项都不相似）只能由 LLM 生成题级误解，属另一件事。
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
// 安全模型补充（`--from-nodes`）：
//   - **保守阈值**：节点级误解比题级更粗（同一节点下多个 angle 共用），误配代价更高。
//     默认 45 而非 30。阈值曲线（2026-09-07 实测，--from-nodes）：
//       20 → 285 道 · 25 → 140 道 · 30 → 84 道 · 35 → 59 道 · 38 → 48 · 42 → 32 · 45 → 19 · 50 → 14
//     人工复核抽样：≥45 的 19 条**全部正确**；35~45 带出现明显误配（如「删掉教师全部推理轨迹」
//     被配到「蒸馏出的模型在所有场景等价于教师」、「因果掩码把复杂度降为线性」被配到
//     「把注意力热力图当因果性证据」），约 10% 需要剔除。误配的代价是**诊断说错**——
//     学习者选了 A，系统说他持有误解 B，这比"没标注"更糟（宁缺毋滥，见下方安全模型）。
//     想用覆盖率换精度时用 --node-threshold 下调，但请先看 dry-run 报告；
//   - **只写有命中的题**：一个干扰项都没配上 ⇒ 既不写 misconceptions 也不写 map，
//     避免往题库里塞一堆「有误解列表但无绑定」的空壳；
//   - 已有题级 `misconceptions` 或 `misconceptionMap` 的题一律不动（人工标注优先）。
//
// 用法：
//   node scripts/backfill-misconceptions.ts --dry-run           # 只打印配对报告，不写盘
//   node scripts/backfill-misconceptions.ts --threshold 40      # 提高门槛（默认 30，0~100）
//   node scripts/backfill-misconceptions.ts --from-nodes --dry-run  # 先用节点误解做种预览
//   node scripts/backfill-misconceptions.ts --from-nodes        # 写回

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Question } from '../src/schemas/question.ts';
import { cjkDice } from '../src/domain/textSimilarity.ts';

const dataDir = fileURLToPath(new URL('../src/data/questions/', import.meta.url));
const knowledgeDir = fileURLToPath(new URL('../src/data/knowledge/', import.meta.url));
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const fromNodes = args.includes('--from-nodes');
const thresholdArg = args.find((a) => a.startsWith('--threshold='));
/** 与 `cjkDice` 同量纲（0~100）；标定见文件头。 */
const THRESHOLD = thresholdArg ? Number(thresholdArg.split('=')[1]) : 30;
/** `--from-nodes` 的保守阈值（节点级误解更粗，误配代价更高）；可用 --node-threshold 调。 */
const nodeThresholdArg = args.find((a) => a.startsWith('--node-threshold='));
const NODE_THRESHOLD = nodeThresholdArg ? Number(nodeThresholdArg.split('=')[1]) : 45;

/** question.topic 就是 Knowledge 节点 id（validate-questions.ts 的不变式），据此取节点级误解做种。 */
function loadNodeMisconceptions(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const f of readdirSync(knowledgeDir).filter((x) => x.endsWith('.json')).sort()) {
    const nodes = JSON.parse(readFileSync(knowledgeDir + f, 'utf8')) as { id?: string; misconceptions?: string[] }[];
    for (const n of nodes) {
      const list = (n.misconceptions ?? []).map((s) => s.trim()).filter(Boolean);
      if (n.id && list.length > 0) map.set(n.id, list);
    }
  }
  return map;
}

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
const nodeMisconceptions = fromNodes ? loadNodeMisconceptions() : new Map<string, string[]>();
let seededFromNodes = 0;

for (const f of readdirSync(dataDir).filter((x) => x.endsWith('.json')).sort()) {
  const src = dataDir + f;
  const questions = JSON.parse(readFileSync(src, 'utf8')) as Question[];
  let dirty = false;

  for (const q of questions) {
    const cf = q.formats.choice;
    if (!cf) continue;
    const answer = new Set(cf.answer);
    if (cf.misconceptionMap) continue; // 已有映射的题不动（人工标注优先）

    // 题级误解缺失时，用所属知识节点的误解做种（--from-nodes）。
    let misconceptions = q.misconceptions ?? [];
    let seeded = false;
    if (misconceptions.length === 0 && fromNodes) {
      misconceptions = nodeMisconceptions.get(q.topic) ?? [];
      seeded = misconceptions.length > 0;
    }
    if (misconceptions.length === 0) continue;
    const threshold = seeded ? NODE_THRESHOLD : THRESHOLD;

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
      if (bestScore >= threshold) {
        map[i] = bestIdx;
        report.push({ file: f, id: q.id, optionIndex: i, misconceptionIndex: bestIdx, score: bestScore, option: cf.options[i], misconception: misconceptions[bestIdx] });
      }
    }

    if (map.some((x) => x != null)) {
      // 只有真的配上了才落 misconceptions：否则会留下一堆「有误解列表、零绑定」的空壳。
      if (seeded && !q.misconceptions) {
        q.misconceptions = misconceptions;
        seededFromNodes++;
      }
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
console.log(
  `\n相似度阈值：cjkDice ≥ ${THRESHOLD}${fromNodes ? `（节点做种 ≥ ${NODE_THRESHOLD}）` : ''}` +
    `｜配对 ${matched} 个选项（覆盖 ${ids} 道题）` +
    (fromNodes ? `｜其中由节点做种 ${seededFromNodes} 道` : '') +
    `｜改动 ${filesChanged} 个文件${dryRun ? '（dry-run，未写盘）' : ''}`,
);
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
