// P0-2：清洗已提交的 Variant Pool。
// 一次性数据操作，但保留为脚本以便审计复现。
//
// 处置：**整批废弃** evaluation 批次的 context-options，而不是逐条删。
// 判据（全部来自实测，不是印象）：
//   1. 42 条里 30 条被确定性语言门禁拦下（从句倒置 100% + 选项以逗号收尾）；
//   2. 42 条里 41 条生造词率 ≥ 50%（对照：其它文件 context-options 中位数远低于此）；
//   3. 其余 3 个文件共 75 条 context-options **零失败** —— 说明不是 kind 本身的问题，
//      而是 evaluation 那一次生成调用整体跑偏。
// 逐条删会留下 12 条门禁看不见、但同样被污染的变体（实测其中含
// 「运行迹线」「流程失误」「位子」「本事」「径直」「失利」等翻译腔，
// 以及 ai-fund-042 那种把干扰项论证整段删掉的信息丢失），故整批废弃。
//
// 保留 evaluation 的 surface-options（42 条，零失败）。
// 无 API key 可重新生成，故只删不补；后续重跑 question-variants.ts 补回。

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const vDir = path.join(ROOT, 'src/data/variants');
const TARGET_FILE = 'evaluation.wb-llm-20260903.json';
const TARGET_KIND = 'context-options';

const dryRun = process.argv.includes('--dry-run');
const file = path.join(vDir, TARGET_FILE);
const pool = JSON.parse(fs.readFileSync(file, 'utf8'));

let removed = 0;
let kept = 0;
for (const qid of Object.keys(pool.variants)) {
  const before = pool.variants[qid].length;
  pool.variants[qid] = pool.variants[qid].filter((v: { kind: string }) => v.kind !== TARGET_KIND);
  removed += before - pool.variants[qid].length;
  kept += pool.variants[qid].length;
}

console.log(`${TARGET_FILE}：删除 ${TARGET_KIND} ${removed} 条，保留 ${kept} 条`);

if (!dryRun) {
  fs.writeFileSync(file, `${JSON.stringify(pool, null, 2)}\n`);
  console.log(`已写入 ${file}`);
} else {
  console.log('--dry-run：未写入');
}
