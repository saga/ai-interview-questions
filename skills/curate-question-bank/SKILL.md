---
name: curate-question-bank
description: "存量题治理：批量执行 KEEP / REWRITE / DELETE 并重新验证。用户要求整理存量题、批量改写、清理低价值题、按 check 报告动手处置，或题库规模较大需要分批治理时使用。"
---

# 存量题治理（Transform）

对**已存在的题**批量执行 KEEP / REWRITE / DELETE，并逐条复核闭环。
对应职责模型里的 **Transform** 环节，与其它 skill 的关系：

```
fill-coverage-gap        = Plan        （该补什么）
article-to-questions     = Extract + Author
add-question-to-bank     = Author      （写新题并落库）
check-question-bank-quality = Diagnose （发现问题、分级、给动作）
curate-question-bank     = Transform   （本 skill：按诊断动手 + 重新验证）
```

**入口通常是 check 的报告。** 先跑 **check-question-bank-quality** 拿到分级与动作建议，
再进本 skill 执行；不要跳过诊断直接挑题改——那会退化成"凭感觉整理题库"。
内容规范见 `docs/question-content-spec.md`。

## 执行流程

1. **确定批次与动作清单**。从 check 报告里取出待处置项，按动作分组：

   | 动作 | 处理方式 | 退出条件 |
   | --- | --- | --- |
   | **KEEP** | 不动，只在报告里标记"已查且通过" | — |
   | **REWRITE** | 按下方改写契约动手 | 复核通过 |
   | **DELETE** | 移除该题 | 已在诊断里写明"无改造价值"，并在报告中补记格子回退 |
   | **FIX REQUIRED** | 结构性硬修复（答案索引、topic 挂靠、选项重复） | 契约校验通过 |

   批次建议 ≤ 20 题一批：每批单独跑完整验证，避免一次性大改后无法定位回归。

2. **最小化修改**（`git diff` 要能一眼看懂）：
   - 保留题目 `id`、保留原数据文件的格式与排序风格（`apply_patch`，不要整文件重写）。
   - 只改诊断指向的字段，不顺手"优化"其它内容。
   - 题库 JSON 存在**两种格式风格**（展开式与紧凑式），
     **禁止用 `JSON.stringify(_, null, 2)` 整文件重排**——那会产生上千行纯格式 diff。
     需要脚本批量改时，用保留原文风格的字符串级补丁，并校验非目标题零漂移。

3. **改写契约**（REWRITE 的执行标准，来自 `check-question-bank-quality`）：

   - **先定目标，再改写**。不要整题重新生成——那样极易再生一道重复题。
   - 保留核心 Knowledge：`topic` 不变。**身份红线**：凡改写后 `angle / difficulty`
     发生变化（题干/选项/考察侧重实质改变），必须 fork 新 canonical
    （`deriveCanonicalId` 分配新 ID + `derivedFrom` 指回原题），**不得**保留原题 id；
     保留原 id 仅限「内容不动、只纠正明显标错的 `angle` 字段」这一种情形。
   - 优先调整考察侧重（`angle` + 题面），而非重出一道同类题。
     例：`kv-cache` 已有 4 道 `definition` → 以其中一道为蓝本 fork 新题，目标 `angle` 为 `tradeoff`、`difficulty` 为 `medium`。
   - **只换 `angle` 的前提是：该题内容本身已属于目标 angle（只是字段标错）。**
     若内容是低价值 `definition` 回忆题，必须改写题干/选项/解释让它真正变成
     mechanism/comparison/… 题，`angle` 随内容自然改变。
     **绝不允许只把标签从 `definition` 改成 `mechanism` 而内容不动**——
     那只是在骗 `topic × angle` 密度计数器，没有提升诊断价值。
     改前务必通读题目内容，逐题判断是「标错」还是「内容低价值」。
   - 同 `topic × angle` 已有 ≥ 3 题时，改写后的题必须带来新的考察侧重、场景、
     典型 misconception 或难度层次（见 `fill-coverage-gap` 的题量控制）。

4. **改写内部 Prompt（10 条硬约束）**
   > 你正在维护一个已有的 AI/ML 面试题库。任务不是简单换句话说，而是在保留核心知识的前提下提高面试价值与诊断价值：
   > 1. 保留原题真正考察的核心知识（`spec §1`）。
   > 2. 不得与已有题重复（`spec §2`）。
   > 3. 若原题是低价值 `definition`，优先转 `mechanism` / `comparison` / `tradeoff` / `scenario` / `debugging`。
   > 4. 保证正确答案唯一（`spec §2`）。
   > 5. 错误选项必须来自真实技术误解或条件错配（`spec §6`）。
   > 6. 所有选项处于相同决策层级和粒度（`spec §5`）。
   > 7. 不得通过答案长度、完整程度、专业术语数量泄露答案（`spec §7`）。
   > 8. 不要为增加难度而加入无关知识（`spec §1`）。
   > 9. 保持题目 self-contained（`spec §3`）。
   > 10. `explanation` 必须说明核心原理和关键误区。

5. **重新验证（每批必跑）**：
   - `npm run validate:questions`
   - `npm run question:quality` —— 确认该批的嫌疑信号确实减少（软信号，不阻断）
   - `npm run lint:bias`
   - `npm run question:review -- <id>`（逐题）
   - `npx vitest run src/data/bank.test.ts`
   - 若改动了 `topic` / `misconceptions` / `explanation`，再跑：
     `npx vitest run src/domain/knowledge/retrieve.test.ts src/application/conversation/knowledgeCapability.test.ts`
     与 **check-question-bank-quality** 的 Level 4 检索就绪审计
   - `npm run typecheck` 和 `npm run test`
   - `git diff --check`

6. **闭环确认（最后一步，别漏）**

   报告里必须**逐条确认原问题已消失**——不是「改完了」，是「原 P1 项重新审计后不再命中」。

   ```text
   - P1 `xxx-01`（Option Quality / spec §6）：REWRITE → 复核：重跑 question:quality 探测器 ②，
     原命中项已不在清单内 ✓
   - P1 `yyy-02`（低价值 definition）：DELETE → 复核：`kv-cache × definition` 格子由 4 题回退到 3 题，
     该格仍 ≥ 3 题，无需重新补缺 ⚠
   ```

   复核未通过的标 `REWRITE → 复核未通过`，回到待办清单，不要靠"已处理"糊过去。
   **DELETE 必须补记格子回退情况**：删除会让该题覆盖的 `topic × angle` 格子题量 -1，
   若该格因此归零，需同步告知并转 **fill-coverage-gap** 评估是否补题。

## DELETE 的判定红线

- **P0 structural 不可 delete 绕过** —— 结构坏了就是坏了，删掉只是把洞藏起来。
- DELETE 只适用于 **P1 content 且无改造价值**：核心 Concept 本身不值得考
  （过时、纯产品绑定、纯术语记忆且无法改写为工程场景），且改写成本高于重出一道新题。
- 每条 DELETE 必须在报告里写明**为什么不能 rewrite**。写不出理由的，默认走 REWRITE。

## 边界

- 不判定质量分级（那是 **check-question-bank-quality** 的事），只执行已给出的动作。
- 不决定补哪些缺口（那是 **fill-coverage-gap** 的事）；DELETE 造成的格子回退要**同步告知**，由它决策。
- 不写全新题（那是 **add-question-to-bank** 的事）；REWRITE 保留原题 id 与核心 Concept
  仅当 `topic × angle × difficulty` 不变，改变任一项即按上方身份红线 fork 新题。
- 默认不批量删除：单批 DELETE 超过 5 题时先向用户确认。
- 最终报告需包含：本批处理了哪些题（id + 动作 + 依据的 `spec §N`）、复核结果、
  DELETE 造成的格子回退、剩余待办与仍需人工复核的事实。
