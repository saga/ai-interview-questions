# plan0903_3 · 转向新 Prompt 模型（part1/part2）的迁移设计

**方向**：用户已确认从现行 ADR-073/076 契约转向 `docs/prompt_part1.md` + `docs/prompt_part2.md` 定义的新模型。
**性质**：数据契约 + 变体语义 + 导入门禁的架构级变更。按 AGENTS.md 大原则 1，先出设计、确认后再执行。
**现状日期**：2026-09-03。题库 1311 题 / 113 节点 / 变体池 104。

---

## 一、四个正面冲突（现状 → 新模型）

| # | 现状（ADR/schema/门禁） | 新模型（part1/part2） | 冲突等级 |
|---|---|---|---|
| 1 | Variant = 同一 assessment contract 的表达变体；换 angle/difficulty/认知必须新建 canonical（ADR-073/076） | Variant 必须采用"明显不同的测量方式"，优先改变 angle / cognitiveTask / reasoning direction / observable evidence / constraint / context 中至少两项（part1 §七）；"仅仅改表达不算 variant" | **P0，直接矛盾** |
| 2 | `Question` 无 `cognitiveTask` / `questionRole` / `variantOf` / `concepts` 字段；zod 默认 strip，来稿相关字段落库即丢（plan0903_2 已实测） | Blueprint 与输出格式要求 `angle`（14 值，含 causal/diagnosis/prediction/architecture/boundary/misconception/quantitative/implementation/synthesis）、`cognitiveTask`（11 值）、`questionRole`、`variantOf`、`concepts`、`knowledgeId`、`assessmentTarget`、`reasoningGoal` | **P0，来稿（GAN 批即实例）信息丢失** |
| 3 | ~~`question:add --check` 硬门禁：本批 ≥3 道选择题且单选 > 1/3 直接报错（AGENTS.md §4.2：multiple ≥ 2/3） | part2 §七：默认 single-choice…~~ **本行已于 2026-09-04 撤销：核对现行 `prompt_part2.md` §三/§四/§五/§二十一，原文是「默认多选，只有天然唯一最佳判断时才单选」，与现行门禁同向，不存在冲突。** 附带的真冲突见下 | ~~P0~~ → 无冲突 |

| 3b | 现行门禁与 spec 允许 `open` 形态（库内存在纯开放题） | part2 §三 / §二十一：**禁止 open** | P1，生成期与存量口径不一致 |
| 4 | `formats` 是对象 `{choice?, open?}`；选项 `string[]`；答案是索引数组 | part2 §十八：`formats` 是数组，选项是 `{key, text}`，答案是 `"A"` | P1，运行时全链路依赖现行结构 |

实证：上一批 GAN 来稿的 3 个 variant 按 part1 §八标准（"答对 canonical 后是否还需明显不同的思考"）很可能被判重复——而它们已按现行契约入库。这是"用旧尺子收了新题"的实例。

---

## 二、迁移方案（分三期）

### 第一期：契约与语义（必须，改 ADR + schema + 变体管线）

1. **Variant 新定义（修订 ADR-073/076，记 ADR-077）**：
   - Canonical：同一 Knowledge 最核心的一种测试（angle + cognitiveTask 固定）。
   - Variant：同一 Knowledge、**不同 reasoning path** 的测量；允许改变 angle / cognitiveTask / constraint / context，但**不允许改变 Knowledge 与答案逻辑**（第 N 项真假对应、正确答案集合语义不变）。
   - 上限：每 canonical 0～2 个 variant；不存在自然高价值 variant 时为空（part1 §十）。
2. **Schema 增量（只加法，不改存量运行时）**：
   - `Question` 新增可选 `cognitiveTask`（11 值枚举：recall/explain/identify/diagnose/compare/predict/apply/evaluate/design/troubleshoot/infer）与可选 `concepts`（`{core: string, supporting: string[]}`，对应"1 核心 + 1～3 辅助"）。
   - `angle` 枚举扩展 8 个新值（causal/diagnosis/prediction/architecture/boundary/misconception/quantitative/implementation/synthesis）。`diagnosis` 与现有 `debugging` 的关系：debugging 保留（工程排障场景），diagnosis 专指"从现象定位机制/根因"的认知行为；两者并存，由出题 skill 引用 spec 区分。
   - `questionRole` / `variantOf` **不加入** `Question`（变体不嵌入题库，ADR-069 双模式不变）；转换器把来稿 variant 映射为变体池条目（`variantOf` → 池 key，`questionRole=variant` → `kind` 推导）。
   - `knowledgeId` 维持可选；`assessmentTarget` / `reasoningGoal` 作为出题期元数据进蓝图文件，不进 `Question`（避免运行时 schema 膨胀）。
   - `formats` 数组重构**明确不做**（运行时 session/评分全链路依赖现行对象结构）；转换器归一化来稿格式。
3. **变体管线适配（代码改动点，封闭清单）**：
   - `QuestionVariant` 新增可选 `angle` / `cognitiveTask`（变体自声明的测量面；缺省 = 继承 canonical）。
   - `applyVariant`：优先采用变体自声明面，缺省才 `...canonical` 继承（当前是无条件继承，会静默覆盖新模型 variant 的意图）。
   - `validateVariant`：drift 门禁保留（逐项改写幅度上下限），但比对基准改为"同真值项"而非"逐字相近"——新模型 variant 的正确项允许为不同 reasoning path 重写表达，只要答案逻辑一致（已有第 N 项真假约束，只需放宽 Dice 下限并以 challenger 为准）。
   - `isVariantStale`：sourceHash 口径不变（仍覆盖 canonical 元数据+题面选项）；变体自声明面变更走自身的版本号，不触发 stale。
   - Learner evidence：变体作答仍归因到 canonical `questionId`（证据键不变；不同 reasoning path 的区分度量留待 BKT/IRT 阶段，当前不引入新 abstraction）。
4. **存量处理原则**：1311 道存量题**不回填** `cognitiveTask`/`concepts`（无可靠信息源，LLM 反推即污染）；新字段可选，存量零破坏。存量变体池 104 条维持"同 contract 表达变体"语义继续有效（新定义是其超集：表达变体 = reasoning path 相同但仍有记忆对抗价值的特例，予以保留）。

### 第二期：导入门禁与出题 skill（改脚本 + 文档）

5. ~~**题型门禁翻转**~~ **已于 2026-09-04 撤销**：核对 `prompt_part2.md` §三 / §四 / §五 / §二十一 原文后确认，
   新模型是「**默认 multiple-choice**，只有 Blueprint 已明确指定或天然唯一最佳判断时才 single」，
   与现行门禁（multiple ≥ 2/3）**同向**，原判断基于过期版本。门禁与 AGENTS.md §4.2 均**不动**。
   （附带遗留：part2 §三/§二十一 写「禁止 open」，而库内存在纯开放题 —— 这是生成期口径，
   不追溯存量；若将来用 part2 全量重生成，需先决定 open 的去留。）
6. **新增导入校验**：新题若带 `cognitiveTask`，必须属于 11 值枚举；`angle` 若用 8 个新值之一，`question:add` 提示其与邻近旧值的区分（如 diagnosis vs debugging）；`concepts` 若提供，须满足 1 核心 + ≤3 辅助。
7. **出题 skill 引用**：`article-to-questions` / `add-question-to-bank` / `fill-coverage-gap` 改为引用 part1/part2（替代 `docs/添加题库prompt.md` 的生成指令地位；后者降级为历史参考，标注"已被 part1/part2 取代"）。

### 第三期：质量债（内容层，可独立排期）

8. **Explanation 补错误项归因**：全库 1258/1311 的 explanation 零覆盖错误项（part2 §十要求解释关键错误项）。只给高频/高价值题补，不做全库重写。
9. **Calculation 趋势化**：hf/inference 的纯换算题（flashattn-07"33 倍"、mxfp4、vram-budget 类）按 part1 §十二改写为趋势/比例/反事实判断；sebastian 系趋势题已符合。
10. **机械句式**：22 道"下列/以下哪项"改写；翻译腔抽检（不定量规则，先人审 50 道）。
11. **变体池回填**：backlog（35+18 题）的新 variant 按新定义生成（0～2 个、reasoning path 不同），需 LLM key。

### 明确不做

- `formats` 数组重构（运行时影响面过大，转换器兜底）。
- 存量 1311 题回填 cognitiveTask/concepts（无可靠源）。
- BKT/IRT（evidence 仍归因 canonical）。
- 把 8 个新 angle 强行映射回旧 10 值（允许并存，由 spec 区分；coverage 矩阵自然扩展）。

---

## 三、验证清单（执行后必须全绿）

- `npm run typecheck` / `npm run test`（含新增 schema 单测：cognitiveTask 枚举、angle 新值、variant 自声明面继承优先级）
- `npm run validate:questions`（1311+ 题，angle 白名单扩展后仍全绿）
- `npm run question:add -- --file <新格式样例> --check`（验证单选默认 + 新字段校验）
- `npm run question:validate-variants`（104+3 池健康；新 variant 自声明面不误报 stale）
- `npm run question:identity -- --gate --since <base>`（contract 口径：canonical 仍为 topic×angle×difficulty；cognitiveTask 是否入 contract——**待定，见 §四 D4**）

## 四、待确认的决策点（需用户拍板后才能执行）

- **D1**：Variant 新定义是否如 §二.1 所述（含"表达变体作为特例保留"）？
- **D2**：`cognitiveTask` 是否进入 canonical assessment contract（即改 angle/difficulty/**认知任务**任一即 fork）？注意这会扩大 identity 门禁；推荐**进入**（与 ADR-076 原文字一致，之前是代码没实现，现在补上）。
- ~~**D3**：题型门禁翻转 + AGENTS.md §4.2 修订是否接受？~~ **2026-09-04 关闭**：核对 part2 原文后确认无冲突，门禁不动。
- **D4**：存量 104 条旧变体是否 grandfather（维持有效）？
- **D5**：第三期 8–11 是否与第一、二期同批执行，还是另排期？

---

## 五、附：新模型与题库现状的量化对照（2026-09-03 实测）

- 定义题干（"是什么"结尾）：53/1311（4%）——基本符合 part2 §六。
- explanation 零覆盖错误项：1258/1311 —— 最大内容缺口（§三.8）。
- calculation 48 道：约半数纯换算（§三.9）。
- 机械句式"下列/以下哪项"：22 道（§三.10）。
- 强稻草人干扰项：全库清零（前两轮已清）。
- 单选 629 / 多选 682 —— 按现行门禁"多选不够"，按新模型"多选过多"，见 D3。
