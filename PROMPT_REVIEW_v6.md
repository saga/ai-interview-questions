# Prompt v6 复评报告

对象：`docs/prompt_part1.md`（823 行，`[PROMPT-VERSION: v6]`）、`docs/prompt_part2.md`（761 行，`[PROMPT-VERSION: v6]`）
对比样本：
- **批次 A**（旧版 prompt 产出）：Word2Vec / 神经语言模型复杂度，8 题 = 4 canonical + 4 variant
- **批次 B**（v6 产出）：LLM 预训练数据管线，7 题 = 4 canonical + 3 variant

评审日期：2026-09-09

---

## 0. 结论

| 维度 | 上一版 | v6 | 评价 |
| --- | --- | --- | --- |
| 仓库硬约束（topic / 长度 / 题型 / 三段式 / 禁用词） | 几乎为零 | §0 前置，全部写清 | **已修复** |
| Assessment vs Presentation Variant 分野 | 错（说 variant 不得改 angle） | §20 分两类，与 ADR-077 一致 | **已修复** |
| Variant 选项逐槽同义约束 | 无 | Part1 §22 / Part2 §4 | **方向对，但不可执行** |
| 输出格式与 `question:convert` 对齐 | 断裂（要求 `formats.choice`） | 改回 `formats[]` + `{key,text}` | **已修复** |
| ID 命名 / 数量停止条件 / 版本标记 | 无 | §26 / §27、§22、`[PROMPT-VERSION]` | **已修复** |
| `misconceptions` / `source` | 上一版有 misconceptions，v6 删了 | 两侧都没了 | **回退** |
| 节点清单注入 | 无 | 有占位符，但**实际执行时未替换** | **仍是头号故障源** |

一句话：**v6 把"机器可校验的硬约束"这一层做对了，实测收益立竿见影；剩下的问题集中在两处——① 占位符没被替换导致 topic 全灭，② 变体选项约束写成了原则而非可自检的操作定义。**

---

## 1. v6 修好了什么（附实测证据）

| 修复项 | v6 位置 | 实测效果 |
| --- | --- | --- |
| 选项长度比 ≤1.8×（全体选项 max/min） | Part1 §0.4 / Part2 §0.5、§20 | 批次 A 4 题 1.8×–3.0× 超标 → 批次 B **1.13×–1.24× 全过** |
| 单选占比 ≤1/3 | Part1 §0.2 / Part2 §0.4、§21 | 批次 A 50% 超标 → 批次 B canonical **0%** |
| `reasoningGoal` 三段式 | Part1 §0.5、§13 / Part2 §0.6、§13 | 批次 A 8/8 被拒 → 批次 B **7/7 一次过** |
| Self-contained 完整禁用词 10 词 + 4 短语 | Part1 §0.6 / Part2 §0.7 | 与 `src/domain/variant.ts:57` 的 `FORBIDDEN_REFERENCES` 逐字对齐 |
| Assessment / Presentation Variant 分野 | Part1 §20 / Part2 §3 | 修掉上一版"variant 不得改 angle"与 ADR-077 的冲突；批次 B 3 条变体换面后**合法入库** |
| 变体选项不得换概念 | Part1 §22 / Part2 §4 | 见 §2.2——原则到位，但未生效 |
| 输出格式回退到 `formats[]` + `{key,text}` | Part2 §1 | `question:convert` 恢复可用（上一版整条通道失效） |
| ID 命名 `<knowledgeId>-canonical` / `-variant-1` | Part1 §27 / Part2 §22 | 批次 B 完全遵守 |
| 数量与停止条件 4–8 canonical、0–1 variant | Part1 §26 | 批次 B 恰好 4 + 3 |

---

## 2. 仍然存在的问题

### P1-1 头号故障：`[AVAILABLE_KNOWLEDGE_NODES]` 是空的

**现象**：批次 B 的 4 个 canonical 全部命中 `topic "..." 没有知识节点`（`add-question.ts:105`），这是本批**唯一**的门禁失败。

**证据**：
- Part1 §0.1 与 Part2 §0.1 都要求 `topic` 逐字等于清单中的 node id，并在 §0.1 末尾留了占位符 `[AVAILABLE_KNOWLEDGE_NODES]` 与注释「调用方在执行 Prompt 时注入当前 `src/data/knowledge/*.json` 中的节点 id」。
- 实际执行（Gemini in Chrome）时该占位符**没有被替换**，清单为空。
- 兜底语「若节点清单未提供，不得猜测 id；优先选择已经明确提供的节点」在这种情况下完全失效——没有节点可"优先选择"，模型只能造。于是产出了 `llm-pretraining-web-data-pipeline` 等 4 个全新 id。
- 反证：模型确实读懂了"topic == knowledgeId"这条规则（4 题的 `topic` 与 `knowledgeId` 完全一致，`<knowledgeId>-canonical` / `-variant-1` 的 ID 格式也完全遵守）。**错的不是理解，是输入。**

**修法**（三选一，建议全做）：
1. 把软兜底改成硬失败：清单缺失时输出 `{"error": "AVAILABLE_KNOWLEDGE_NODES not provided"}`，而不是继续生成。
2. 给"确实需要新节点"一条显式路径：输出 `"needsNewNode": true` + 建议节点草案（`id` / `name` / `area` / `topic` / `summary`），让人工在入库前补节点，而不是让模型静默造 id。
3. 把"注入节点清单"写进 Part2 顶部**加粗**提示，并与 `[PROMPT-VERSION]` 一样做成执行前必检项。

---

### P1-2 变体选项约束：写成了原则，不是可自检的操作定义

**现象**：批次 B 的 3 条变体**全部**违反 Part1 §22 / Part2 §4 的"逐槽同义改写"，逐槽 cjkDice 最低到 **20 / 32 / 29**（阈值 35）。

**证据**（`cjkDice(variant 选项 i, canonical 选项 i)`）：

| canonical | 逐槽 Dice | 结论 |
| --- | --- | --- |
| `llm-pretraining-web-data-pipeline` | 53, **20**, 37, **34** | 2 槽漂移 |
| `llm-data-filtering-heuristics` | 51, 52, 35, **32** | 1 槽漂移 |
| `llm-dataset-deduplication-strategies` | 35, 53, **29**, 41 | 1 槽漂移 |

具体违规样例：
- **dedup 变体整套换概念**：canonical 选项是 MinHash / Suffix Array / 记忆化；变体选项换成了「模型参数规模对重复样本的敏感度」——完全不是同一组命题。
- **web-data 变体选项 B 引入新数字**：「纯 Web 数据由于剔除掉**近 90%** 的原始文档」——canonical 选项里没有这个数。同时违反 Part1 §22「禁止新增技术事实」与 Part1 §10「Numeric Provenance」。
- **web-data 变体选项 D 引入新专名**：「直接保留 **CommonCrawl** 的原始未过滤网页文本」——canonical 选项未出现该数据集名。

**为什么规则没生效**：§22 / §4 只写了"允许什么 / 禁止什么"，没有给模型一个能在生成时自检的动作。模型不知道"逐槽同义"意味着"A' 必须仍然是 A 那件事"。

**修法**：
1. 加可执行自检句：**把 variant 选项 i 与 canonical 选项 i 并排读，若二者描述的不是同一个技术命题（换了机制 / 换了结论 / 换了错法），即为违规，必须改回。**
2. 给一组正/反例三元对：`canonical A` / `合法 variant A'` / `非法 variant A''`，并说明非法的理由。
3. 明写"变体选项不得引入 canonical 选项没有的**数字、专名、公式**"——这是本批最容易踩的一条。

---

### P1-3 angle 可变 + 选项不可变 = 题干与选项脱节

**现象**：Part1 §20 / Part2 §3 允许 assessment variant 改 `angle` / `cognitiveTask`；Part1 §22 / Part2 §4 又要求选项 proposition identity 不变。两条组合的实际效果是——**角度变了，选项不能变，新角度只能靠题干和 assessment 文本撑**。

**证据**：批次 B 的 dedup 变体
- canonical：`angle=architecture / cognitiveTask=evaluate`，题干问"级联组合架构"，选项考 MinHash vs Suffix Array 的覆盖互补；
- 变体原稿：`angle=causal / cognitiveTask=infer`，题干改成"推断去重程度对不同参数规模模型训练动态的因果影响"，但**选项仍是 MinHash / Suffix Array 那套**。

结果：题干问"A"，选项在答"B"。入库时被迫把变体的 assessment 改成「去重覆盖不足 → 记忆化」才自洽，原稿的「模型规模 × 重复敏感度」测量内容**因此丢失**（该内容只能另开 canonical）。

**修法**：在 Part1 §20 / Part2 §3 补一条判定标准：

> 改变 angle / cognitiveTask 后，必须用**新题干 + 原选项**仍然构成一道自洽的题。若新角度需要另一套选项才能承载，说明它不是 variant，应另建 canonical。

并给反例（就是上面这条 dedup 变体）。

---

### P1-4 `misconceptions` / `misconceptionMap` 在 v6 里被整体删掉了

**现象**：两批共 8 题全部没有 `misconceptions`。批次 B 的 4 题由我手工补齐。

**证据**：
- 上一版 Part2 §十九 明确要求 `misconceptions` + `formats.choice.misconceptionMap`；v6 的 Part2 §1 输入格式里**没有这两个字段**，Part1 也没有。
- 仓库基线：`1379` 题中 `1361` 题带 `misconceptions`（**98.7%**）。新题不带会立刻在 `validate:questions` / `question:audit` 里显眼。
- 即使 prompt 要求也没用：`convert-blueprint-output.ts` 的 `promptItemSchema`（第 33–49 行）**没有这两个字段**，Zod 默认 strip，会静默丢弃。

**修法**（prompt + 脚本要一起改）：
1. Part2 §1 加 `"misconceptions": ["...", "..."]`，并在 `formats[]` 里加 `"misconceptionMap": {"A": 0, "B": null, ...}`（用 key 对齐，避免与 0-based index 混淆）。
2. 同步改 `convert-blueprint-output.ts`：把二者映射到 `Question.misconceptions` 与 `formats.choice.misconceptionMap`（key → index）。

---

### P1-5 变体难度"不得改变"是条不可违反也不可校验的规则

**现象**：Part1 §21 / §28 与 Part2 §3 反复强调 variant 不得改变 difficulty，但：
- Part1 §28 已禁止 variant 输出 `difficulty`；
- `convert-blueprint-output.ts` 的变体产物里**根本没有 `difficulty` 字段**（只有 `sourceSnapshot.difficulty` 作为快照）。

即：结构上不可能违反，也没有任何脚本会校验它。三处重复强调纯属噪声。

**修法**：保留一处即可（说明"variant 无 difficulty 字段，继承 canonical"），把另外两处的篇幅让给 §2.2 / §2.3 那种真正会被踩的规则。

---

### P2-1 单选占比口径错了

**现象**：Part2 §21 写「整个本批最终输出时：如果 choice >= 3，multiple >= 2/3」。但仓库门禁的口径是**导入批 = canonical 子集**。

**证据**：`add-question.ts` 只遍历被导入的草稿文件，而 `convert-blueprint-output.ts` 把 canonical 与 variant 拆成两个文件——**variant 不参与题型门禁**（`assemble-variants.ts` 也没有该题型的 gate）。

后果：若某批 4 道 canonical 里 2 道 single、8 条 variant 全 multiple，按 prompt 口径是 2/12 = 17%（合格），按仓库口径是 2/4 = 50%（**直接拒收**）。

**修法**：Part1 §0.2 与 Part2 §0.4 / §21 统一改成「**canonical 子集**中 single ≤ 1/3，variant 不计入」。

---

### P2-2 `evidenceCriterion` 仍然无落点

Part1 §11 与 §28 输出格式里都有 `evidenceCriterion`，Part2 §1 输入格式里没有，`convert-blueprint-output.ts` 也不读它。两批产出里它被静默丢弃。

**修法**：二选一——① Part2 加字段并映射到 `assessment`（但 schema 只有 `target` / `reasoningGoal`，得先扩 schema）；② 从 Part1 输出格式里删掉，别再产出。建议 ②，除非真的要扩 schema。

---

### P2-3 `knowledgeId` 同名不同义的风险仍在

Part1 §27 与 Part2 §1 都输出 `knowledgeId`（= 知识节点 id）；而 `Question.knowledgeId` 在 schema 里是**课程知识点 id**（`courseId` 配套）。`convert-blueprint-output.ts:100-108` 已注释承认并在 `knowledgeId !== topic` 时告警丢弃。

当前是安全的（因为脚本明确丢弃），但只要有人把 convert 改成透传，就会污染一个语义不同的字段。

**修法**：Part2 输出里改名 `blueprintKnowledgeId`，或在 §1 注明"此字段不进最终 Question，仅用于与 topic 对账"。

---

### P2-4 `concepts` 数组的顺序语义没写明

Part2 §18 说"1 个 core；0～2 个 supporting"，但没说**顺序即语义**。`convert-blueprint-output.ts:126` 的实现是 `const [core, ...supporting] = item.concepts`——**数组第一个元素被当成 core**。

**修法**：Part2 §18 明写"数组第一个 = core，其余 = supporting（最多 2 个；脚本会截断到 3，但请自行控制在 2）"。

---

### P2-5 `source` 完全没提

v6 删掉了上一版 Part2 的 §二十三 Source。两批 8 题全部无 `source`。

仓库基线：`1027 / 1379`（74%）无 `source`——确属常态，但文章转题本来是最该有溯源的。

**修法**：与节点清单一并注入 `[SOURCE_MATERIAL_ID]`，在 Part2 硬约束里要求每题输出 `source: { materialId }`，并同步给 `convert-blueprint-output.ts` 加该字段（现在会被 strip 掉）。优先级可放到 misconceptions 之后。

---

### P2-6 「下文」误伤「上下文」，prompt 侧无法规避

`src/domain/variant.ts:57` 的 `FORBIDDEN_REFERENCES` 含「下文」，而中文题干里的「**上下文**」包含该子串。批次 A 就因此被拒（题干的"上下文窗口"被判禁用指代）。

v6 已把禁用词清单写全（好事），但模型无法知道"上下文"会踩雷。

**修法**：
- prompt 侧：在 §0.6 / §0.7 加一句「注意：'下文' 是禁用词，**'上下文' 含该子串会被门禁误判**；请改用'滑动窗口''语境''前后文'之外的表述」。
- 仓库侧（更根本）：把 `FORBIDDEN_REFERENCES` 的匹配改成带边界，避免子串误伤。这条门禁现在是假阳性。

---

### P2-7 长度口径未定义

`detectOptionLengthBias` / `detectOptionLengthRatio`（`src/domain/bias.ts:86`）用的是 `String(o).trim().length`——**字符数（含标点与空格）**，不是 token、不是字节。prompt 只写 `length`。

**修法**：§0.4 / §0.5 明写"按字符数计（含标点与空格）"，并给出"生成后逐题列出各选项字符数并算比值"的动作要求。

---

### P2-8 §19 与 §20 还有一点残余张力

Part1 §19 说 Variant 不是"换背景"；§20 说 Assessment Variant 可以改变 `context` / `role` / `constraints`。

**修法**：§19 加限定——「此处禁止的是**仅**换背景而 reasoning path 不变；Assessment Variant 改变 context 时必须同步改变 reasoning path」。

---

### P2-9 未引用 `AGENTS.md` §4.1（但有进步）

- v6 §0.6 只管禁用指代词，没有管「不得把来源特定内容做成主要考点」。
- 好消息：Part1 §2「不要把原文中的一句定义作为 Knowledge」+ §10「不是必要的数字就删除」起作用了——**批次 B 明显好于批次 A**：4 题都是可迁移的工程判断（Web vs Curated 取舍、行级过滤、去重架构、WARC/WET），脱离原文可答；而批次 A 4 题全是论文公式复述（$Q = N \times D + D \times \log_2(V)$），已逼近"名词记忆题"边界。
- 残留：批次 B 题干仍出现 `MinHash + LSH`、`Suffix Array`、`fastText`、`Trafilatura`、`WARC/WET`、`CommonCrawl`。所幸它们只是背景，不是答题前提。

**修法**：补一条显式规则——

> 专有工具名 / 格式名 / 数据集名可以出现在题面作为背景，但不得成为答题前提。判据：**删掉该名字后题目若失去技术意义，就必须重写。**

---

### P2-10 `category` / `tags` 无取值约定

Part2 §23 只说"简洁稳定的领域分类"。实测两批分别是 `Natural Language Processing`（学科名）与 `LLM Data Engineering`（领域 + 职能），风格不一致。

**修法**：给一组既有 category 清单，或规定格式（如"技术域 / 职能"二段式）。

---

### P2-11 难度分布无约束

仓库基线 `easy 85 / medium 587 / hard 707`——hard 占 51%。批次 B 是 `medium / hard / hard / medium`，尚可。但 prompt 完全没提。

**修法**：Part1 §26 加一句"一批内不要全部落在 hard；至少覆盖两个难度档"。

---

## 3. 与脚本的三处契约缺口（prompt 改了脚本没改）

| prompt 侧 | 脚本侧 | 后果 |
| --- | --- | --- |
| 无 `misconceptions` / `misconceptionMap` 要求 | `convert-blueprint-output.ts` 的 zod schema 无此二字段，默认 strip | 即使模型产出也静默丢失 |
| 无 `source` 要求 | 同上 | 同上 |
| `concepts` 数组顺序 = core 优先 | 脚本确实按首元素取 core，但 prompt 未写 | 隐患：模型把 supporting 放第一个就会被当成 core |
| Part2 要求 variant 的 `difficulty` 不变 | 变体产物无 `difficulty` 字段 | 规则不可违反，也不可校验 |

---

## 4. 建议 patch 清单（按优先级）

### 必须做（做完可消掉 100% 的实测失败）

1. **节点清单硬失败**：`[AVAILABLE_KNOWLEDGE_NODES]` 缺失时停止生成并输出 error；同时给 `needsNewNode` 显式路径。（→ P1-1）
2. **变体选项自检动作化**：加"并排读同一槽位"的自检句 + 正/反例三元对 + 「不得引入 canonical 没有的数字 / 专名 / 公式」。（→ P1-2）
3. **angle 变更后自洽性判定**：新题干 + 原选项必须仍构成自洽的题，否则另开 canonical。（→ P1-3）
4. **单选占比口径改为 canonical 子集**。（→ P2-1）

### 应该做

5. Part2 加 `misconceptions` + `misconceptionMap`，同步改 `convert-blueprint-output.ts`。（→ P1-4）
6. Part2 加 `source.materialId`，同步改脚本。（→ P2-5）
7. §0.4 / §0.5 明写长度按字符数计 + 要求逐题算比值。（→ P2-7）
8. §0.6 / §0.7 加「上下文」误伤提示；仓库侧改 `FORBIDDEN_REFERENCES` 为带边界匹配。（→ P2-6）
9. §18 明写 `concepts` 首元素 = core。（→ P2-4）
10. 补 `AGENTS.md` §4.1 的"专名不得成为答题前提"规则。（→ P2-9）

### 可选

11. 删除三处重复的"variant 不得改 difficulty"中的两处。（→ P1-5）
12. `evidenceCriterion` 要么落地要么删除。（→ P2-2）
13. `knowledgeId` 改名 `blueprintKnowledgeId`。（→ P2-3）
14. §19 加"仅换背景"限定。（→ P2-8）
15. `category` 给清单或格式约定；难度分布加"至少两档"。（→ P2-10 / P2-11）

---

## 5. 一句话

**v6 已经把"该写什么"写对了，剩下的是"怎么让它真的被执行"——一是把节点清单注入做成硬前置，二是把变体选项约束从原则翻译成模型能自检的动作。这两处改完，批次 B 的 4 个错误和 3 条变体返工可以全部归零。**
