---
name: fill-coverage-gap
description: "补齐题库覆盖缺口。用户要求分析题库缺口、生成补题蓝图、按优先级补题或提升 topic × angle 覆盖率时使用。"
---

# 补齐题库覆盖缺口

把"发现缺口"到"写入合格新题"串成一个可重复流程，覆盖索引统一为 `topic × angle`（ADR-043）。默认按用户要求的数量处理，不批量生成未经检查的题目。

**内容规范在 `docs/question-content-spec.md`** —— 本 skill 只写补题的 workflow，
不重复"什么算好题"。下面每条质量要求都标注了 `spec §N`。

## 流程

1. 运行 `npm run question:coverage`，读取覆盖矩阵和补题建议（按 P0/P1/P2 优先级排序）。
2. 与用户确认要处理的范围：哪些 topic、处理几条建议、只报告还是要实际补题。
3. 运行 `npm run question:blueprint -- <limit>`，为选定数量的缺口生成蓝图 JSON。每条蓝图包含：
   - 对应知识节点的 `purpose` / `expectedConcepts`（约束这道题该考什么，见下方"expectedConcepts 的用法"）
   - `reuseCandidateIds`：同 topic 下已有题的 id，按角度梯度距离升序——**改写**成目标 angle 的候选
4. 对每条蓝图，按优先级决策（**canonical 身份不可变**：`id` 绑定的是 assessment contract，
   不是题面文字；改变 `angle / difficulty / 认知任务/诊断目标` 必须 fork 新 canonical，禁止原地改写沿用原 ID）：
    - **先看 reuse（fork/derive）**：若 `reuseCandidateIds` 中已有题可作为素材（复用 source / knowledgeId /
      expected concepts / misconception / 场景骨架甚至部分题干），以它为蓝本 **fork 一道新 canonical**
      覆盖该缺口：用 `deriveCanonicalId(topic, angle, 已有ID)` 分配新 ID，并填 `derivedFrom: <原题id>`
      保留知识血缘。**禁止**直接改原题的 angle/difficulty 后保持原 ID——那会污染 Learner Memory
      里以 `questionId` 为键的历史证据（旧分代表旧能力）。
    - **不能 reuse 才从零新写 canonical 题**，遵守蓝图里的 `purpose` 和 `expectedConcepts` 约束，不要跑题。
   - 新 canonical 题写入成功后，若需要在**同一格内**扩充题量（减少重复感），
     才走离线变体生成（`npm run question:variants`，见 ADR-069）。
5. 起草完成后，交给 **add-question-to-bank** skill 的完整校验与写入流程（题目契约、去重、语义重复检查、typecheck、test）。本 skill 不重复实现写入逻辑。
6. 补题后重新运行 `npm run question:coverage`，确认目标缺口确实被填上，且没有引入新的 topic × angle 失衡。

> **变体不是补覆盖缺口的主要机制。** 变体继承 canonical 的 `topic` 与 `angle`
> （`src/ai/variant.ts` 直接取 canonical，不重新推导），用它补洞等于把 A 格的题搬到 B 格——
> A 格重新空出来，**覆盖率永远补不满**。这也是第 3 步字段叫 `reuseCandidateIds`
> 而不是 `variantCandidateIds` 的原因：这里是「改写已有题以改变其 angle」，是 reuse，不是 variant。

## 检索视角的缺口（ADR-063/065/066）

`topic × angle` 缺口不再只影响抽题，也直接决定 Copilot 能不能答上来——但注意主次：
**知识节点是 primary corpus，题库只是 secondary evidence**（P1-3：题目含 distractor 错误说法，
不能当主要知识源；检索层对题目有 0.7 降权 + 最多 2 席槽位）。补题前先补节点，节点空则补题只增加真值、不增加可讲的知识点。

- **无知识节点的 topic = 检索盲区**：该主题下所有题在 `topic` / `knowledge` 范围都检索不到，`validate:questions` 之外没有兜底。
- **节点字段不全 = evidence 质量差**：`summary` / `required` / `misconceptions` 构成知识文档正文主体，缺一项该节点就只能靠题面撑，Copilot 退化成"从题库答案总结答案"。
- **节点 `name` 是检索锚点**：`detectQueryTopic` 用「id + name 最长匹配」判断用户想问哪个节点。新建节点时 name 必须是具体术语，且**不能是不相关节点 name 的子串**（如「规划」⊂「并发容量规划」会让短 query 误锚到 `planning`）。

补题前先跑一次**检索就绪审计**（见 **check-question-bank-quality** 的 Level 4），把 P0/P1 项并入蓝图优先级——一个没有 `misconceptions` 的节点，补再多题也只在 `answer` 模式下有用。

## 起草质量要求

自动补题最容易批量产出低质量题（历史上一次补题曾引入 25 条 strong 长度泄题），
所以起草阶段必须显式遵守 `docs/question-content-spec.md`：

- **题型以多选题为主** → `spec §9`（`question:add --check` 是硬门禁：本批 ≥3 道选择题且单选 > 1/3 直接报错）
- **干扰项必须"差点就对"，禁止稻草人** → `spec §6`
- **选项同决策层级、彼此独立、不靠"更完整"胜出** → `spec §5`
- **不得从长度 / 专业度 / 信息密度 / 限定词泄露答案** → `spec §7`
- **题干自包含、事实可追溯** → `spec §3` / `spec §4`
- **`misconceptions` 必须填**：它是 hint 模式下唯一能说清"用户错在哪"的证据。

起草时就把四个选项写成相近长度与句式，不要等 lint 报警再返工
（`npm run lint:bias` 的 strong 阈值是 1.8×）。

## expectedConcepts 的用法

**`expectedConcepts` 描述候选知识的边界，不要求单题同时覆盖全部概念。**

默认从中选**一个**作为 Core Concept，其余仅在必要时作为 supporting / prerequisite
（见 `spec §1`：默认 1 个 Core Concept + 0～2 个 Supporting，且去掉某 Concept 后题目仍成立 ⇒ 不该进来）。

不要把它读成「`[A, B, C]` ⇒ 一道题必须同时考 A+B+C」——那会让题目越写越"胖"、
概念混杂，答错了也定位不到具体缺口。

## 优先级判断

- P0 建议表示知识节点在该 angle 上完全没有题，优先处理。
- P1/P2 表示已有题但数量或角度分布不均，价值判断需要结合该 topic 的实际面试重要性，不要机械地"每个缺口都补一题"。
- 不要为了让矩阵数字好看而生成低价值、生拼硬凑的题目；覆盖率是信号，不是目标本身。
- **质量优先于数量**：宁可少补几题，也不要为了填满矩阵而降低题型与选项质量。

## 题量控制

覆盖率缺口不等于"应当无限补题"：

- 用 `npm run question:blueprint` 的 `reuseCandidateIds` 和 `question:coverage` 的格子计数确认目标 (topic, angle) 的现有题量。
- 若同一 (topic, angle) 已有 ≥ 3 题，新题必须证明自己带来了新的认知任务、场景、典型 misconception 或难度层次；仅改写措辞、换例子而不改变所考能力的不算新增价值，应优先改写已有题或改补为 0 的格子。
- 同一核心 Concept 不因"覆盖率数字"无限扩张：当该 Concept 在多个 angle 上已各有合格题时，继续加题的边际收益递减，应把补题额度让给真正为 0 的格子。
- 题量控制与质量门槛并行：见 **add-question-to-bank** 的"结构质量门槛"与 `spec §1`。

## 边界

- 蓝图的 `purpose`/`expectedConcepts` 来自知识节点，起草新题必须尊重这个**边界**，不能自行扩大考察范围（选哪个 Concept 见上节）。
- 不引入概念层或额外索引维度（ADR-042/043 已明确废弃概念层，覆盖索引只有 `topic × angle`）。
- 目标节点若 `summary` / `required` / `misconceptions` 为空，**先补节点再补题**：节点是知识源，题目只是它的 evidence（ADR-063 §11），节点空则补题只增加真值、不增加可讲的知识点。
- 最终报告需包含：处理了哪些缺口（区分 **fork 已有题（新ID + derivedFrom）** / **从零新写 canonical** / **同格内变体**）、
  对应题 id（含 derivedFrom 链）、顺带修复的知识节点字段与锚点冲突、剩余未处理的建议及其优先级。
- 严禁报告里出现"原题改 angle 后保留原 ID"：那不是复用，是 evidence 污染。
