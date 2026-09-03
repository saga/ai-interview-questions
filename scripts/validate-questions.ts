// npm run validate:questions —— 题库数据完整性校验。
// 概念层（Question.tests / KnowledgeNode.concepts）移除后，覆盖索引回归
// topic × angle 两个维度，故本脚本改为校验这两个维度的数据质量：
//   1. topic 必须存在对应知识节点（无悬空 topic）
//   2. angle 必须存在于全局角度枚举（覆盖率统计的前提）
//   3. 选择题 answer 索引必须落在 options 范围内
//   4. 选项不得重复，也不得互为前缀（前缀重复通常是正确答案文本丢失的征兆）
//   5. misconceptionMap 必须与 options 等长、下标合法，且不得标注正确选项
// 借鉴 question-coverage.ts：fs 直读 JSON（不经 Vite / import.meta.glob），Node 原生运行 TS。

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { KnowledgeNode } from '../src/schemas/knowledge';
import type { Question } from '../src/schemas/question';
import { questionAngleSchema } from '../src/schemas/common.ts';

const dataDir = fileURLToPath(new URL('../src/data/', import.meta.url));

function readJsonDir(dir: string): unknown[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .flatMap((f) => JSON.parse(readFileSync(dir + f, 'utf8')) as unknown[]);
}

const questions = readJsonDir(dataDir + 'questions/') as Question[];
const nodes = readJsonDir(dataDir + 'knowledge/') as KnowledgeNode[];
const nodeIds = new Set(nodes.map((n) => n.id));

// 合法角度以 schema 为单源（新增 angle 只改 common.ts，此处自动跟随）。
const VALID_ANGLES = new Set<string>(questionAngleSchema.options);

/** 选项去重的归一化：忽略空白与常见标点，避免只差一个句号就算两个不同选项。 */
function normalizeOption(text: string): string {
  return text.replace(/[\s，。；、,.;:：""''（）()]/g, '');
}

let errors = 0;
let withAngle = 0;
let withMisconceptions = 0;
let withMisconceptionMap = 0;
// 题型分布仅作可见性输出（AGENTS.md §4.2）：硬门禁在 question:add 上，只约束新导入批次，
// 不在这里拦全库——历史单选占比高是存量问题，卡住校验会让它永远红。
let singleCount = 0;
let multipleCount = 0;
for (const q of questions) {
  if (!nodeIds.has(q.topic)) {
    console.error(`✗ ${q.id}: topic "${q.topic}" 无对应知识节点`);
    errors++;
  }
  if (!q.angle) {
    console.error(`✗ ${q.id}: 缺少 angle（覆盖索引依赖它）`);
    errors++;
  } else if (!VALID_ANGLES.has(q.angle)) {
    console.error(`✗ ${q.id}: angle "${q.angle}" 不在合法角度枚举内`);
    errors++;
  } else {
    withAngle++;
  }
  const choice = q.formats?.choice;
  if (choice) {
    if (choice.type === 'single') singleCount++;
    else if (choice.type === 'multiple') multipleCount++;
    if (new Set(choice.answer).size !== choice.answer.length) {
      console.error(`✗ ${q.id}: 选择题 answer 索引重复`);
      errors++;
    }
    if (choice.type === 'single' && choice.answer.length !== 1) {
      console.error(`✗ ${q.id}: single 题必须恰好有一个正确答案`);
      errors++;
    }
    if (choice.type === 'multiple' && choice.answer.length < 2) {
      console.error(`✗ ${q.id}: multiple 题至少需要两个正确答案`);
      errors++;
    }
    const max = choice.options.length - 1;
    for (const i of choice.answer) {
      if (i < 0 || i > max) {
        console.error(`✗ ${q.id}: 选择题 answer 索引 ${i} 越界（options 共 ${choice.options.length} 项）`);
        errors++;
      }
    }
    const normalized = choice.options.map(normalizeOption);
    const seen = new Map<string, number>();
    normalized.forEach((n, i) => {
      if (seen.has(n)) {
        console.error(`✗ ${q.id}: 选项 ${seen.get(n)} 与 ${i} 内容重复：「${choice.options[i]}」`);
        errors++;
      } else {
        seen.set(n, i);
      }
    });
    for (let a = 0; a < normalized.length; a++) {
      for (let b = 0; b < normalized.length; b++) {
        if (a === b || normalized[a].length < 6 || normalized[b].length < 6) continue;
        if (normalized[b].startsWith(normalized[a]) && normalized[b] !== normalized[a]) {
          console.error(
            `✗ ${q.id}: 选项 ${a} 是选项 ${b} 的前缀（疑似正确答案文本丢失）：「${choice.options[a]}」`,
          );
          errors++;
        }
      }
    }
    const map = choice.misconceptionMap;
    if (map) {
      withMisconceptionMap++;
      if (map.length !== choice.options.length) {
        console.error(
          `✗ ${q.id}: misconceptionMap 长度 ${map.length} 与 options ${choice.options.length} 不一致`,
        );
        errors++;
      }
      map.forEach((v, i) => {
        if (v === null) return;
        if (!Number.isInteger(v) || (v as number) < 0) {
          console.error(`✗ ${q.id}: misconceptionMap[${i}] = ${v} 非法（须为非负整数或 null）`);
          errors++;
          return;
        }
        if (!q.misconceptions || (v as number) >= q.misconceptions.length) {
          console.error(`✗ ${q.id}: misconceptionMap[${i}] = ${v} 越界（misconceptions 不存在或过短）`);
          errors++;
          return;
        }
        if (choice.answer.includes(i)) {
          console.error(`✗ ${q.id}: 正确选项 ${i} 被标注了误解，正确选项应保持 null`);
          errors++;
        }
      });
    }
  }
  if (q.misconceptions?.length) withMisconceptions++;
}

if (errors > 0) {
  console.error(`\n校验失败：${errors} 处问题`);
  process.exit(1);
}
console.log(
  `✓ 校验通过：${questions.length} 题 / ${nodes.length} 知识节点 · 带 angle ${withAngle} 题（${((withAngle / questions.length) * 100).toFixed(1)}%）`,
);
const choiceTotal = singleCount + multipleCount;
if (choiceTotal) {
  const multiRatio = (multipleCount / choiceTotal) * 100;
  console.log(
    `  题型分布：单选 ${singleCount} · 多选 ${multipleCount}（多选占比 ${multiRatio.toFixed(1)}%，目标 ≥ 66.7%）` +
      (multiRatio < 66.7 ? ' ← 偏低，新题请以多选为主' : ''),
  );
}
// 检索就绪度仅作可见性输出：它是 hint 模式能否说清「你错在哪」的前提，
// 但存量缺口大（千题量级），卡住校验会让 validate 长期红，故不设为硬失败。
console.log(
  `  检索就绪：misconceptions ${withMisconceptions}/${questions.length}` +
    `（${((withMisconceptions / questions.length) * 100).toFixed(1)}%）·` +
    ` misconceptionMap ${withMisconceptionMap}/${choiceTotal}` +
    `（${((withMisconceptionMap / choiceTotal) * 100).toFixed(1)}%）`,
);
