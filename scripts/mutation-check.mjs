#!/usr/bin/env node
// 变异测试脚手架（mutation harness）—— 回答唯一一个问题：
//   「如果把某个具体的 bug 重新塞回代码，有没有测试变红？」
//
// 用途：**删除/裁剪测试之前先跑一遍**。删完再跑一遍：
//   - 仍然 N/N → 没有丢掉被这条变异守住的覆盖面；
//   - 某条不再变红 → 说明删过头了，那条变异守的测试被误删，需还原。
//
// 为什么需要它：只跑「全绿」证明不了任何覆盖面——测试删掉一半通常还是全绿。
//
// 用法：
//   node scripts/mutation-check.mjs            # 跑全部
//   node scripts/mutation-check.mjs --only id  # 只跑某条（可重复）
//   node scripts/mutation-check.mjs --list     # 只列条目
//
// 设计约束（都是踩过的坑）：
//   1. **基线预检**：先跑一遍所有被引用的测试文件，任一为红就中止。
//      否则「文件已停在变异态」会伪装成「锚点没匹配上」，让人误以为是脚手架 bug。
//   2. **用内存快照还原，不用 git**：工作区常带未提交改动，`git checkout` 会把它们一起冲掉。
//   3. 变异体必须仍是**合法 TypeScript**：让 tsc/vitest 编译失败也算「变红」，
//      但那是弱信号（测的是编译而不是断言），所以这里刻意只写语义合法、只改行为的变异。

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 每条 = 一个「不变量 → 守它的测试文件」的映射。
 * old 片段必须在文件里**恰好出现一次**（脚手架会断言），否则报错而不是静默跳过。
 */
const ENTRIES = [
  {
    id: 'chrome-availability-gate',
    why: 'ADR-088：Chrome 模型未就绪（downloadable/downloading）时必须在建 session 前拒绝，否则页面静默卡 90s',
    file: 'src/ai/chrome.ts',
    old: "  if (availability !== 'available') {",
    new: "  if (availability === 'unavailable') {",
    guards: ['src/ai/chrome.test.ts'],
  },
  {
    id: 'chromeagent-tools-from-messages',
    why: 'ADR-089：streamFn 的 context.tools 恒为 undefined，工具清单必须从 system 消息还原，否则合法工具调用被判失败',
    file: 'src/ai/chromeAgent.ts',
    old: '    tools: context.tools ?? getCurrentTools(context.messages),',
    new: '    tools: context.tools ?? [],',
    guards: ['src/ai/chromeAgent.test.ts'],
  },
  {
    id: 'chromeagent-no-raw-json-leak',
    why: 'ADR-089：解析失败但「像工具调用」时必须发 error，不能把 {"tool":...} 当推理文本展示给用户',
    file: 'src/ai/chromeAgent.ts',
    old: '  if (looksLikeToolCall(raw)) {',
    new: '  if (false && looksLikeToolCall(raw)) {',
    guards: ['src/ai/chromeAgent.test.ts'],
  },
  {
    id: 'toolcalljson-fence',
    why: '工具调用 JSON 可能被 ``` 代码块包裹，抽取必须兼容',
    file: 'src/ai/toolCallJson.ts',
    old: '  if (fence) jsonStr = fence[1].trim();',
    new: '  if (fence && false) jsonStr = fence[1].trim();',
    guards: ['src/ai/toolCallJson.test.ts'],
  },
  {
    id: 'learner-collect-first-wins',
    why: 'collectTopicRefs 去重必须「保留首次出现」，否则同 topic 的 category 会被后来的覆盖',
    file: 'src/domain/learner.ts',
    old: '    if (!seen.has(q.topic)) seen.set(q.topic, { category: q.category, topic: q.topic });',
    new: '    seen.set(q.topic, { category: q.category, topic: q.topic });',
    guards: ['src/domain/learner.test.ts'],
  },
  {
    id: 'learner-weak-topics-attempted-guard',
    why: '推荐薄弱主题必须排除「从未作答」的 topic（attempts > 0），否则会把没考过的主题当薄弱项推给用户',
    file: 'src/domain/learner.ts',
    old: '    .filter(([, s]) => s.attempts > 0 && s.avgScore < threshold)',
    new: '    .filter(([, s]) => s.avgScore < threshold)',
    guards: ['src/domain/learner.test.ts'],
  },
  {
    id: 'evaluation-weight-normalization',
    why: 'aggregateOverall 必须按可用维度的权重**重新归一化**，而不是直接加权求和（否则缺维度时分数被压低）',
    file: 'src/domain/evaluation.ts',
    old: '    (acc, dim) => acc + dimensions[dim] * (usableWeight > 0 ? rubric[dim] / usableWeight : rubric[dim]),',
    new: '    (acc, dim) => acc + dimensions[dim] * rubric[dim],',
    guards: ['src/domain/evaluation.test.ts'],
  },
  {
    id: 'quiz-choice-order-insensitive',
    why: '选择题判分必须与选项顺序无关（答案 [0,2] 与作答 [2,0] 应判对）',
    file: 'src/domain/quiz.ts',
    old: '  const s = [...selected].sort((x, y) => x - y).join(\',\');',
    new: '  const s = [...selected].join(\',\');',
    guards: ['src/domain/quiz.test.ts'],
  },
  {
    id: 'adaptive-mastered-tier-last',
    why: 'rankCandidatePool 必须把「已掌握」主题排到最后（tier 2），否则会优先出已经会的题',
    file: 'src/domain/adaptive.ts',
    old: '    const tier = weak ? 0 : s && s.attempts > 0 ? 2 : 1;',
    new: '    const tier = weak ? 0 : 1;',
    guards: ['src/domain/adaptive.test.ts'],
  },
  {
    id: 'settings-json-indent',
    why: 'stringifyConfig 必须输出两空格缩进（配置文件给人看/手改）',
    file: 'src/storage/settings.ts',
    old: '  return JSON.stringify(c, null, 2);',
    new: '  return JSON.stringify(c);',
    guards: ['src/storage/settings.test.ts'],
  },
  {
    id: 'tools-reject-duplicate-question',
    why: 'getQuestion 传已交付过的 id 时必须拒绝重复呈现（否则用户会重复看到同一道题）',
    file: 'src/agent/tools.ts',
    old: '      } else if (isDelivered(session, q.id)) {',
    new: '      } else if (false) {',
    guards: ['src/agent/tools.test.ts'],
  },
];

const argv = process.argv.slice(2);
if (argv.includes('--list')) {
  for (const e of ENTRIES) console.log(`${e.id}\n    ${e.file}\n    ${e.why}\n    guards: ${e.guards.join(', ')}`);
  process.exit(0);
}
const only = argv.reduce((acc, a, i) => (a === '--only' ? acc.concat(argv[i + 1]) : acc), []);

function runTests(files) {
  const r = spawnSync(
    process.execPath,
    ['node_modules/vitest/vitest.mjs', 'run', ...files, '--reporter=dot'],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } },
  );
  return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || '') };
}

const selected = only.length ? ENTRIES.filter((e) => only.includes(e.id)) : ENTRIES;
if (selected.length === 0) {
  console.error('没有匹配的条目。用 --list 看可用 id。');
  process.exit(1);
}

// ── 0) 基线预检：任何被引用的测试文件已经是红的，就中止 ──
const baselineFiles = [...new Set(selected.flatMap((e) => e.guards))];
console.log(`[baseline] 预检 ${baselineFiles.length} 个测试文件…`);
const base = runTests(baselineFiles);
if (!base.ok) {
  console.error('[baseline] ✗ 基线是红的——工作区可能停在某个未还原的变异态。先跑 `git diff` 检查，再重试。');
  console.error(base.out.split('\n').slice(-25).join('\n'));
  process.exit(2);
}
console.log('[baseline] ✓ 全绿\n');

// ── 1) 逐条变异 ──
let caught = 0;
const failures = [];
for (const e of selected) {
  const abs = path.join(ROOT, e.file);
  const original = fs.readFileSync(abs, 'utf8');
  const occurrences = original.split(e.old).length - 1;
  if (occurrences !== 1) {
    console.log(`✗ ${e.id} —— 锚点匹配 ${occurrences} 次（应为 1）。检查该片段是否已被改动。`);
    failures.push(e.id);
    continue;
  }
  try {
    fs.writeFileSync(abs, original.replace(e.old, e.new));
    const res = runTests(e.guards);
    if (res.ok) {
      console.log(`✗ ${e.id} —— 变异后测试**仍然全绿**，这条不变量没有被守住`);
      console.log(`    ${e.file}: ${e.old.trim()}  →  ${e.new.trim()}`);
      console.log(`    守它的文件: ${e.guards.join(', ')}`);
      failures.push(e.id);
    } else {
      caught += 1;
      console.log(`✓ ${e.id}`);
    }
  } finally {
    fs.writeFileSync(abs, original); // 内存快照还原，不依赖 git
  }
}

console.log(`\n===== ${caught}/${selected.length} 条变异被测试捕获 =====`);
if (failures.length) {
  console.log('未捕获/异常条目：');
  for (const f of failures) console.log('  -', f);
  console.log('\n未捕获 ≠ 脚手架坏了。多数情况下它指出的是**测试套件的真实空洞**：');
  console.log('先补一条能杀掉该变异的测试，再重跑整个脚手架。');
  process.exit(1);
}
console.log('全部被捕获：当前测试套件对这些不变量仍然诚实。');
