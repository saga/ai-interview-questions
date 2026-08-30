# 设计变更记录
> 记录每次影响设计/架构的变更。新条目追加在顶部，标注日期与变更点。

## 2026-08-30 · getCoverageGaps 重定义为「覆盖度」事实查询，与 getUserWeaknesses 正交

- **问题**：`src/agent/tools.ts` 的 `getCoverageGaps` 描述为"读取覆盖缺口（未练或前置未掌握的 topic）"，实现却是 `recommendWeakTopics(profile, 5)`——与 `getUserWeaknesses` **完全同源**。两个工具、同一种行为、两种描述，会误导模型以为拿到了两个不同信号；代码注释自己也承认"此处返回通用提示"。
- **修复**：
  1. 新增 `domain/learner.findCoverageGaps(topicRefs, profile, opts)`：只遍历**题库中确实存在题目**的 topic（`collectTopicRefs(bank)`），逐个判定两类缺口——`prerequisite`（存在题库内且未达掌握线的前置）与 `uncovered`（`attempts === 0`，即无任何作答证据且前置完备）。
  2. 语义与 `getUserWeaknesses` 正交：后者是 **mastery-based**（已练但薄弱，看 `mastery`/`avgScore`），本工具是 **coverage-based**（还没练到，看作答证据 + 前置链）。**已练但未掌握、前置完备的 topic 不算覆盖缺口**，两者不再重叠。
  3. 已掌握的 topic 直接跳过（不为已会的内容刷屏）；前置列表只保留题库中也存在的 topic——用户无从练习的前置不是可闭合的学习缺口，那是题库生产问题。
  4. 排序：**前置缺口优先**（基础没打就去练上层是无效投入），同档内按拓扑序（基础优先）+ topic 名字典序，保证稳定可测。
  5. 新增 `describeCoverageGap()` 生成只读文案，区分「未练习」「前置 X 尚未掌握」「未练习，前置 X 尚未掌握」。
  6. `recommendWeakTopics()` **完全移出**该工具；工具 description 同步写明两者分工（该描述即 LLM 可见提示）；补 `session.log` 条目供 UI 透明化。
- **保持事实查询**：不含优先级分数、不推荐具体题目、不生成学习路径——排序与取舍仍是 Agent 的决策，工具只做确定性执行。
- **放置位置**：`findCoverageGaps` 落在 `domain/learner.ts`（与 `isAttempted` / `isMastered` / `WEAK_AVG` / `computeCoverage` 同处），**而非** `domain/coverage.ts`——后者是 ADR-032 的题库生产侧 topic×angle 矩阵，不感知学习者状态、运行时不加载。详见 ADR-049。
- **验证**：`src/domain/learner.test.ts` +9 例（44）、`src/agent/tools.test.ts` +4 例（22 → 26）；均已反向验证——还原旧实现后 4 例工具测试失败，破坏「前置优先排序」与 `isAttempted` 守卫后 3 例 domain 测试失败，确认用例真实捕获行为。`npx vitest run` 378 passed，`npx tsc --noEmit` 0 error。

## 2026-08-30 · getQuestion 不再重复出题：topic 兜底拒绝回退到已考察的题

- **问题**：`src/agent/tools.ts` 的 topic 兜底（LLM 把 topic/category 当题号传入时的容错）原为 `unasked[0] ?? byTopic[0]`。当某主题所有题都已考察过，`unasked` 为空会回退到 `byTopic[0]`——即该主题第一道题，而它往往已在 `answers` / `evaluations` 里，**用户会重复看到已答过的题**。
- **修复**：
  1. 新增 `isDelivered(session, id)` 作为「是否已交付」的单一判定（已作答 / 已评分 / 正是当前题），topic 兜底改为 `byTopic.find((x) => !isDelivered(...))`，**绝不**再回退到已交付的题。
  2. 该主题全部考察过时返回新错误码 `topic_exhausted`（不再静默换题），并回带**全题库中尚未交付**的题号交由 Agent 决策下一步——换去哪个主题是选题决策，工具不越权代劳。
  3. `isDelivered` 对 `evaluations[id]` 用 `in` 而非真值判断：`null`（未作答 / 评估失败）也算已交付，与 `countEvaluated` 口径一致，避免把「答不上来的题」再问一遍。
  4. `validIdPool` → `deliverableIds`：not_found 自纠正回带的题号同样过滤掉已交付的题（此前会把当前正在作答的题也列为建议 id，等于诱导 Agent 重复选题），并剔除已不在题库中的陈旧 id。
  5. 全部题目考察完时明确提示调用 `finishInterview`，而不是继续兜底。
- **提示同步**：`getQuestion` 的 tool description 同步新语义（该描述即 LLM 可见的工具提示，必须与代码一致）。
- **验证**：`src/agent/tools.test.ts` 新增 7 例（15 → 22）；已反向验证——还原旧实现后其中 5 例会失败，确认用例真实捕获该 bug。`npx vitest run` 365 passed，`npx tsc --noEmit` 0 error。

## 2026-08-30 · 变体链路收敛修复：validateVariant 真正成为 gate + 保守漂移检查 + angle 入契约

- **问题**：`ai/variant.generateVariant` 此前未调用 `domain/variant.validateVariant`，而是直连 `extractJSON → detectOptionLengthBias → return`，导致 ADR-036 的“LLM 输出必须经 domain 校验”未在真实链路兑现；`toGeneratedVariant` 对缺失 `question` 静默回退原题掩盖模型失败；retry 后未再校验；FORBIDDEN 指代与 prompt 对“答案适用条件不变量”表述偏弱；已有的 `angle` 未进入 Knowledge Contract。
- **修复（5 项收敛，不引入 embedding/LLM judge）**：
  1. `ai/variant.generateVariant` 真正接入 `validateVariant`：首版失败则带校验原因一次性重试，仍失败抛错由 `application/sessionEvaluator.finalizeQuestion` 统一回退原题。
  2. `detectOptionLengthBias` 的一次性重试后**再次 `validateVariant`**，失败保留首版已校验候选，避免 retry 绕过 gate。
  3. `toGeneratedVariant` 移除 `out.question ?? q.question` 静默回退，缺失题干由校验显式拒绝。
  4. `domain/variant.validateVariant` 新增极保守 concept evidence 检查（topic/tags/required 任一 token 命中即放行，拆 token 匹配避免整句误伤，全部丢失才拒）与 expanded `FORBIDDEN_REFERENCES`（新增 前文/下文/题目中/题干中）。
  5. `ai/variant.buildUser` 将 `q.angle` 注入契约并加角度提示；`VARIANT_SYSTEM` 新增【正确答案不变量】段（先锁定原正确结论再重构选项，不得因换场景偷改适用条件）。
- **文档**：`docs/ARCHITECTURE.md` LLM 变体安全小节图示与校验描述同步上述链路；`src/domain/variant.test.ts` 与 `src/ai/variant.test.ts` 同步新门禁与证据逻辑。
- **验证**：`npm run test` 356 passed（含新增概念漂移与重试再校验用例），`npm run build`（`tsc -b`）通过。

## 2026-08-30 · 变体校验引入 fuzzball 模糊匹配兜底（纯 JS 浏览器可用）

- 在 `domain/variant.hasConceptEvidence` 的精确 token 命中后追加 `fuzzball` 二阶段模糊判定（`token_set_ratio ≥75` / `partial_ratio ≥80`），处理词序/形态/拼写差异：`batch statistics ↔ statistics computed across the batch`（100）、`regularisation ↔ regularization`（93）等；纯 JS 无后端，适配 Vite SPA，计算量仅 1题×数个概念×数百字。
- 依赖：`npm install fuzzball`（52KB 原始，gzip +15KB，经 `vite build` 验证）；阈值偏保守，漂移文本（`regularization` vs CNN/BatchNorm 题）仍 18 分正确拒绝。`docs/ARCHITECTURE.md` 技术栈注意点与校验小节同步；`src/domain/variant.test.ts` 新增 2 例模糊证据用例（356→358 passed）。

## 2026-08-29 · O'Reilly Radar 高价值技术主题题库补充

- 基于 O'Reilly Radar 首页筛选并阅读全文，新增 20 道题，来源为 [The Identity Crisis No One Planned For](https://www.oreilly.com/radar/the-identity-crisis-no-one-planned-for-governing-non-human-agents-at-enterprise-scale/)、[Effective Patterns for Advanced MCP Usage](https://www.oreilly.com/radar/effective-patterns-for-advanced-mcp-usage/)、[When Smaller Models Win](https://www.oreilly.com/radar/when-smaller-models-win/) 和 [When Guardrails Go Wrong](https://www.oreilly.com/radar/when-guardrails-go-wrong/)。
- 题目覆盖非人类身份生命周期、意图绑定授权、Agent 供应链和沙箱、多服务组合、远程多租户、MCP 聚合与上下文膨胀、专用小模型、模型路由、LoRA、推理约束、Guardrails 的 ROC 权衡、上下文级判定、稳定性和纵深防御。
- 题目保留文章小节作为来源依据，但将具体产品和供应商降级为背景，重点考察可迁移的身份治理、权限边界、系统设计、性能成本、评估、排障与安全工程原则。题库批次见 [src/data/questions/oreilly-radar-2026-08.json](../src/data/questions/oreilly-radar-2026-08.json)。

## 2026-08-29 · AWS Well-Architected Lens 子页面题库补充

- 基于 Financial Services Industry、Agentic AI、Responsible AI、Machine Learning 和 Generative AI Lens 的总览页及其安全、可靠性、监控、身份权限、响应校验、数据集治理和发布标准子页面，新增 30 道题，每个 Lens 6 道。
- 题目覆盖原子 Agent、分级人工监督、动态最小权限、RTO/RPO、金融数据保护、风险登记、发布置信度、数据集重叠、ML 漂移监控、shadow testing、RAG 性能、模型/Token 成本、提示注入、数据投毒和输出护栏等可迁移工程原则。
- 来源：[Financial Services Industry Lens](https://docs.aws.amazon.com/wellarchitected/latest/financial-services-industry-lens/financial-services-industry-lens.html)、[Agentic AI Lens](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentic-ai-lens.html)、[Responsible AI Lens](https://docs.aws.amazon.com/wellarchitected/latest/responsible-ai-lens/responsible-ai-lens.html)、[Machine Learning Lens](https://docs.aws.amazon.com/wellarchitected/latest/machine-learning-lens/machine-learning-lens.html)、[Generative AI Lens](https://docs.aws.amazon.com/wellarchitected/latest/generative-ai-lens/generative-ai-lens.html)，以及各 Lens 的具体子页面和 Responsible AI custom lens 细则。

## 2026-08-29 · LLM 安全与金融服务 AI 场景补充

- 新增 `llm-application-security` 与 `financial-ai-governance` 两个知识节点，覆盖提示注入、间接注入、最小权限、不安全输出处理、敏感信息泄露、红队评估、供应链风险，以及金融高影响决策、模型验证、公平性、解释、欺诈检测、隐私、漂移、供应商治理和审计。
- 新增 18 道题：8 道 LLM 应用安全题、10 道金融服务 AI 场景题。题目强调模型外的权限边界、故障半径、证据链和人工复核，不把生成式模型的平均准确率或自我声明当作安全保证。
- 来源：[OWASP GenAI LLM Top 10 2026](https://genai.owasp.org/resource/owasp-genai-llm-top-10-2026/)、[Federal Reserve SR 11-7 Model Risk Management](https://www.federalreserve.gov/supervisionreg/srletters/SR1107.htm)、[CFPB adverse action and AI](https://www.consumerfinance.gov/about-us/blog/continued-use-of-ai-and-adverse-action-requirements/)、[NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework)。

## 2026-08-29 · LLM 可靠性与提示鲁棒性补充

- 新增 `factuality-verification`、`generation-reproducibility` 和 `prompt-robustness` 三个原子知识节点，覆盖高风险场景的证据校验与拒答、随机性与后端变更导致的复现边界、以及语义等价提示扰动和回归测试。
- 新增 14 道题，明确“不能承诺 100% 正确”：工程目标是封闭证据、逐条验证、拒答/人工升级和确定性降级；固定 seed、采样参数和模型配置只能提高复现性，不能保证绝对一致；单一 prompt 的成功率不能代表鲁棒性。
- 来源：[Anthropic Reduce hallucinations](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-hallucinations)、[OpenAI reproducible outputs cookbook](https://developers.openai.com/cookbook/examples/reproducible_outputs_with_the_seed_parameter)、Sclar 等人的 [FormatSpread 论文](https://arxiv.org/abs/2310.11324)。

## 2026-08-29 · Claude Blog 技术题库扩充

- 新增 30 道基于 Anthropic Claude Blog 公开文章的题目，覆盖 Managed Agents 的 dreaming、memory、Outcomes、独立 grader、多 Agent 编排，以及 AI-native SDLC 的版本化交付物、连续评估、hooks、沙箱、MCP 部署工具、环境权限分级和确定性控制带。
- 新题复用现有原子知识节点，通过 `claude-blog`、文章主题 tags 和 `source` 元数据保留出处，不新增产品或认证分类节点。
- 题目批次见 [src/data/questions/claude-blog-2026-08.json](../src/data/questions/claude-blog-2026-08.json)，来源为 [Managed Agents](https://claude.com/blog/new-in-claude-managed-agents) 与 [AI-native SDLC playbook](https://claude.com/blog/the-ai-native-sdlc-playbook)。

## 2026-08-29 · 知识体系与分类解耦（ADR-042：认证题解耦与纯净能力域架构）

- **认证考纲与能力域解耦**：将 `google-genai-leader`、`anthropic-cca`、`aws-ai-practitioner`、`aws-genai-developer-pro` 等 76 道认证考题全部解构并精确映射到对应的原子技术知识节点（如 `rag`、`agent-fundamentals`、`evaluation`、`multi-agent`、`mcp`、`observability`、`system-design` 等），同时保留各题的认证专属 tags（如 `tags: ["aws-genai-developer-pro", "certification"]`）。
- **Taxonomy 骨架净化**：移除 [src/data/taxonomy.ts](src/data/taxonomy.ts) 中混杂的认证 Topic，使 6 大能力域与 23 个标准技术 Topic 保持纯粹与高度一致；更新对应的角度白名单（`ANGLE_WHITELIST`）。
- **知识库去冗余**：清理 [src/data/knowledge/](src/data/knowledge/) 中 4 个粗粒度认证 JSON 定义，知识库收敛至 75 个标准原子概念节点。覆盖矩阵 177/177 期望网格 100% 覆盖，0 缺口，323 项单测全部通过。

## 2026-08-29 · 知识分布结构优化与基础题阶梯扩充

- **难度金字塔重塑**：新增 20 道高质量 Easy/Medium 题目，重点补强 `llm-applications`（RAG 分块/混合检索/重排、向量嵌入几何意义、上下文 Few-shot 与结构化输出）及 `ai-security`（直接/间接注入攻防、安全护栏、循环配额熔断）。
- **题库总量提升**：题库规模扩充至 719 题，Easy 题量提升至 57 题，为自适应测评提供更扎实的基础概念探针。
- **题目规范修复**：修正 `deep-learning.json` 中 `dl-14`（VAE ELBO 公式）的选项文本规范化歧义，全库 P0/P1 结构与内容问题清零。

## 2026-08-29 · 基础与中级题库补充

- 将跨 topic 的生产补题批次从 `p0-gap-fill.json` 重命名为 `foundational-and-intermediate.json`，名称改为描述题目用途而非内部优先级。
- 新增 14 道 easy/medium 题，覆盖 CNN、序列模型、多模态、数据泄露、MCP、工具安全、上下文窗口和 RAG；题目均提供 choice/open 双形态。
- 题库总量增至 683 题，覆盖矩阵缺口由 25 个降至 16 个；新增内容依据 TensorFlow CNN 教程、MCP 官方架构文档、IBM LLM 概览和 OWASP GenAI 安全资料复核。

## 2026-08-29 · 覆盖缺口清零

- 继续补充 16 道题，覆盖 `activation`、`cnn`、`flash-attention`、`graph-rag`、`latent-moe`、`mcp`、`multimodal`、`planning`、`pytorch-performance`、`sequence-models`、`task-oriented-ai` 和 `tool-security` 的剩余角度。
- 题库总量增至 699 题，覆盖矩阵达到 187/187；难度分布为 easy 41、medium 301、hard 357。
- 新增内容依据 FlashAttention 论文、PyTorch 官方性能指南、MCP 官方架构文档和 Anthropic Agent 设计指南复核。

## 2026-08-29 · 引入 Python 题库分析栈

- 目标方案恢复为 ONNX Runtime：`optimum` 核心包与 `optimum-onnx` 集成包分开；依赖使用 `optimum-onnx[onnxruntime]>=0.1.0`，不使用此前不准确的 `0.0.3`。
- Apple Silicon 离线分析使用仓库内 `model_qint8_arm64.onnx`（约 118 MB）；Sentence Transformers 通过 ONNX backend 在 CPU 上运行，CoreML provider 留待独立 benchmark。
- `pyproject.toml` 增加 `analysis` optional extra：Pydantic、pandas、NumPy、rapidfuzz、scikit-learn、networkx 和 sentence-transformers；由 `uv.lock` 固定解析结果。
- 新增 `scripts/question_analysis.py`：提供题库统计、模糊近重复、TF-IDF/KMeans 聚类、基于 TF-IDF 的难度可预测性分析和真实 `conceptGraph.json` 图分析；`--semantic` 用一次 embedding 同时执行语义重复检测和 embedding 聚类。实际分析发现 `ai-fund-026` ↔ `llm-03` 相似度 0.9245，列为人工合并/改写候选。
- 保持边界：Python 只做离线分析，TypeScript/Zod 仍是题库运行时契约唯一来源；模型分析结果只能作为人工复核信号。

## 2026-08-29 · 题库质量自动化工具

- 新增 `scripts/question_audit.py`：使用 Python 标准库输出题库规模、分布、topic × angle 覆盖率，以及重复题、占位选项、答案契约和时效元数据告警。
- 新增 `scripts/add-question.ts`：复用 TypeScript/Zod 题目契约，导入前检查 ID、规范化题干、topic/angle、选项和新增覆盖格；默认只检查，显式 `--write` 才写入题库。
- Python 仅承担离线分析，不复制 TypeScript schema；题库运行时契约仍由 Zod、数据测试和 `validate:questions` 共同维护。

## 2026-08-29 · 覆盖矩阵改为核心角度优先

- **问题**：原覆盖矩阵把每个知识节点声明的所有 angle 都视为必须独立出现的题目类型，导致宽泛认证节点出现模型性缺口；例如 `aws-genai-developer-pro` 已有 50 道场景题，却因缺少其他标签产生 6 个缺口。
- **决策**：收窄认证/课程节点的强制角度目标，优先保证核心知识与应用场景，不为清零矩阵制造换皮题。AWS GenAI Developer 保留 `scenario`，AWS Practitioner 保留 `scenario`/`tradeoff`，Anthropic CCA 保留 `scenario`/`mechanism`/`debugging`，Google GenAI Leader 保留 `definition`/`fundamental`/`mechanism`/`scenario`。
- **结果**：覆盖缺口由 53 个降至 41 个；P0 缺口仍为 16 个，说明核心技术节点的真实补题工作仍需按 required 要点和题目质量逐批完成。
- **原则**：新增题优先补 `gqa`、`cross-entropy`、`rope`、`overfitting`、`regularization` 等题量少且缺少计算/权衡/场景的 P0 节点；认证节点的剩余角度缺口不再自动等价为知识缺口。
- **题库批次文件**：题库加载改以题目自身 `category` 为分类来源，允许 `p0-gap-fill.json` 这类生产批次文件跨领域收录题目，不会把批次文件名暴露为 UI 分类。
- **P0 补题批次**：新增 16 道经过 choice/open 双形态校验的题目，覆盖 BN、交叉熵、DPO、Dropout、GQA、梯度下降、推理优化、MoE、过拟合、正则化、RoPE、采样、分词和 Transformer 定义缺口；覆盖缺口由 41 降至 25。

## 2026-08-29 · 第二轮清理：Chrome fallback、旧配置迁移、types.ts 收敛、仓库卫生

- **双引擎评分统一**：新增 `application/sessionEvaluator.ts`，集中单题判空、选择题判分、开放题 LLM 评分与 rubric 默认值；`interviewEngine.ts` 与 `agent/tools.ts` 共用同一评分入口，Agent 不再保留重复实现；题型过滤也统一走共享 `effectiveFormats`。
- **Agent 正式方向**：按 ADR-034 将 Agent 运行时作为未来正式方向保留；`getQuestion` 现在复用共享 `finalizeQuestion`，生成并校验 LLM 变体，失败时回退原题。
- **Chrome Built-in AI 加速**：`chromeAgent.ts` 将稳定 JSON 工具协议移入 system prompt；user prompt 仅保留最近 10 条历史（单条最多 900 字符）和紧凑工具 schema，减少每轮重复输入；新增提示词压缩回归测试。

- **Chrome AI**：`ChromeAIExecutor` 的 `clone()` 增加 fallback——不支持 `clone()` 的浏览器版本退化为独立 `create()`（重新解析 system 指令，但通道不再整体失效）。
- **⚠️ 用户数据契约变更**：`storage/settings.ts` 的 `loadConfig` 删除旧单选形态（`{ provider, model, apiKey, baseUrl }`）迁移分支，只识别 `{ providers: [...] }`。极旧格式的本地配置会被判定为不合法并回退到默认配置（不会崩溃，但需要用户在设置页重新配置一次）。localStorage key 本身不变。
- **`src/types.ts` 收敛**：删除所有数据形状类型的 re-export（`Question`/`AIConfig`/`LearnerProfile`/`SessionRecord`/`KnowledgeNode` 等 20+ 个），调用方（60 余个文件）改为直接从 `schemas/*` 导入；`types.ts` 只保留没有单一归属模块的跨层行为契约（`LLMProvider`/`QuestionBank`/`AnswerValue`/`CompleteFn`/`GeneratedVariant`/`VariantCandidate`/`QuestionBlueprint`/`EVAL_DIMENSIONS`/`DIMENSION_LABELS`）。顺带修正 `domain/evaluation.test.ts`、`domain/learner.test.ts` 中两个不存在的类型引用（`ChoiceQuestion`/`OpenQuestion`，此前仅因 `*.test.ts` 被排除在 `tsc` 之外才未报错）。
- **仓库卫生**：`.gitignore` 移除与本项目无关的 Angular 残留条目（`/out-tsc/`、`/.angular/`、`/.angular-cli.json`、`/.ng/`、`/e2e/test-output/`、`/tmp/`）；删除根目录过程稿（`PR0-transformer-pilot.md`、`PR1-PR4-concept-coverage.md`、`PR5-PR6-concept-coverage.md`、`llm-replacement-analysis.md`、`pi-agent-core-alignment.md`、`concept-coverage-action-list.md`、`embedding-questions-preset.md`、`CHECKLIST.md`、`QUALITY_AUDIT.md`、`agent-interview-stuck-analysis.md`、`prompt.txt`、`ARCHITECTURE-REVIEW.md`）——结论均已沉淀在 `docs/DECISIONS.md`/`docs/CHANGELOG.md`（如 agent 面试卡死问题已在 `interviewAgent.ts` 的 watchdog + `ensureQuestionDelivered` 兜底中修复），过程稿不再保留；删除 `ttt/`（AI 协作草稿区，按 AGENTS.md 本就不该入库）、`temp/`（抓题脚本残留）、`outputs/`（陈旧的源文件/报告副本，非实际依赖）。
- **`App.tsx` 拆分**：把 13 个 `useState`/6 个 `useRef` 与全部训练时序处理函数（`handleStart`/`handleAdaptiveNext`/`handleFinishEarly`/`doSubmit`/`handleAgentComplete`/`handleRestart` 等）抽到新的 `src/hooks/useTrainingSession.ts`；`App.tsx` 从 567 行减到 333 行，只保留路由/布局/导航与 JSX 渲染。
- 验证：`npm run typecheck` / `npm run build` / `npm run test` 全绿（308 passed）。


## 2026-08-29 · 收敛未使用的架构预留

- 删除未使用的 `graphology` 依赖，并从 `.gitignore` 移除 `package-lock.json` 忽略规则。
- 删除没有读写方的 Dexie `memory` / `agentSessions` 空表；保留实际使用的 `errorLog`。
- 删除尚未接线的 `QuestionSource` 课程题库抽象；课程设计暂缓到出现真实课程需求时再建模。
- 删除 `LearnerProfile.subtopicCoverage` 及其聚合/查询 API；`Question.subtopic` 仍保留为题目展示和 Agent 上下文字段，当前学习选题只使用 topic 与 topic×angle 证据。
- 将 Agent 双运行时标记为阶段性并行方案，将变体失败策略与代码统一为“校验/调用失败回退原题”。
- 验证：`npm run typecheck` 通过；全量测试 309 passed；learner / adaptive / storage 定向测试 48 passed。

## 2026-08-29 · 删除 `Question.reference`；topic×angle 掌握度成为确定性引擎选题主干（ADR-045）

- **动机**：`Question.reference` 仅含 `reference.concept`（核心结论摘要），与必填的 `Question.explanation` 内容重复，与 `open.referenceAnswer` 不重复但后者才是完整材料；同时 `weakAnglesOf`（ADR-037）此前只被 Agent 追问工具使用，确定性引擎 `pickNextAdaptive` 只用证据计数做兜底排序，没把 topic×angle 掌握度作为选题主干。
- **决策**：① 删除整个 `Question.reference`（评分提示里的「概念提示」段一并移除，`explanation` 已于 ADR-044 承担题目级锚点）；② `learner.ts` 新增同源原语 `angleWeakRank`，`adaptive.ts` 用它在各策略子集内做「弱角度优先、证据最少次之」的细选（`pickByWeakAngle`），替换原 `pickLeastCovered`/证据计数兜底，move-on 先按 topic 级薄弱粗筛再按弱角度细选。
- **改动**：数据删除 308 处 `reference`（23 个文件）；`schemas/question.ts` 删 `reference` 字段；`ai/evaluate.ts` 的 `buildEvalUser` 删「概念提示」段；`domain/learner.ts` 新增 `angleWeakRank`；`domain/adaptive.ts` 以 `pickByWeakAngle` 重构选题。
- **验证**：`tsc` 通过；全量 `npm run test` **309 passed**（新增 1 例弱角度优先）；数据层 `reference` 残留 0。

## 2026-08-29 · 删除 `Question.rubric`，评分锚点改由「知识点要点 + explanation」承担（ADR-044）

- **动机**：`rubric` 覆盖 493/624 题（79%），是需逐题维护的高覆盖字段，但其中 `rubric.required` 有 **239 题（48.5%）与所属知识节点 `required` 逐字相同**（纯副本）；`rubric.dimensions` 仅覆盖 185 题（29.6%）、21 种权重组合，为少量微调维护整套字段不划算。
- **决策**：删除整个 `Question.rubric`，评分锚点改为两层——泛化锚点用 `KnowledgeNode.required`（单一来源），题目锚点用已有的 `Question.explanation`（不增加任何维护成本，净减一个字段）；四维权重统一使用全局 `scoringRubric`。
- **⚠️ 事实澄清**：`rubric` 与 `explanation` **原本并无交互**——`explanation` 只用于 UI 展示（`ResultPanel` / `SessionReplayDrawer`）与变体生成，**从不参与评分**；评分时 LLM 拿到的是 `open.referenceAnswer`。本次是让 `explanation` **新增**承担评分锚点，而非"两者本就重合"。
- **改动**：
  - 数据：删除 493 处 `rubric`（28 个文件）
  - `schemas/question.ts`：删 `rubricSchema` 与 `rubric` 字段
  - `domain/knowledge.ts`：`requiredPointsFor` 改为只取 `KnowledgeNode.required`
  - `ai/provider.ts`：`mergeQuestionRubric` 不再合并题目级 dimensions，只返回全局权重副本 + 知识点要点
  - `ai/evaluate.ts`：`buildEvalUser` 新增「题目解析」段，把 `q.explanation` 作为题目级评分锚点注入
  - `agent/tools.ts`：`evaluateSessionQuestion` 改用全局 `DEFAULT_RUBRIC`
  - 测试：改写 3 个 rubric 用例；新增 2 例（explanation 注入评分提示 / 为空时不产生多余段落）；`bank.test.ts` 的 rubric 权重校验改为校验 explanation 非空
- **已知代价**：254 题（51.5%）的逐题定制 `required` 移除后，评分依据由 explanation 承担——信息量相当，但形态从"结构化要点清单"变为"解析文本"；185 题失去题目级权重定制。
- **验证**：`tsc` 通过；全量 `npm run test` **308 passed**；数据层 `rubric` 残留 0。

## 2026-08-29 · 移除概念层，覆盖索引统一为 topic × angle（ADR-043，取代 ADR-042）

- **动机**：ADR-042 的概念层（`KnowledgeNode.concepts[]` 概念面 + `Question.tests` 概念标注）落地后只服务约 **20%** 的题库——概念面仅挂 9/79 节点，题目 `tests` 仅 123/624 题（即便当天刚补齐 rag/agentic-ai 的 80 题）。同时它与 `subtopic`/`tags` 重复建模，且 `primary/supporting` 的判定高度主观，标注规则 + QA + 维护的成本换不到对等的体验提升。
- **决策**：删除整个概念层，覆盖索引回归 **`topic × angle`**（两者均 100% 覆盖、无需额外人工标注）。详见 ADR-043。
- **删除清单**：
  - 数据：`Question.tests`（123 处）、`Question.transient`（0 处）、`KnowledgeNode.concepts[]`（9 处）
  - 整文件删除（13 个）：`domain/probe.ts`、`domain/curation.ts`、`infra/curationStore.ts`（连带空目录 `src/infra/`）、`ai/generateQuestion.ts`、`scripts/generate-concept-questions.ts`，以及 8 个测试文件
  - 部分移除：`coverage.ts`（删 7 个概念统计函数，保留 ADR-032 的 topic×angle 矩阵）、`adaptive.ts`（删概念优先路径与 `conceptCtx`/`allowProbe` 参数）、`blueprint.ts`（删 PR5 概念蓝图与 PR6 探针组装）、`provider.ts`（删 `generateQuestion` 及三个实现）、`interviewEngine.ts`（删 `buildConceptContext` / Dynamic Probe / `curationSink`）、`types.ts`、`schemas/question.ts`、`schemas/knowledge.ts`
  - npm script：`generate:concept-questions`、`curation:produce`
- **保留未动**：ADR-032 的 `questionCoverageMatrix`（topic×angle 覆盖矩阵）与补题建议、ADR-037 的 `angleCoverage` / `weakAnglesOf`、`conceptGraph`（知识关系图，与概念层无关）、`subtopic` 字段。
- **改写**：`scripts/validate-questions.ts` 原为概念标注校验，改为面向新索引的通用数据校验（topic 必须有知识节点、angle 必填且在枚举内、选择题 answer 不越界）。
- **验证**：`tsc` 通过；全量 `npm run test` **306 passed**（删减 58 个概念相关用例，另补 2 个验证"无概念层后自适应仍正常"）；`npm run validate:questions` 通过（624 题 / 79 节点，**angle 覆盖 100%**）。

## 2026-08-29 · 补齐 rag / agentic-ai 域的 `Question.tests` 概念标注（ADR-042 概念面推广收尾）

- **动机**：ADR-042 的「概念面推广」（2026-08-26）只完成了**节点挂 `concepts[]`**，却漏了配套的题目 `tests` 标注——624 题中仅 43 题有 `tests`（全在 transformer），rag/agentic-ai 域 **80 题为 0**。而 `findQuestionForConcept`（`adaptive.ts:113`）硬依赖 `q.tests` 找题，导致这两个域的概念优先抽题**实际空转**：开 AI 则每步都触发 Dynamic Probe 现场生成临时题（慢、费、质量不可控），关 AI 则直接回退原 topic/angle 路径。
- **变更**：为八节点（rag / vector-db / rag-pipeline / reranking / agent-fundamentals / agent-loop / tool-calling / agent-guardrails）下的 **80 道题**补 `tests`（primary 唯一、每题 ≤3 概念），落在 4 个文件：`agent-fundamentals.json` 31、`rag.json` 26、`tool-calling.json` 17、`search.json` 6。标注为结合题干与概念面语义逐题判定，未用关键词硬匹配。
- **验证**：`npm run validate:questions` 通过（624 题，含 tests 的题 **43 → 123**）；该域 tests 覆盖率 **0% → 100%**；概念覆盖 **59/66 → 62/66**；全量 `npm run test` 364 passed。
- **剩余 4 个无题覆盖的概念（真实知识缺口，正是 curation 管线的补题输入）**：
  - `vdb-params`（ef / M / nprobe 参数调优）、`rag-latency`（端到端延迟与吞吐）——本次推广域内新暴露；
  - `ffn`、`kv-cache`——transformer 节点既有缺口（PR0 试点即已存在，可按 ADR-042 的 Blueprint 管线补题）。
- **文档同步**：ADR-042 更正概念面数量（rag / agentic-ai 各 **28**，原写 33 / 35），并新增「概念面生效的前置依赖」警示——挂 `concepts[]` 与标 `tests` 必须配套，只做前者等于空转。

## 2026-08-29 · 统一 Chrome 内置 AI 的并发/超时配置（修复六处数值互相矛盾）

- **动机**：`chromeAI` 的并发与超时在六处给出五种互相矛盾的说法——代码常量 `8/90s`、同文件 JSDoc `2/60s`、测试标题 `4`、测试注释 `8`、测试断言要求恰好 `8`、CHANGELOG 声称"已纠正为 4/60s"、ARCHITECTURE 写 `2/60s`。其中 CHANGELOG 记录的"纠正"当时**并未落到代码**；而测试把 `maxActive >= 8` 硬编码成断言，又把错误值锁死，导致"改代码就红、不改又与文档矛盾"。
- **决策**：并发定为 **4**、单次超时 **90s**、重试 **1**（超时保留 90s：本地模型首题含预热，60s 易误判为卡死而触发不必要重试）。
- **变更**：
  - `src/ai/chrome.ts` 新增导出常量 `CHROME_AI_CONCURRENCY=4` / `CHROME_AI_TIMEOUT_MS=90_000` / `CHROME_AI_RETRIES=1`，`chromeAI` 单例改为引用它们；同步修正同文件注释与 `chromeComplete` 的 JSDoc（原写"默认并发 2、单次 60s"）；`ChromeAIExecutor` 构造函数的兜底默认值（原 `?? 2` / `?? 90_000` / `?? 1`）也一并改为引用这些常量——自此全模块内这三参数只有一处数字。
  - `src/ai/chrome.test.ts` 并发用例改为**从常量取值**（任务数取 2×并发上限），断言 `maxActive <= CHROME_AI_CONCURRENCY` 且 `== CHROME_AI_CONCURRENCY`——调整并发数时测试自动跟随，不再把某个具体数字"锁死"，同时仍能捕捉"悄悄退化成串行"。
  - `docs/ARCHITECTURE.md`「Chrome 内置 AI 的并发与卡死」小节数值改为 4 / 90s，并注明单一出处。
  - 本文件 2026-08-28 条目的「默认并发」行加勘误，并复核其"建议 6~8"的结论。
- **验证**：`chrome.test.ts` 11 项通过；全量 `npm run test` 与 `tsc` 均通过。

## 2026-08-28 · ChromeAIExecutor 改用「基准 session + clone 每题」模式（贴合官方最佳实践）

- **动机**：Chrome 官方 dos/donts 明确——Prompt API 不要用相同 system 反复 `create()`（每次都重新解析 system 指令，延迟更高），应建一个基准 session（含 `initialPrompts`）、每题用 `clone()` 派生独立会话。我们原先是每道题 `create()` 一次。
- **变更**：`runPromptOnce` 改为先经 `getBaseSession(system)` 惰性创建并缓存基准 session（按 system 串缓存、memoize create promise 避免并发重复创建），每题 `base.clone()` 后 `prompt()`，用完 `destroy()` 克隆；整批空闲时 `disposeBases()` 统一 `destroy()` 基准 session，避免长期占用 Chrome 并发槽位。业务层签名不变。
- **默认并发**：应用层单例 `chromeAI` 设 `concurrency:4 / timeoutMs:90_000 / retries:1`。
  （勘误：本条曾写"已纠正为 4/60s"，但该纠正**当时并未落到代码**——代码实际仍为 8/90s；2026-08-29 已真正统一为 4/90s，并抽成 `CHROME_AI_*` 常量，见顶部 2026-08-29 条目。）
- **验证**：`chrome.test.ts` 11 项、`chromeAgent.test.ts` 3 项（clone session 桩）同步更新通过；`npm run build`（`tsc -b` strict 严格）通过；全量 `npm run test` 364 passed。
- **真实计时（10 题，干净浏览器）**：clone + 并发 4 ≈ 250s 进入题目页。结论：**clone 只降低"每题 session 创建/解析"开销，但生成耗时主要由单题 prompt 延迟主导**，所以提速的真正杠杆是并发数。实测此前并发 8（无 clone）约 90s 反而更快——故 keep clone 的同时建议把并发提到 6~8（base+克隆 总数需 ≤ Chrome 实际并发上限，待真机验证）。见下方待办。
  （2026-08-29 复核：综合本机负载与稳定性，最终**定为 4** 而非 6~8，见顶部条目；若日后真机显示偏慢，改 `CHROME_AI_CONCURRENCY` 一处即可全局生效。）

## 2026-08-28 · 修复 Chrome 内置 AI 出题卡死（新增 ChromeAIExecutor，并发控制 + 超时 + 取消 + 重试 + 销毁）

- **动机**：训练页点「开始自定义训练」永久卡在"正在用 LLM 生成变体题目…"。根因是 Chrome 内置 AI 偶发让 `session.prompt()` 既不 resolve 也不 reject、且不响应 abort，僵尸 session 占满并发名额 → 后续 `create()` 全部挂起死锁（名额上限并非硬性 1，干净状态下并发 2 个 `create()` 均成功，是被残留僵尸占满所致）。
- **变更**：`src/ai/chrome.ts` 内置 `ChromeAIExecutor`，`chromeComplete` 改为委托该 executor；`create`/`clone` 与 `prompt` 均套回调式 `withTimeout`，`finally` 中 `session.destroy()` 释放名额，用 `AbortController` 取消，`runningTasks` Map 跟踪在途任务。（原独立 `chromeAI.ts` 已合并进 `chrome.ts`。）
- **配套**：`interviewEngine.finalizeQuestion` 变体校验失败时返回原题并 `console.warn`，避免单题坏数据中断整批组卷。
- **验证**：`chrome.test.ts` 11 项（含并发上限、超时拒绝、重试、不可用时直接报错、不支持时可读错误）、全量 `npm run test` 364 passed；手动在浏览器点「开始自定义训练」已能进入题目页（共 10 题）。
- **注意**：`vite.config.ts` 的 `hmr:false` 仅为本地代理调试临时改动，已还原。

## 2026-08-27 · 新增 AWS Certified Generative AI Developer - Professional 题域（AIP-C01，先入库 25 题，其余 98 题来源付费墙拦截）

- **动机**：用户要求从 examcademy.com 抓取 AWS Certified Generative AI Developer - Professional (AIP-C01) 题库。该考试共 123 题（5 页），免费页仅完整渲染第 1 页（25 题），第 2 页起为登录/PDF 付费墙，仅留空标题。先入库可公开获取的 25 题。
- **数据**：`src/data/questions/aws-genai-developer-pro.json`（25 道，其中 Q2/Q9/Q21 为“Choose two”多选，其余单选；均带 choice + open 双形态与「单选 / 请选择以下 N 个正确选项」提示）；`category = aws-genai-developer-pro`。
- **知识节点**：`src/data/knowledge/aws-genai-developer-pro.json`（`id: aws-genai-developer-pro`，`area: ai-systems`）；`taxonomy.ts` 在 `ai-systems` 域下新增 topic `aws-genai-developer-pro` 并补 `ANGLE_WHITELIST`。
- **答案口径**：25 题均来自 examcademy 官方解析，覆盖 Bedrock 编排（Step Functions 顺序/Parallel）、智能提示路由、跨区域推理与数据驻留、Guardrails（block/mask/拒绝主题/接地）、知识库（分层切分/GraphRAG/来源归因）、RAG 语料处理（Comprehend 去 PII + 嵌入）、混合检索 + reranker、OpenSearch k-NN 语义缓存、MCP（Streamable HTTP + Cognito）、Bedrock Flows、模型评估作业（RWK/BERTScore）与 CI/CD 门禁、可观测性（Application Insights/复合告警）、金丝雀部署。无存疑项。
- **反泄题**：`lint:bias` 初报 7 道 strong（Q6/Q7/Q9/Q15/Q16/Q22/Q24 正确项明显最长），已缩短正确项使 gap < 1.8，复跑 strong=0。
- **验证**：`validate:questions` 599 题通过；`typecheck` + 全量测试通过。
- **待办**：剩余 98 题需用户提供可访问来源（登录导出 / PDF / 文本 dump）再补抓；examcademy 第 2–5 页为付费墙。

## 2026-08-27 · 新增 AWS Certified AI Practitioner 题域（先入库 10 题，其余 442 题来源付费墙拦截）

- **动机**：用户要求抓取 ExamTopics 的 AWS Certified AI Practitioner (AIF-C01) 题库入库。该考试共 452 题（46 页），免费用户仅放行第 1 页（10 题），第 2 页起同前例返回付费墙/验证码。先入库可公开获取的 10 题。
- **数据**：`src/data/questions/aws-ai-practitioner.json`（10 道单选，含 choice + open 双形态，已带「单选」提示）；`category = aws-ai-practitioner`。
- **知识节点**：`src/data/knowledge/aws-ai-practitioner.json`（`id: aws-ai-practitioner`，`area: ai-systems`）；`taxonomy.ts` 在 `ai-systems` 域下新增 topic `aws-ai-practitioner` 并补 `ANGLE_WHITELIST`。
- **答案口径**：10 题均属 AWS AI 从业者基础（可解释性 PDP / SageMaker 异步推理 / Bedrock 加密权限 / 迁移学习 / 边缘 SLM / Ground Truth Plus 等），与 AWS 官方指引一致，无存疑项。其中 Q6（大 payload+长时处理+近实时→异步推理）为 AWS 特定事实，已按官方选型确认。
- **反泄题**：`lint:bias` 初报 4 道 strong（Q1/Q7/Q8/Q9 正确项明显最长），已分别缩短正确项或补齐最短干扰项使 gap < 1.8，复跑 strong=0。
- **验证**：`validate:questions` 574 题通过；`typecheck` + 全量测试 355 passed。
- **待办**：剩余 442 题需用户提供可访问来源（登录导出 / PDF / 文本 dump）再补抓。

## 2026-08-27 · 新增 Google Generative AI Leader 题域（先入库 10 题，其余 65 题来源付费墙拦截）

- **动机**：用户要求抓取 ExamTopics 的 Google Generative AI Leader 题库入库。该考试共 75 题（8 页），但 ExamTopics 对免费用户仅放行第 1 页（10 题），第 2 页起同样返回付费墙/验证码（同 CCA-F 情形）。先入库可公开获取的 10 题。
- **数据**：`src/data/questions/google-genai-leader.json`（10 道单选，含 choice + open 双形态，已带「单选」提示）；`category = google-genai-leader`。
- **知识节点**：`src/data/knowledge/google-genai-leader.json`（`id: google-genai-leader`，`area: llm`）；`taxonomy.ts` 在 `llm` 域下新增 topic `google-genai-leader` 并补 `ANGLE_WHITELIST`。
- **答案口径**：10 题均为 GenAI 基础定义/范式（生成式 AI、Agent、监督/无监督/强化、Gemini 边界、幻觉、扩散模型、训练数据安全），与权威定义一致，无存疑项。
- **反泄题**：`lint:bias` 初报 1 道 strong（Q9 正确项最长、最短干扰项 D），已扩充 D 使 gap < 1.8，复跑 strong=0。
- **验证**：`validate:questions` 564 题通过；`typecheck` + 全量测试 355 passed。
- **待办**：剩余 65 题需用户提供可访问来源（登录导出 / PDF / 文本 dump）再补抓。

## 2026-08-27 · 新增「前沿 LLM / Agent 架构」题域（6 题）

- **动机**：用户手搓 6 道高价值面试选择题（混合 Recurrent-Attention / Preserved Thinking KV 复用 / Reasoning Effort 非线性影响 / MTP / YaRN RoPE 外推 / 思考-指令模式采样参数），入库为独立文件。
- **数据**：`src/data/questions/llm-architecture-advanced.json`（6 题，3 道多选带「请选择以下 N 个正确选项」提示、3 道单选带「单选」提示，含 choice + open 双形态）；`category = llm-architecture-advanced`。
- **topic 映射**：复用现有知识节点 id，未新增 taxonomy——Q1→`hybrid-attention`、Q2→`kv-cache`、Q3/Q6→`sampling`、Q4→`transformer`（MTP 属 Transformer 预训练架构）、Q5→`rope`。注意 `training-objective` 仅是 `transformer` 节点的子 concept，非节点 id，故 Q4 落 `transformer`。
- **答案核对**：用户所给参考答案（A,B,D / A,B,C / A / A,B,C / A,B,C / A）均与第一性原理一致，无存疑项。
- **验证**：`validate:questions` 554 题通过；`lint:bias` strong=0；`typecheck` + 全量测试 355 passed。

## 2026-08-27 · 新增 Anthropic CCA-F 题域（先入库 10 题，其余 124 题来源付费墙拦截）

- **动机**：用户要求抓取 ExamTopics 的 Anthropic CCA-F 题库入库。该考试共 134 题（14 页），但 ExamTopics 对免费用户仅放行第 1 页（10 题），第 2 页起返回「You've Reached Your Free CCA-F Exam Questions Limit / Enter Captcha」——WebFetch 与 curl 均无法越过（题目为 JS 渲染 + 验证码/付费 Contributor Access）。故先入库可公开获取的 10 题。
- **数据**：`src/data/questions/anthropic-cca-f.json`（10 道单选择，含 choice + open 双形态，已带「单选」提示）；`category = anthropic-cca-f`。
- **答案口径**：ExamTopics 的「Correct Answer」为社区投票，已结合 Anthropic 官方多代理最佳实践逐题核对——10 题标记答案全部与官方协调器/子代理编排建议一致，无存疑项。
- **知识节点**：`src/data/knowledge/anthropic-cca.json`（`id: anthropic-cca`，`area: agent-engineering`）；`taxonomy.ts` 在 `agent-engineering` 下新增 topic `anthropic-cca` 并补 `ANGLE_WHITELIST`，使 `topic` 映射到节点且 domain/topic 自洽。
- **反泄题**：`lint:bias` 初报 2 道 strong 长度偏差，已分别扩充最短干扰项（Q2-A、Q3-C）使 gap < 1.8，复跑 strong=0。
- **验证**：`validate:questions` 548 题通过；`typecheck` + 全量测试 352 passed。
- **待办**：剩余 124 题需用户提供可访问的来源（登录后导出 / PDF / 文本 dump），再补抓入库。

## 2026-08-27 · 新增「模型性能优化（CUDA / Kernel）」题域（6 题）

- **动机**：补充 PyTorch 模型性能剖析与优化面试题（Tensor View 元数据 / GEMM Epilogue 融合 / torch.compile 边界 / Pointwise 融合 / Profiler 内核命名 / JIT vs 手写内核权衡）。用户手搓高质量 6 题，入库为独立文件。
- **数据**：新增 `src/data/questions/pytorch-perf.json`（6 道选择题，single/multiple 混排，含 choice + open 双形态，多选题已带「请选择以下 N 个正确选项」提示）；`category` = 文件名 slug `pytorch-perf`。
- **知识节点**：新增 `src/data/knowledge/pytorch-performance.json`（`id: pytorch-performance`，`area: ai-systems`），题目的 `topic` 映射到该节点 id。
- **Taxonomy**：在 `ai-systems` 域下新增 topic `model-performance`（标签「模型性能优化（CUDA / Kernel）」）并补 `ANGLE_WHITELIST`，使节点 domain/topic 自洽；否则 `taxonomy.test` / `bank.test` 的孤儿漂移校验不通过。
- **验证**：`validate:questions` 538 题通过；`lint:bias` strong=0；`typecheck` 与全量测试 351 passed。

## 2026-08-27 · 全局消除异步提交重入（防反复点击）

- **动机**：Agent 面试提交后在 LLM 响应前按钮仍可点，触发 `pi-agent-core` 的 `submitAnswer` 重入守卫抛 "Agent is already processing"。排查发现主训练流程与 Copilot 存在同类窗口：仅依赖 `setBusy`/`setLoading` 这类 state（在 re-render 后才禁用按钮），同 tick 内的快速双击仍可重复触发 `await`。
- **做法**（与 Agent 修复同思路——同步 ref 守卫 + 立即置忙）：
  - `App.tsx` 新增共享 `actionLock = useRef(false)`；`handleStart` / `handleAdaptiveNext` / `handleFinishEarly` / `doSubmit` 均改为「进入即 `if (actionLock.current) return; actionLock.current = true;` … `finally { actionLock.current = false }`」。其中 `doSubmit` 此前**完全没有**防重入（重复点击会重复 `evaluateSession` + `saveLearner`），现已补上并增加 `setBusy('正在评分并提交…')`。
  - 非自适应两个提交按钮加 `disabled={busy != null}` 给出可见反馈（自适应逐题按钮本就 `disabled={evaluating}`）。
  - `CopilotSidebar.handleSend` 增加 `loadingRef` 同步守卫，避免同 tick 双回车重复发消息。
- **验证**：`typecheck` 无错、全量测试 351 passed。

## 2026-08-27 · 批量消除历史选择题「选项长度泄题」（244 道 strong 偏差清零）

- **动机**：`lint:bias` 显示 strong 档长度泄题高达 244/532 选择题（正确项天然最长 + 干扰项过短）。用户要求根治而非仅诊断。
- **做法**：以大模型直接改写这 244 道题的 `formats.choice.options`——保持 `answer` 索引、正确项语义、题干/解析/标签全部不变，仅扩充偏短干扰项的合理但错误细节，使最长/最短比值 < 1.8 且正确项不再是唯一最长者。按文件分 8 批并行改写（26 个题文件）。
- **验证**：改写后重跑 `lint:bias --json` 返回 `[]`（全库 0 道 strong 偏差）；26 个题目文件 `JSON.parse` 全部有效；与 `git HEAD` 对比题目总数 532=532、答案索引无越界、选项数无变动。全量测试无回归。
- 说明：本次为数据层根治；生成期的 anti-cueing 重试（见下条）继续防止新变体引入偏差。

## 2026-08-27 · 前端接入路由（HashRouter）

- **动机**：所有页面共用 `http://localhost:5173/`，地址栏无法区分当前页面。引入客户端路由，让导航与 URL 一一对应，刷新/分享可直达。
- **main.tsx**：用 `HashRouter` 包裹 `<App/>`——local-first 工具零配置，刷新或静态部署都不会 404（无需 server SPA fallback）。
- **App.tsx**：移除 `page` 的 `useState`，改为由 `useLocation().pathname` 经 `pageFromPath()` 派生；所有 `setPage(...)` 改为 `goPage(p)`（内部 `navigate(p==='train' ? '/train' : '/' + p)`）。导航 5 项映射 `/train`、`/progress`、`/interview`、`/agent`、`/settings`；根路径 `/` 重定向到 `/train`。
- 训练流程的 `phase`（home/quiz/result）仍保留内存 state，不进 URL（刷新会丢失 session，与现状一致；`/train` 承载训练全流程）。
- 依赖：`react-router-dom` 新装。验证：`typecheck` 无错、全量测试 349 passed、`vite build` 通过。

## 2026-08-27 · 落库用户作答（选项索引 / 开放题文本）+ 回放展示"你当时选了什么"

- **动机**：上一步回放只能看"出了什么题"，用户想要"我当初选了啥"以便后续分析（如错选分布）。
- **`SessionRecord` 新增可选 `answers: Record<questionId, AnswerValue>`**（`sessionAnswerSchema`，选择题=索引数组、开放/编程=文本）：`src/schemas/learner.ts`。非索引、optional，旧记录兼容、Dexie 无需升版本。
- **`sessionFromQuiz` 增加 `answers?` 参数**并写入记录；两处调用方补齐：主流程 `App.doSubmit` 传 `answersRef.current`，Agent 流程 `sessionRecordFromAgent` 传 `session.answers`。
- **`SessionReplayDrawer` 增加"你的选择 / 你的回答"**：选择题显示所选字母、开放题显示作答文本（未作答显"未作答"），与"正确答案"并列。
- `domain/learner.test.ts` 新增"作答随记录落库"断言；`typecheck`/`build`/`test` 全绿（351 passed）。

## 2026-08-27 · 历史会话回放 UI（读历史题库快照）

- **动机**：上一步已把当次原题（含 AI 变体）快照存入 `SessionRecord.questions`；现补上回放界面，让历史会话可原样查看。
- **新增 `components/progress/SessionReplayDrawer.tsx`**：只读 Drawer，按 `record.questions` 渲染每题（选择题标出正确项与正确答案、开放题给参考答案）+ 该题得分/对错（取自 `questionResults`）。无快照的旧记录显示提示。
- **接入 `ProgressPage`「最近趋势」**：前 5 条会话改为可点击，打开上述 Drawer。面试与 agent 会话均覆盖（共用 `sessionFromQuiz` 落库路径）。
- 仅回放"出了什么题"，未落库用户作答（作答选择未持久化），故不显示"你的答案"。`typecheck`/`build`/`test` 全绿。

## 2026-08-27 · 会话落库增加完整原题快照（含 AI 变体），支持历史复现

- **动机**：此前 `SessionRecord` 只存 `questionResults`（questionId/score/topic…），AI 变体的题干/选项/答案/解析属会话内临时态，关掉即丢，历史会话无法原样回看。
- **改动（最小方案）**：`sessionRecordSchema` 增加可选 `questions: SessionQuestion[]`；`domain/learner.sessionFromQuiz` 落库时把当次 `session.questions`（含变体）一并写入。面试与 agent 会话均走此构造器，故一处覆盖。
- **兼容**：字段为 optional，旧记录无 `questions` 仍能解析；非索引字段，Dexie 无需升版本。聚合层（topicStats/angleCoverage）只读 `questionResults`，不受快照影响。
- 单纯落库，未做回放 UI；需要时历史详情页直接读 `record.questions` 即可原样复现。`domain/learner.test.ts` 新增快照保留断言，全量测试 350 passed、`typecheck` 无错。

## 2026-08-27 · 变体生成抗长度泄题（anti-cueing 自愈）+ 题库长度偏差 lint

- **动机**：手工修题发现部分选择题存在"正确项明显更长 / 干扰项过短"的长度暗示偏差。用户希望 AI 生成变体或抽题时自动规避，而非逐题手修。
- **两层方案**：
  - **Prompt 层（生成期防偏差）**：`ai/variant.ts` 的 `VARIANT_SYSTEM` 增加「选项设计约束」——各选项篇幅与细节均衡、禁止用长度暗示答案；生成后自检。
  - **Traditional 启发式 + 自愈**：新增纯函数 `domain/bias.detectOptionLengthBias(options, answer)`，命中高置信长度泄题（正确项全局最长且存在明显过短干扰项，`maxCorrect/minDistractor ≥ 1.8`）时，`generateVariant` 用修正提示词**一次性重试**改写选项（ADR-036 语义：仅重生成，不因此抛错回退原题）。
  - **诊断工具**：新增 `scripts/lint-bias.ts` + `npm run lint:bias`（默认仅 strong 且摘要前 10 条，`--all/--soft/--json` 可展开）。刻意不并入 `validate:questions`——历史题中长度偏差曾普遍（约 244/532 选择题），已于 2026-08-27 批量改写清零；保留 lint 作为新题/变体的回归探针而非阻断。
- `domain/bias.test.ts` 覆盖 strong/soft/none/无干扰项/长干扰项不误报；`ai/variant.test.ts` 覆盖长度泄题触发一次性重试。全量测试 349 passed、`typecheck` 无错。

## 2026-08-27 · 进度页新增「知识点清单」Tab（学过的 / 没学过的逐项表格）

- **动机**：用户希望看清"针对当前知识体系，自己学过和没学过的分别有哪些"。原进度页只有按域聚合的覆盖进度条，没有逐项清单。
- **components/progress/ProgressPage.tsx**：重构为 `Tabs`（进度概览 / 知识点清单）。清单 Tab 将全量 `knowledgeNodes`（67 个知识点，含域/主题/优先级/摘要）与 `profile.topicStats` 对齐，逐节点标注「已学 / 未学 / 薄弱 / 掌握度 / 均分」。
- 状态判定：节点所属主题在 `topicStats` 有作答记录（`attempts>0`）即记「已学」；掌握度沿用 `WEAK_MASTERY=0.85`/`WEAK_AVG=85`。清单 Tab 不受"无训练记录"早退限制——新用户也能看到全量 67 个未学知识点。
- 顶部 `Segmented`（全部/已学/未学，带计数）+ 域 `Select` 筛选；默认排序"未学优先 → P0 优先 → 域 → 名称"，让待学重点浮到顶部；表格分页 15/页。
- 未新增路由/页面文件，改动收敛于 ProgressPage 单文件；`typecheck` 无错、全量测试 348 passed。

## 2026-08-27 · 设置页新增「重置学习数据」按钮

- **动机**：Agent 面试读取跨模式共享、持久化在 IndexedDB 的 `LearnerProfile`（`recommendWeakTopics` 仅返回 `attempts>0` 的主题）。开发/测试期残留画像会让"首次使用"也固定显示历史薄弱项（如遗留 topic id `open-advanced`），用户无法自行回到干净起点。
- **storage/learner.ts**：新增 `resetLearnerData()`，事务清空 `learner`+`sessions` 两表，回到 `emptyProfile`。
- **components/settings/SettingsPanel.tsx**：新增「学习数据」区块，`Popconfirm` 二次确认的 danger 按钮「重置学习数据」，确认后清空 DB 并回调 `onResetLearner`。
- **App.tsx**：`SettingsPanel` 接 `onResetLearner={() => setProfile(emptyProfile())}` 同步内存画像。
- **storage/learner.test.ts**：新增 `resetLearnerData` 单测（清空后 `loadLearner()` 回到 `emptyProfile`）。
- 342 测试全过，`typecheck` 无错。

## 2026-08-26 · Copilot 错误可追溯化（结构化日志 + errorLog 持久表）

- **问题**：Copilot 调用失败只显示「⚠️ 模型未返回文本」，真实失败原因（pi-ai 把传输/鉴权错误吞成 `stopReason='error'`、推理模型只回 thinking 等）被掩盖，无法回溯。
- **storage/db.ts**：新增 `errorLog` 诊断表（Dexie `version(2)`，`++id, scope, createdAt` 索引），与 `LearnerProfile`/`sessions` 业务数据隔离；新增 `recordErrorLog(scope, message, detail)`（fire-and-forget，持久化失败静默）。不改动既有表结构。
- **components/copilot/CopilotSidebar.tsx**：`chatCopilot` 在每条失败路径（无可用引擎 / Chrome 不支持 / 未找到模型 / `stopReason='error'` / 仅返回 thinking / 无文本）前调用 `logCopilotFailure`，向控制台打印并写入 `errorLog` 结构化上下文（provider、model、hasApiKey、systemLen、promptLen、historyLen、stopReason、errorMessage、blockTypes 等）；`handleSend` 捕获处补 `console.error`。
- **文档**：ARCHITECTURE.md `storage/db.ts` 段补 errorLog 表说明。

## 2026-08-26 · 文档与代码一致性修复（架构评审 P0）

- **背景**：架构评审发现 ARCHITECTURE.md / README 与代码严重脱节——文档仍停留在「pi-agent-core 已移除、无 Agent 依赖」的旧形态，而 `src/agent/`（ADR-034）已落地并作为第五页功能上线；题库描述写「6 域一文件 / 409 题」，实际是 28 个 topic 文件 / 520 题。以代码为准修正文档。
- **ARCHITECTURE.md**：①总体形态改为五页 SPA + Agent 面试页由 pi-agent-core 驱动（并行运行时，ADR-034）；②分层树新增 `agent/` 目录职责说明；③依赖方向补充 `components/agent → agent → domain + ai + types`；④`data/questions/` 段重写为实际形态（28 topic 文件 / 520 题 / category=topic slug / 514 双形态 + 6 纯选择 + 180 场景题干；6 域为 taxonomy 逻辑分组）；⑤知识节点数修正为 74；⑥`data/courses/` 标注目录尚未创建（ADR-041 前瞻）；⑦「LLM 能力边界」一节删除「interviewAgent.ts 已删除」等过时表述，补 Agent 边界与调用形态对比；⑧技术栈注意点更新 pi-agent-core 条目。
- **README.md**：类别数「7 类别」→ 实际形态；扩展题库指引改为 topic 维度（taxonomy.ts 登记）；示例 JSON 的 category 注释与 angle 十角度词表同步。
- **DECISIONS.md**：ADR-039 标注「部分被后续演进取代」（7→6 域文件重组未以该形态留存，实际演进为 28 topic 文件）；ADR-041 补 courses 目录未创建的更正注记。

## 2026-08-24 · 变体生成语义不变量重构（ADR-036，取代 ADR-019 变体约束，无兜底）

- **契约**：`src/types.ts` 新增 `VariantCandidate`，`GeneratedVariant` 扩展为 `{question, options?, answer?, explanation?}`；`src/ai/variant.ts` 重写 `VARIANT_SYSTEM/user`，注入 `Knowledge Contract`（topic/tags/requiredConcepts/difficulty/format）+ 完整原题，LLM 可重构题干/场景/选项/distractors/解析。
- **校验**：`src/domain/variant.ts` 从“题干非空”升级为结构（选项≥2无重复、answer 合法且与 single/multiple 一致、至少一干扰项、自包含）+ 语义（required 浅覆盖），失败直接抛错；`applyVariant` 按 choice/open 分支替换 `options/answer`。
- **引擎**：`src/application/interviewEngine.ts:finalizeQuestion` 移除 `try/catch` 回退，无 provider 时仍返回原题，有 provider 时校验失败即让 `buildSession` 失败（用户显式要求“不需要兜底”）。
- **文档**：`docs/DECISIONS.md` 新增 ADR-036，`docs/ARCHITECTURE.md` “LLM 变体安全”小节重写为 Invariant/Variant 分层图；`typecheck/build` 通过。

## 2026-08-24 · Zod 类型单源收口 + InterviewDefinition 边界校验（ADR-033 收口）

- **类型单源**：`src/types.ts` 删除全部手写 `interface Question / KnowledgeNode / ProviderEntry / AIConfig / EvaluationResult / LearnerProfile ...`，改为 `export type X = z.infer<typeof xSchema>` re-export 自 `schemas/*`（`Difficulty/ProviderId/FormatId/...` 亦自 `schemas/common` 推导）；`ChoiceFormat/OpenFormat` 改为 `NonNullable<Question['formats'][...]>` 保持与 schema 同步；`types.ts` 仅保留行为契约 `LLMProvider/CompleteFn/QuestionBank/QuestionBlueprint` 等。
- **边界校验**：`application/interviewEngine.ts:32 assertValidDefinition` 新增 `interviewDefinitionSchema.safeParse` + `formatSchemaErrorMessage`，`buildSession` 入口即校验（`count/ title/ scoringRubric` 等形状），失败早抛；`types` 收口后 `typecheck/build` 仍通过，无调用方需改。
- 238 测试全过，`typecheck`/`build` 通过。

## 2026-08-24 · Zod 边界层收口：持久化版本化 + Monaco JSON Schema（ADR-033 Phase 5-6）

- **持久化**：新增 `schemas/learner.ts`（`topicStats`/`questionResult`/`sessionRecord`/`learnerProfile`）与 `schemas/session.ts`（`sessionQuestion`/`interviewSession`），`persistedLearnerSchema = { version: literal(1), data: learnerProfile }` 版本化包装；`storage/learner.ts` 的 `loadLearner` 兼容旧直接存储与新版本化写入，`saveLearner` 一律写入 `version:1`，Zod 形状校验后回退空画像（localStorage 为不可信边界）。新增 `schemas/learner.test.ts` 9 例（含新/旧形态兼容与非法回退）。
- **Monaco**：新增 `schemas/jsonSchema.ts`（`z.toJSONSchema(aiConfigSchema, {target:'draft-7'})` 单一来源派生），`components/settings/SettingsPanel.tsx` 挂载 `monaco.languages.json.jsonDefaults.setDiagnosticsOptions` 注入 AIConfig JSON Schema（枚举提示/hover/实时校验）；后续可复用为 LLM structured output。
- **统一边界**：`schemas/errors.ts` 的 bracket 记法与 `questionBank/knowledgeMap/conceptGraph/settings/evaluate` 的校验路径已统一；`schemas/index.ts` 导出完整契约集（common/question/knowledge/conceptGraph/ai-config/evaluation/interview/learner/session）。
- 238 测试全过，`typecheck`/`build` 通过。

## 2026-08-24 · 引入 Zod 4 边界校验层：分阶段接管形状校验（ADR-033 Phase 1-4）

- **新增依赖**：`zod@4.4.3`（与 `@earendil-works/pi-ai` 共享，去重），`strict: true` 已满足官方要求；`src/schemas/` 为新增契约层（`common`/`question`/`knowledge`/`conceptGraph`/`ai-config`/`evaluation`/`interview`/`errors`/`index`），`data/` 不放 schema。
- **职责切分落地**：`Zod 负责形状`（类型/枚举/必填/数组长度），`domain 负责 invariants`（单选题索引合法性、topic 支撑、前置 DAG、provider 去重与完整性等）。`formatSchemaError` 统一 `path → message`（`providers[0].id` bracket 记法）。
- **接管边界**：
  - `data/questionBank.ts` / `data/knowledgeMap.ts` / `domain/conceptGraph.ts`：eager 合并后逐条 `safeParse`，失败抛错定位到 `文件[下标]`（315 题 / 64 节点 / 118 边全量通过）。
  - `storage/settings.ts`：`parseConfigJSON` 先走 `aiConfigSchema.safeParse`（形状），再走去重/`isEntryValid`/`至少一可用`等不变量；`generateOpenQuestions` 非 `true` 视为 `false` 的清洗语义不变（对字符串等非法值容错）。
  - `ai/evaluate.ts`：`parseEvaluation` 在 `extractJSON` 后走 `llmEvaluationRawSchema.safeParse`，再 `clamp + aggregateOverall`（`overall` 仍由 domain 聚合）。
- **测试**：新增 `src/schemas/*.test.ts`（question 13 例 / knowledge 6 例 / conceptGraph 4 例 / evaluation 6 例 / ai-config 6 例，覆盖正/反/边界）；存量 `data/bank.test.ts` 的业务不变量校验保留；本变更涉及 `settings.test.ts` 对 `generateOpenQuestions` 非法值与 `providers[0].id` 定位的回归均通过。
- **文档**：`ARCHITECTURE.md` 新增分层 `schemas/` 与「数据契约与运行时校验」小节及依赖方向说明；`DECISIONS.md` 新增 ADR-033（分阶段迁移、目录、职责切分、演进路径）；本条 CHANGELOG。
- 229 测试全过，`typecheck`/`build` 通过。

## 2026-08-24 · Taxonomy 收敛：knowledge 七领域 + questions 八类目（数据契约变更）

- **knowledge/ 8→7**：`transformer.json` 与 `moe.json` 并入 `llm-architecture.json`
  （架构类知识点同属一棵树）；`rag-agent.json` 拆为 `rag.json`（检索/grounding 域）
  与 `agentic-ai.json`（自主决策/tool use/loop 域）——RAG 与 Agent 是不同知识树，
  不应共用一个文件。节点 id（= topic slug）不变，题目/Learner Memory/conceptGraph
  的 join key 零迁移。
- **questions/ 11→8**：`statistics.json`（4 题）并入 `machine-learning.json` 并改写
  category（gradient-descent 等 P0 节点的唯一题目支撑随之保留）；`nlp.json` 与
  `computer-vision.json` 移出题库——产品定位为 AI/LLM/Agent Engineer 面试，传统
  NLP/CV 为 optional domain，内容留存于 git 历史。categories.ts 同步删除三个 slug。
- **ai-engineering 保持不拆**：题量大（96 题、35 topic）是定位使然；边界靠
  "category 主领域 / topic 具体考点 / tags 交叉领域" 三层约束，掌握度本就按
  topic 统计，category 只承担展示分组与组卷过滤。
- **ai-fundamentals 退役（同日追加）**：68 题中 50 题按知识域迁入 `llm`、13 题
  （rag/reranking/vector-db/evaluation/model-selection）迁入 `ai-engineering`
  （RAG 实现属 AI Engineering 边界），5 个游离题归入最近类目后删除该文件——
  它是 taxonomy 收敛前遗留的杂烩桶，topic 与 llm/training 域高度重叠。
  questions/ 最终 **7 类目**：llm(83) / agentic-ai(82) / ai-engineering(109) /
  deep-learning(18) / machine-learning(10) / safety-ethics(9) / mlops(3)。
- **数据契约说明**：对外题库 JSON 的 category 枚举收敛（nlp / computer-vision /
  statistics / ai-fundamentals 不再出现），已发布题库的消费方需同步；localStorage
  学习档案按 topic 记账，不受影响。
- 195 测试全过，build 通过；覆盖矩阵缺口 33、未挂靠题 87→83（随 nlp/cv 游离
  topic 移出）。

## 2026-08-23 · 蓝图层落地：缺口 → QuestionBlueprint → 变体候选 / 成题校验（管线 ③）

- **QuestionBlueprint 类型**（types.ts）：topic × angle × difficulty × format +
  purpose（考察目的一句话）+ expectedConcepts（评分要点候选）。把 LLM/作者的
  任务从"自己决定考什么"收窄为"按蓝图写题"。
- **domain/blueprint.ts 纯函数**：`blueprintFromSuggestion`（缺口格→蓝图，
  purpose 来自角度模板，expectedConcepts 取知识节点 required；游离 topic 返回
  null 不进管线）；`variantCandidates`（同主题近角度题作变体基底，按角度梯度
  距离升序——落实 复用>变体>生成 的"变体"步）；`validateAgainstBlueprint`
  （成题一致性静态校验：topic/angle/difficulty/形态，内容质量留给后续 Validator）。
- **CLI**：`npm run question:blueprint -- N` 输出前 N 个缺口的蓝图 JSON（附变体
  候选 id），作为人工出题或受约束生成的结构化输入。
- **踩坑**：Node 原生 TS 直跑要求所有运行时导入带 .ts 扩展名——domain 内模块
  互相导入也必须写 `./coverage.ts`（tsc 靠 allowImportingTsExtensions 放行），
  已记入 ARCHITECTURE 技术栈注意点。
- 195 测试全过（新增 blueprint 单测 10 例），build 通过。

## 2026-08-23 · 存量题库 angle 全量打标：覆盖矩阵产出真实缺口清单

- **打标**：248 题全部补上 `angle`（逐题人工判定，按 types.ts 梯度定义：
  definition 是什么 / mechanism 为什么 / calculation 算得清 / tradeoff 权衡 /
  scenario 工程情境 / system-design 系统设计；"请实现 X"→calculation，
  "线上问题排查"→scenario，"A vs B 选型"→tradeoff）。数据完整性测试新增
  angle 白名单校验。
- **矩阵结果**：期望格 131 · 覆盖 69 · **缺口 62**（P0 49 + P1 13）——这是
  下一步补题的执行清单（`npm run question:coverage` 随时可查）；未标注题归零。
- **游离题决策**：79 题 topic 未挂靠知识图谱（老 CV/NLP/经典 ML 与 ADR-029
  之前的 agentic topic）。决策：**不为存量游离 topic 自动扩图**——它们运行时
  照常可用，后续按 Derived Knowledge candidate 流程（训练信号暴露需求 →
  人工确认）逐个挂靠或划出范围（ADR-032 补充）。
- 文档：ARCHITECTURE 数据契约描述同步。185 测试全过，build 通过。

## 2026-08-23 · 题库覆盖矩阵 + question:coverage CLI（ADR-032）

- **覆盖矩阵**：`domain/coverage.ts` 纯函数——topic × angle 计数矩阵、补题建议
  （P0 优先 + 角度梯度序 + 难度/形态启发式）、文本报告格式化；题目/知识点由
  调用方注入，浏览器与 CLI 共用同一实现。
- **数据契约增量**：Question 新增可选 `angle` 字段（主考察角度，六值白名单），
  向后兼容读取；未标注题单列 untagged，不与缺口混淆。当前真实题库：237 题中
  169 题未标注、79 题 topic 未挂靠知识点（老 CV/NLP/ML 题与 ADR-029 之前的
  agentic topic）——下一步先打标与挂靠，再谈补题。
- **CLI**：`npm run question:coverage`（scripts/question-coverage.ts）fs 直读
  data JSON 调纯函数，Node 24 原生 TS 运行，不走 Vite 打包路径；相对导入带
  .ts 扩展名（allowImportingTsExtensions）。scripts/ 纳入 tsconfig.node.json
  类型检查，显式固定 @types/node devDependency。
- **文档**：README 扩展题库小节说明 angle 标注；ARCHITECTURE 目录树与技术栈
  注意点同步；DECISIONS 新增 ADR-032（两速分离：慢速生产 / 快速运行时，
  复用 > 变体 > 生成的补题顺序）。184 测试全过，typecheck/build 通过。

## 2026-08-23 · 新增全局配置 `generateOpenQuestions`（默认关闭，ADR-031）

- **配置项**：`AIConfig` 新增布尔字段 `generateOpenQuestions`，默认 **false**——
  不生成开放题；设置页 config.json 中改为 true 可恢复开放题（组卷配额 ≈30%）。
- **门控收口**：interviewEngine 新增 `effectiveFormats` 单点实现——关闭时从允许
  形态剔除 open：纯开放题不入池、双形态题一律出选择、自适应模式随机开放分配
  恒为 choice；定义只选 open 时退化为 choice 而非空会话。
- **清洗语义**：loadConfig / parseConfigJSON 对缺省或非法值一律按 false 处理，
  历史 localStorage 配置无需迁移即获得新默认行为。
- **文档**：SettingsPanel 提示文案与 docs/config.example.json 字段说明同步；
  测试新增 settings 清洗用例与引擎门控用例（含自适应模式）。175 测试全过，
  typecheck/build 通过。

## 2026-08-23 · 边界收紧：概念层级统一 + 图/学习状态分离 + mastery 语义修正（ADR-030）

- **概念层级统一**：Knowledge（学习对象，一等公民）→ Question（知识点的
  assessment view）→ SessionQuestion（一次训练实例）。types.ts 注释全面改用
  该术语；后续 explanation/flashcard/follow-up 等都是 knowledge 的其他 view。
- **conceptGraph 只管关系**：WEAK_* 阈值、isMastered/isAttempted、
  expandWithPrerequisites、TopicRef/collectTopicRefs 从 conceptGraph.ts 迁入
  learner.ts——图回答"知识间是什么关系"，learner 回答"用户掌握得怎么样"；
  graphlib 数据结构不外泄。App.tsx / 测试导入同步更新（掌握策略测试移入
  learner.test.ts，conceptGraph.test.ts 回归纯图测试并补 topoRankOf 用例）。
- **mastery 明确为启发式**：avgScore/100 不再表述为掌握度定义；语义分工
  mastery=当前启发式 / trend=近期信号 / attempts=置信度 / evidence=溯源，
  不升级 Bayesian/ELO/IRT。
- **固化不变量**：SessionQuestion 快照不变量（session 保存"当时看到的内容"）、
  LLMProvider 接口边界固定为 one-shot 语言增强（永不扩展推荐/规划类接口）、
  `useAI` 保持单开关。ARCHITECTURE.md 新增「核心数据流（主架构）」小节
  （题库→训练→评估→学习信号→推荐闭环 + 四条核心原则）。
- 167 测试全过，typecheck/build 通过。

## 2026-08-23 · 知识点层一等公民化：Knowledge Map 数据层（ADR-029）

- **数据层新增**：`data/knowledge/<area>.json` ×8 领域（深度学习基础 / Transformer /
  LLM 架构 / MoE / 训练与后训练 / 推理与服务 / RAG 与 Agent / AI 系统设计），
  64 个知识节点（P0×52），全部挂靠现有题目 topic——id 即 topic slug，
  与题库 / conceptGraph / Learner Memory 同一 join key。
- **节点 schema**：`{ id, name, area, priority, summary, required, misconceptions, angles }`。
  四类修饰素材编码"知识点 → 面试题"的组合策略：summary 做变体与复盘锚点；
  required 做评分必须要点；misconceptions 做干扰项/追问/gap 分析；
  angles 编码难度梯度（definition→mechanism→calculation→tradeoff→scenario→system-design）。
- **评分链路接线**：`mergeQuestionRubric` 在题目未自带 `rubric.required` 时回退到
  知识点节点的 required——所有开放题的评分提示从此都有知识点要点兜底。
- **覆盖分析**：`domain/knowledge.ts` 的 `knowledgeCoverage` 输出 P0 覆盖率与
  gap 路线图（当前 64 节点全部有题目支撑）。
- **测试**：新增 domain/knowledge.test.ts（结构合法性、无悬空节点、回退语义、
  覆盖统计）；provider.test.ts 更新回退用例。166 测试全过，typecheck/build 通过。
- **文档**：ARCHITECTURE.md 分层与评分 Rubric 小节同步；DECISIONS.md 新增 ADR-029
  （含后续路径：变体注入 misconceptions / 按 angles 配比选题 / 进度页按 area 聚合）。

## 2026-08-23 · 新增前沿架构推理题 6 题：机制/取舍/归因为主，模型知识仅作 context

- **出题原则延续**：架构事实写进题干（down/up projection、无位置编码、多层聚合等），
  候选人负责推导"为什么这么设计、对 serving 意味着什么"；干扰项全部做到
  "技术上听起来合理"，不再使用"完全消除""必然提升"类一眼假选项。
- **难度梯度（Knowledge → Mechanism → Trade-off → System reasoning）**：
  - `llm-15`（latent-moe）：LatentMoE 为何降本——压缩位置在专家线性层，
    参数/FLOPs 随 latent 维度缩放，省的不是路由；
  - `llm-16`（latent-moe）：latent 维度压得过低的后果——信息瓶颈、路由区分度下降、
    质量回退；明确 KV cache 不受影响、加专家补不回输入带宽；
  - `llm-17`（positional-encoding）：NoPE 推理题——隐式位置信号来自因果掩码不对称性，
    核心风险是顺序建模可靠性（尤其长度外推）；开放形态考"如何验证 NoPE 模型
    确实学到了 token order"（扰动实验/探针/长度外推），适配 MCQ→Open 转换机制；
  - `llm-18`（residual-connections）：mHC vs Attention Residuals 多选——同一问题
    （深层信号传递）、异结构（静态拓宽通路 vs 动态内容聚合）；含正确项
    "Attention Residuals 以额外计算换表达能力，不属于推理效率优化"；
  - `llm-19`（inference-optimization）：动机分类修正版——题干改为"首要设计目标不是
    inference efficiency"，四个选项只给机制描述不报答案（MLA/KDA/LatentMoE=效率，
    Attention Residuals=质量）；
  - `ai-eng-026`（system-design）：serving 归因尽调——MLA/LatentMoE/线性注意力是
    成本一阶变量，Attention Residuals 是质量投资的成本项，NoPE 近似中性但引入
    顺序建模风险。
- **conceptGraph**：新增 topic `latent-moe` / `positional-encoding` / `residual-connections`
  及 5 条边（moe→latent-moe 前置等）；157 测试全过，typecheck/build 通过。

## 2026-08-23 · 新增 LLM 推理架构推理链 5 题：从机制到 Agent 容量规划

- **出题原则**：模型名称只作 context、不作 prerequisite——题干给足架构事实
  （头数/层数/head_dim/精度），考察"能否推导设计与后果"，不考"是否读过某篇文章"。
- **题目链（机制 → 定量 → 取舍 → 系统 → 选型）**：
  - `llm-12`（gqa）：32 Query 头 / 2 KV 头为何缩小 16× KV cache——Query 头不进缓存公式；
  - `llm-13`（kv-cache）：定量计算单 token KV cache（2×48×2×128×2B ≈ 48 KiB）与
    10k token 会话总量，干扰项对应三类典型误算（漏 K/V 因子 / 误用 Query 头 / 误用精度）；
  - `llm-14`（hybrid-attention）：75% SWA + 25% 全局 GQA 的收益与代价
    （有界缓存 + 信息高速公路 vs 局部层看不远）；
  - `agentic-61`（inference-capacity）：Agent workload 下 KV 效率为何比 benchmark 重要
    （KV ∝ 上下文 × 并发），并显式考察"哪些瓶颈不会消失"（prefill 计算/权重带宽/质量）；
  - `ai-eng-025`（system-design）：Dense+GQA vs MoE vs 小模型 MHA 的五维选型权衡
    （MoE 省算力不省显存、MHA 缓存最大、SLO 反推资源预算）。
- **conceptGraph**：新增 topic `hybrid-attention` / `inference-capacity` 及 3 条 related 边，
  接入薄弱项推荐；157 测试全过，typecheck/build 通过。

## 2026-08-23 · 选择形态场景化升级：173 题换装情境题干 + 干扰项强化（ADR-028）

- **选择性改造（非全量）**：参考 AWS 认证考试风格样例，仅对适合场景化的题
  （工程决策/系统设计/安全合规/成本权衡/生产运维/故障排查）重写选择形态，
  共 173/237 题；概念定义、原理辨析、数学基础类题目保持原样。
- **数据模型扩展**：`ChoiceFormat` 新增可选 `question` 字段——选择形态专属场景题干
  （情境背景 + 约束条件 + 明确问句）。给出时 UI 用它提问，共享题干保持面向开放形态；
  未给则两形态共用。开放形态内容零改动。
- **选项质量**：4~5 个完整方案句，干扰项按「半对半错/常见误解/违反题干约束」设计；
  新增多选形态 44 道（原生成内容全部为单选）。
- bank.test.ts 校验 cf.question 非空；157 测试全过，typecheck/build 通过。


## 2026-08-23 · 题目与呈现形态分离：双形态进题库，删除运行时题型变换（ADR-027）

- **数据模型重构**：`Question` 收敛为单一知识对象 + `formats: {choice?, open?}`；
  新增 `SessionQuestion = { question, format }` 会话实例；`QuestionType` 四值枚举
  （single/multiple/essay/coding）删除，改为 `FormatId = 'choice' | 'open'`；
  `InterviewDefinition.questionTypes` → `formats`。
- **题库迁移**：237 题全部同时具备 choice/open 双形态——48 道原选择题的 open 形态
  由代码推导（正确项要点+解析）；189 道 essay/coding 的 choice 形态由并行 LLM 生成
  并经脚本校验注入（统一 single 型）。契约固化在 `src/data/bank.test.ts`。
- **运行时变换管线整体删除**：ai/transform.ts、storage/transformAudit.ts（含测试与
  localStorage key）、LLMProvider.transformQuestion、applyTransforms、transformedFrom
  字段。LLM 职责只剩变体重写题干与开放形态评分。
- **组卷简化**：planComposition 返回 SessionQuestion[]，配额 7:3 语义不变
  （超额翻转/换题/裁剪，缺额尾部翻转）；自适应模式双形态可用时 p(open)=0.3 随机分配。
- **UI 跟随**：TrainingHome 自定义训练改选呈现形态；QuestionCard 按 sq.format 渲染
  （radio/checkbox vs textarea/Monaco）；ResultPanel 按形态展示判分或 AI 反馈。
- 测试：157 例全过；typecheck/build 通过。


## 2026-08-23 · 云端引擎扩容：恢复 OpenRouter + 新增 Gemini / Cloudflare（ADR-026）

- **引擎白名单扩为六种**：`chrome | local | deepseek | openrouter | google | cloudflare-workers-ai`。
  pi.ts 恢复 openrouterProvider 装配并新增 google / cloudflareWorkersAI 装配，
  模型目录直接用 pi-ai 内置 catalog（应用零维护）。
- **Cloudflare 双字段凭证**：`ProviderEntry` 新增可选 `accountId`；CredentialStore
  经 credential.env 注入 `CLOUDFLARE_ACCOUNT_ID`。isEntryValid 对 cloudflare 要求
  model/apiKey/accountId 三者齐全；parseConfigJSON 错误提示相应区分。
- **示例配置补全**：docs/config.example.json 新增多云端降级链示例
  （Gemini → Cloudflare → OpenRouter → DeepSeek 停用占位）与 accountId 字段说明。
- 测试：settings/provider 用例更新（openrouter 从「已下线被丢弃」改为正常保留；
  新增 accountId 清洗、cloudflare 校验与新云端组链断言）。typecheck/build 通过。
  注：transformAudit 上限测试失败为本变更前已存在问题（MAX_RECORDS 改 300 未同步用例），与本变更无关。

## 2026-08-23 · 设置页改为 config.json 编辑器，引擎收敛为 chrome/local/deepseek（ADR-025）

- **引擎收敛**：`ProviderId` 从六种收敛为 `chrome | local | deepseek`；删除 OpenAI /
  Anthropic / OpenRouter 三家云端直连（CORS 受限、维护成本高）。pi.ts 删除对应
  provider 装配与导入；不做向后兼容——历史配置中的已下线 id 由 sanitizeEntry 静默丢弃。
- **设置交互重做**：SettingsPanel 从「添加引擎 → 逐卡片填表 → 排序」改为 Monaco JSON
  编辑器直接编辑完整 `AIConfig`（懒加载，不进主包）；「恢复默认」一键填模板；
  chrome 内置 AI 可用性状态保留展示。
- **校验收口**：新增纯函数 `storage/settings.parseConfigJSON`（id 白名单、同引擎去重、
  启用引擎字段完整性、至少一个可用引擎），错误定位到 `providers[i]`，整体拒绝不半保存；
  `stringifyConfig` 统一两空格缩进序列化。
- 文档同步：`docs/config.example.json` 示例与字段说明更新为三引擎形态。
- 测试：settings/provider/interviewEngine 用例改用 deepseek；新增 parseConfigJSON
  覆盖（合法链清洗、停用容忍、九类整体拒绝、错误信息定位、下线引擎丢弃）。
  typecheck/build 通过。

## 2026-08-23 · 题型变换可审计：溯源字段 + 持久化审计日志（ADR-024）

- **题目溯源**：`QuestionBase` 新增可选 `transformedFrom` 字段——变换成功的题目记录原题型，
  随会话流转，复盘时可识别"这题是换过形态的"（id 本就不变）。
- **审计日志（storage/transformAudit.ts）**：引擎每次变换尝试（成功与失败）都写入
  localStorage 新 key `ai-interview-trainer.transform-audit`
  （questionId/topic/from/target/result/provider/ok/error/at），append-only、上限 200 条；
  存储不可用或内容损坏时静默降级，不影响主流程。用途：审核 LLM 变换质量、统计成功率。
- 失败也记录：error 存错误消息摘要，配合 ok=false 可定位坏输出模式。
- 测试 154 例全过（+9：审计模块往返/裁剪/容错、引擎接线成败两路）；typecheck/build 通过。

## 2026-08-23 · 题型变换分工修订：内容交 LLM，结构交代码（ADR-024 二轮评审）

- **开放→选择改为 LLM 产出完整选择题**：prompt 携带题目与参考答案，LLM 直接给出
  题干、全部选项与正确项序号。废弃"代码切分参考答案合成正确项"的启发式
  （实测全库覆盖率 187/189，分号衔接的并列论点/有序步骤拆不可靠，且语义质量受限）。
- **代码保留结构完整性职责**：输出校验（题干非空、选项去重后 3-6 个、正确项存在且越界即抛错）、
  **洗牌后按文本匹配重算 answer 索引**（索引错位结构上不可能）、不合法回退原题、
  多选只得到 1 个正确项时降级单选。
- 选择→开放不变：prompt 只含题干与主题，referenceAnswer 由代码合成。
- 测试 145 例全过；typecheck/build 通过。

## 2026-08-23 · 题型变换安全边界收紧（ADR-024 评审修订）

- **选择→开放不再把 options 给 LLM**：prompt 只含题干与主题，LLM 根本不知道正确选项是什么
  （此前靠 prompt 指令"不要透露答案"，现在结构上就不可能泄漏）。
- **coding 目标不再被 essay 变换器冒充**：open→coding 未设计，`transformQuestionWith`
  收到 coding 直接原样返回并告警，未来单独实现。
- **字段卫生**：变换结果显式构造目标形态字段（不再 spread+Omit+cast），
  选择题形态不残留 referenceAnswer/language，开放题形态不残留 options/answer。
- 安全模型定位明确：**结构安全**（answer 不由 LLM 产生）而非**语义安全**
  （干扰项只做精确去重，语义上"其实也对"的干扰项无法排除——宁可转换失败回退原题）。
- 测试 145 例全过（+3：prompt 边界断言、coding no-op、字段卫生）；typecheck/build 通过。

## 2026-08-23 · 题型变换支持多选（开放 → single/multiple）

- **多选变换**：`transformToChoice` 支持目标 'multiple'——正确选项由代码从参考答案的
  多个成句片段提取（每句一个权威"正确说法"，取前 2-3 个），LLM 仍只出题干与干扰项；
  answer 为洗牌后全部正确项索引。参考答案句数不足 2 时自动回退单选。
- **组卷规划**：开放→选择的变换槽位按 `MULTIPLE_TRANSFORM_SHARE=0.35` 随机分配单/多选
  （domain/quiz.ts，rng 可注入）。判分/作答 UI 原生支持 multiple，无需改动。
- 测试 142 例全过（+2：多选 answer 对齐、句数不足回退）；typecheck/build 通过。

## 2026-08-23 · 组卷题型配比 7:3 + 同题双形态 LLM 题型变换（ADR-024）

- **配比规则**：`MAX_OPEN_RATIO=0.3`——单选/多选为主，开放题（问答/编程）不超过总题量三成。
  `balanceQuestionTypes` 升级为 `planComposition`：抽题后先与候选池原位交换补齐配比，
  候选池缺题型时由 LLM 把题目变换成所需形态（useAI 开启时），关闭 AI 则退化为裁题。
- **题型变换（ai/transform.ts）**：选择→开放时 referenceAnswer 由代码合成（概念+解析+正确选项原文）；
  开放→选择时正确选项从参考答案首句提取、LLM 只出 3 个干扰项、代码洗牌定位 answer——
  LLM 不拥有答案 key，ADR-019 安全模型保持成立。
- **id 溯源**：变换后题目保留原题 id，映射只在日志记录（`[题型变换] id: from → to`），UI 不展示。
- **接口**：LLMProvider 新增 `transformQuestion`；FallbackProvider 自动获得降级语义；
  引擎在变体生成前执行变换，失败逐题回退原题型。自适应模式不套配比、不变换。
- 测试 140 例全过（+11）；typecheck/build 通过。

## 2026-08-23 · 多引擎降级链：单选 provider 改为 AIConfig.providers（ADR-023）

- **配置形态**：`PiConfig` 更名 `AIConfig`，`{ provider, model, apiKey, baseUrl? }`
  → `{ providers: ProviderEntry[] }`（每项 `{ id, enabled, model, apiKey, baseUrl? }`），
  数组顺序即优先级。弱模型（chrome 内置 / 本地 Unsloth）可与云端强模型同时启用。
- **降级语义（FallbackProvider）**：调用按顺序尝试，失败/不可用自动切换下一引擎，
  全部失败才抛错（上层 catch 兜底退化为原题/不评分）。chrome 不可用、本地服务未启动、
  云端限流等场景都自然落入此机制。
- **接口瘦身**：`LLMProvider.generateVariant/evaluateOpenAnswer` 去掉 config 参数，
  实现类构造时绑定 `ProviderEntry`；多引擎编排收口到 `createLLMProvider` 工厂，
  interviewEngine 不再逐层透传 config。校验拆为 `isEntryValid` + `isConfigValid`。
- **存储迁移**：localStorage key 不变；loadConfig 把旧单选形态迁移为单元素链，
  新形态逐项清洗（id 白名单 / 去重 / 字段兜底）。默认配置 DeepSeek 单通道不变。
- **设置页重做**：多卡片列表（启用开关 + 条件字段 + 排序/增删），卡片顺序即降级顺序；
  顶部说明降级链语义。`docs/config.example.json` 同步为新形态。
- 测试 123 例全过（+18：降级链语义、配置清洗与旧形态迁移）；typecheck/build 通过。

## 2026-08-23 · 本地 OpenAI 兼容服务支持（Unsloth 默认）+ 实现收敛为两套 + 默认引擎改 DeepSeek

- **local 引擎（ADR-022）**：`ProviderId` 增加 `'local'`（OpenAI 兼容协议，默认
  `http://127.0.0.1:8888/v1` 即 Unsloth Studio）。**复用 pi-ai 原生 `createProvider`**
  （README Custom Providers 路径）而非手写 fetch——models.json 式配置加载属 coding-agent
  CLI，不在 SDK 内；`ai/local.ts` 仅 ~50 行 Model 定义/auth/compat。
- **实现收敛为两套**：删除独立 LocalProvider 类，local 在 `buildModels` 层路由进 pi-ai，
  对上层与云端无差别。LLMProvider 实现只剩 ChromeAIProvider 与 PiAIProvider。
- **免密钥修复**：CredentialStore 空 key 返回 undefined、callLLM 空 key 不显式传 apiKey 选项
  （空串会覆盖 auth 解析导致请求发不出）；compat 关闭 developer role / reasoning_effort。
- **默认引擎改 DeepSeek**（deepseek-v4-flash）；新增 `docs/config.example.json`
  （chrome / local / cloud 三种示例形态）；SettingsPanel local 形态展示 baseUrl 输入与
  自由输入模型 ID、隐藏密钥项。
- 测试 105 例全过（+7：local provider 构建、SSE mock 端到端、工厂分派）；typecheck/build 通过。

## 2026-08-23 · 新增 Chrome Built-in AI Provider（本地模型，免密钥）

- **双底层 LLMProvider（ADR-021）**：新增 `ai/chrome.ts`（Chrome Prompt API 封装：
  chromeAvailability 能力检测 + chromeComplete 一次性补全）与 `ChromeAIProvider`；
  工厂按 `config.provider==='chrome'` 分派。本地推理无需 API Key、答案不出设备，
  与 local-first 产品定位契合；不做 polyfill，不支持的环境由能力检测降级。
- **解耦复用而非平行实现**：`variant.ts` / `evaluate.ts` 改为接受注入的
  `CompleteFn(system, user)`（types.ts 新增），prompt 构建、extractJSON、四维解析兜底
  只有一份——PiAIProvider 注入 pi-ai 的 callLLM，ChromeAIProvider 注入 chromeComplete。
- **配置语义按引擎区分**：`isConfigValid` 对 chrome 只要求 provider 存在（apiKey/model 存空串，
  localStorage 契约不变）；SettingsPanel 改为「AI 引擎」选择，chrome 时隐藏 model/apiKey 项，
  并用 availability 展示本地模型状态（available/downloadable/downloading/unavailable）。
- 测试 98 例全过（+18：chrome 封装 8、变体注入 3、工厂分派/校验 7 等）；typecheck/build 通过。

## 2026-08-23 · 架构评审落地：conceptGraph 职责收敛 + ai→domain 边界成文

- **职责拆分（评审唯一代码变更）**：`computeCoverage` / `suggestNextTopics` 从
  `domain/conceptGraph.ts` 移入 `domain/learner.ts`（连同 CoverageReport/TopicSuggestion 类型）。
  边界自此清晰：conceptGraph 只回答"知识之间是什么关系"（closure/related/expandWithPrerequisites/
  topoRankOf），learner 回答"根据用户状态现在学得如何、该学什么"。掌握判定 isMastered/isAttempted
  与 WEAK_* 阈值仍留在 conceptGraph 单一出处（expandWithPrerequisites 也依赖），以导出函数供 learner 复用，
  不产生反向依赖。相关测试随迁 learner.test.ts 并补 1 例拓扑序建议用例；App.tsx / ProgressPage 导入更新。
- **边界成文（无代码改动）**：ARCHITECTURE 明确 `ai → domain` 只允许依赖纯计算函数
  （aggregateOverall / mergeQuestionRubric 等），禁止依赖 learner/adaptive/quiz 业务流模块；
  同时记录两条"不做"决策：application 保持 interviewEngine 单入口不拆 service；
  `useAI` 维持单一开关（MVP 一键关闭所有 AI），待出现"关变体留评分"的真实需求再拆。
  GeneratedVariant 维持无溯源元数据——LLM 输出不带 metadata 是对的；
  未来若需展示溯源，在应用侧构造 QuestionInstance（sourceQuestionId/aiGenerated）而非污染 LLM 输出契约。
- 测试 80 例全过；typecheck/build 通过。

## 2026-08-23 · 第四批：LLMOps / Safety / System Design / Coding 实践题（去重后收 36 题，总 237 题）

- **新增**（`ai-engineering` +28 / `agentic-ai` +2 / `ai-fundamentals` +6）：
  foundation model 范式、logits 链路、cross-attention、FlashAttention、MoE 工程复杂度、蒸馏设计；
  few-shot 取舍、prompt 消融瘦身、prompt 版本化、CoT 成本归因；
  embedding 迁移双索引、换模型 Recall 暴跌定位、短 query 优化、向量库降本、检索升级阶梯；
  planning vs tool 归因、MCP 引入决策；FT 反例清单、LoRA 效果差三因诊断；
  response cache、semantic cache、RPM/TPM 双限流、provider 切换防风暴；
  prompt 变更验证、LLM 回归测试 CI 化；guardrails 前后置分工、PII 防护、间接注入纵深防御;
  Coding Agent / AI API Platform / Agent-vs-RAG 架构决策三道系统设计题；
  以及首批 5 道 coding 实践题（retry backoff、cosine、recursive chunker、tool handler、context manager）。
  新 topic 仅 foundation-model / flash-attention / distillation / prompt-engineering / vector-db / caching，
  其余复用（privacy/prompt-injection/agent-guardrails/system-design/context-engineering 等既有节点）；
  conceptGraph 增 attention → flash-attention、pretraining → distillation。
- **刻意去重约 24 题**：temperature/top-k-p（ai-fund-026/028）、GQA（dl-06）、alignment tax（ai-posttraining-006）、
  JSON 输出失败（ai-eng-020）、固定步骤 workflow（ai-eng-001）、无限循环检测（ai-eng-011）、
  200 tools routing（ai-eng-006）、量化原理与 70B 上 80GB（ai-inference-005）、judge 可靠性（ai-fund-041）、
  中间指标（ai-eval-001）、幻觉治理（ai-fund-045）、reproducibility trace（ai-engineering-003）、
  routing 信号与降级阶梯（ai-engineering-001/002）、文档 QA 系统设计（agentic-15）、
  跨 session memory 设计（ai-eng-014）、高相似低相关（ai-fund-039）等——均有现成题目覆盖。
- **coding 题型首次入库**：`type: coding` + `language: typescript`，referenceAnswer 存参考实现，
  复用现有 OpenQuestion 渲染与评分链路，未改任何 schema。

## 2026-08-23 · 工程题第三批：去重后收编 26 题（总 201 题）

- **新增**（`ai-fundamentals` +11 / `ai-engineering` +10 / `agentic-ai` +5）：
  attention 长文本退化排查、KV Cache OOM 定位与优化、tokenizer 跨模型差异、
  next-token 为何有效、10T 预训练数据工程、数据配比质量 vs 数量、DP/TP/PP 选型、
  loss NaN 排查、SFT 数据分级清洗、SFT 灾难性遗忘、风格需求 Prompt/RAG/FT 决策、
  TTFT 升高 decode 不变排查、continuous batching、量化方案取舍、RAG 时效性边界、
  Agent 评测设计、70% 准确率分段归因、双 Agent 成功率/成本权衡、model routing、
  降级阶梯、Agent trace 五要素、tool calling 本质、retry 分层放置、工具权限与确认门、
  MCP vs Function Calling、客服 RAG/Workflow/Agent 决策。
  新 topic 仅 training-data / distributed-training / training-stability / observability，
  其余复用既有节点；conceptGraph 增 pretraining → {training-data, distributed-training, training-stability}。
- **刻意去重 20 题**（对方批次与现有题库重复）：Transformer vs RNN、QKV、位置编码/RoPE、
  KV Cache 原理、scaling law、pretrain/posttrain 分工、SFT 定义、RLHF reward model、DPO、
  LoRA 原理与 rank、RAG vs FT 知识库、prefill/decode、chunking 重设计、hybrid search、
  reranker、"recall 高回答差"排查、300 tools routing、agent loop 循环、Plan-and-Execute 取舍、
  cost 优化与 retry/backoff（已由 ai-eng-021/023 覆盖）——按 AGENTS 原则不留重复题。
- 测试 79 例全过；typecheck/build 通过。

## 2026-08-23 · 题库拆分为按类目文件（数据布局变更，显式说明）

- **拆分**：`data/questions.json`（175 题单文件）→ `data/questions/<category>.json` ×11
  （agentic-ai 71 / ai-fundamentals 51 / ai-engineering 13 / 其余 ML 基础类共 40）。
  每题字段 schema 不变——变的只是文件布局；新增题目直接追加到对应类目文件，
  新增类目 = 新建同名 JSON + `domain/categories.ts` 登记标签。
  （按 AGENTS 约定显式说明：这属于对外已发布的 JSON 题库结构变更。）
- **装配**：新增 `data/questionBank.ts`，`import.meta.glob('./questions/*.json', { eager: true })`
  启动时合并为 QuestionBank 单例；App.tsx 改从该模块取题库。
  **刻意不建** question-index / SQLite / IndexedDB / Repository 层——题库是静态 content source，
  运行时只是 filter/pick；等规模（bundle/加载）真成为问题时再加动态 import + 构建期索引。
  Learner Memory 边界不变：静态内容在 questions/*.json，用户状态仍在 localStorage。
- **数据完整性测试化**：原靠人工核对的事项固化为 `data/bank.test.ts`（7 例）——
  id 唯一、类目与 categories 吻合、选择题 answer 索引合法、开放题 referenceAnswer 非空、
  difficulty/type/topic 枚举与非空校验、rubric 维度键与权重和 ≤1、conceptGraph 边两端 topic 均有题目支撑。
  相当于把"build script 校验清单"放进 Vitest，暂不引入独立构建脚本。
- 测试 79 例全过；typecheck/build 通过（rolldown 提示可进一步 dynamic import 切包，暂不需要）。

## 2026-08-23 · AI Fundamentals 基础层题库（51 题，总 175 题）

- **题库**：新增 `ai-fund-001..051` 与类目 `ai-fundamentals`，补齐工程题库之下的原理层——
  Transformer/Attention（含 scaled dot-product 选择题）、Tokenization/BPE、Embedding vs hidden state、
  Pre-training/Scaling Law、Post-training 链路（SFT loss masking → RLHF reward model → DPO 隐式 reward）、
  Fine-tuning/LoRA（rank 取舍、LoRA vs RAG 定位）、推理解码（temperature/top-k/top-p/prefill-decode/KV Cache）、
  Context Window、RAG 基础（chunking/hybrid/reranker/相似度≠相关性）、Evaluation（judge 偏差/数据集设计/offline-online）、
  Hallucination 成因与边界；末尾 5 道综合 Scenario/Debugging 题（模型选型、FAQ 接入、RAG 排查、
  延迟定位、Agent 成功率）延续工程判断定位。
- **知识图谱**：新增 12 条 prerequisite 边形成"基础→进阶→工程应用"链：
  tokenization → transformer → pretraining → sft → {dpo, fine-tuning → lora}；
  transformer → inference-optimization → {kv-cache, context-window}；
  word-embedding/context-window → rag → reranking。topic 尽量复用既有节点，
  新增节点仅 transformer/sft/dpo/fine-tuning/scaling-law/context-window/reranking/rope/alignment/model-selection。
- **类目登记**：`domain/categories.ts` 增加 `ai-fundamentals` 中文标签。

## 2026-08-23 · AI Engineering 工程判断题库扩充（24 题，总 124 题）

- **题库**：新增 `ai-eng-001..024`，主干为工程判断而非知识点——workflow-vs-agent、
  agent-components、tool-calling/tool-routing、react/plan-and-execute/reflection、mcp、
  agent-loop（agentic-ai）；context-engineering、memory、rag、evaluation、structured-output、
  reliability、latency、cost、agent-system-design（新类目 `ai-engineering`）。
  题型刻意混入 trade-off 与 debugging 场景，让 Learner Memory 能区分"知道概念"与"能设计/debug 系统"。
  全部落到现有 schema：开放题统一 `type: essay`（场景风味保留在 tags），difficulty 映射为 easy/medium/hard，
  每题带 rubric.required + 四维 dimensions。
- **知识图谱**：新增 11 条 prerequisite 边，形成两条主线
  （workflow-vs-agent → agent-components → tool-calling → tool-routing；
  react → plan-and-execute → reflection）及 agent-system-design 汇聚点（← tool-calling / rag / evaluation）、
  structured-output → reliability、latency → cost。
  未采纳 `context-engineering → memory`：与既有边 `memory → context-engineering` 方向相反，
  双向共存会触发加载期 isAcyclic 报错，保留原方向。

## 2026-08-23 · 架构评审修复批次（ADR-020：接线 + 删除）

- **功能接线（此前文档承诺但代码未生效）**：
  - `rubric.required` 注入评分提示：新增 `ai/provider.mergeQuestionRubric` 纯函数统一合并
    题目级 dimensions/required——此前 46 道带 required 的题全部未生效。
  - `useAI` 门控开放题评分：`evaluateAnswer` 增加 useAI 检查，关闭 AI 不再偷发 LLM 请求。
- **Bug 修复**：
  - 自适应限时模式倒计时/训练时长重置：截止点锚定 `session.startedAt`（换题不再重置计时）。
  - 自适应 move-on 薄弱优先断线：`nextAdaptiveStep` 接入 profile，兜底改用
    `recommendWeakTopics`（此前误用全部练过主题且生产路径未传）。
  - AdaptiveQuiz「提前结束」先对当前题评分再入账，不再以 0 分污染学习画像。
  - SettingsPanel 切换服务商时重置模型（避免跨服务商非法组合）；删除环境变量误导文案。
- **死代码清理（AGENTS 原则 2）**：
  - 删除 `nodeTypes`/`NodeType`/`nodeTypeOf`/`prerequisitesOf` 及 JSON 中 nodeTypes 字段
    （生产零引用；ADR-019「覆盖面展示仍用」的理由不成立）。
  - 删除 `InterviewSession.variants` 与 GeneratedVariant 溯源字段、`followUpStrategy` 预留字段。
  - conceptGraph 公开 API 无参化（去掉被忽略的 graph 参数）；薄弱阈值收敛到单一出处；
    isChoiceCorrect 去重；pi.ts 收敛 `as never` 为正式类型。
- **口径一致**：README 移除 pi-agent-core 表述（ADR-019 遗漏）；模拟面试页未配置 AI 也允许开始；
  过期注释清理（mastery 公式 / 边类型清单 / variantGenerator 等）。
- 测试 72 例全过（新增 provider rubric 合并、engine useAI 门控、adaptive 薄弱优先）；
  typecheck/build 通过。

## 2026-08-23 · 架构收敛（ADR-019：减法清单执行）

- **移除 pi-agent-core**：开放题评分改走 `ai/evaluate.ts`（pi-ai one-shot）；删除 `interviewAgent.ts`
  及其测试与 npm 依赖。对话式 Agent 仅在"对话式模拟面试"落地时回归（Future/Experimental）。
- **ai 层重组**：models.ts → `pi.ts`；variantGenerator.ts → `variant.ts`；新增 `evaluate.ts`；
  `lib/interviewEngine.ts` → `application/interviewEngine.ts`（应用服务层）。
- **变体安全收窄**：LLM 只重写题干/解析——GeneratedVariant 不再含 options/answer 字段，
  applyVariant 原样保留原题答案数据；提示词不再要求 LLM 重排选项、重算索引。
- **分数所有权**：LLM 只输出四维 dimensions；overall 一律由 domain/aggregateOverall 计算
  （parseEvaluation 忽略 LLM 直出总分）。
- **图边砍到两类**：10 种关系 → prerequisite + related；删除 childrenOf/interviewTargetsOf，
  adaptive 的 deep-dive 简化为"同主题更高难度"；graphlib 限定在 conceptGraph 模块内。
- **mastery 简化**：`avgScore/100`，去掉置信度加权公式。
- 测试 66 例全过；typecheck/build 通过。AGENTS.md / ARCHITECTURE / ADR 同步更新。

## 2026-08-23 · 知识图谱迁移到 @dagrejs/graphlib

- 引入 `@dagrejs/graphlib`（自带 TS 类型）承接图的存储与算法，`domain/conceptGraph.ts` 手写遍历逻辑下线：
  - **加载期 DAG 校验**：prerequisite 子图用 `alg.isAcyclic` / `alg.findCycles` 校验，数据有环直接抛错（fail-fast），不再依赖运行时 seen 集合兜底。
  - **拓扑排序**：`alg.topsort` 给出"基础→进阶"学习顺序，suggestNextTopics 的可学新主题按拓扑序排列（此前按闭包长度近似）。
  - 邻接查询改用 `predecessors()`；公开 API 签名不变，adaptive/coverage/coach 调用方零改动。
- 测试 72 例全过（新增闭包传递性、nodeTypeOf 用例）；typecheck/build 通过。

## 2026-08-23 · 知识图谱正规化（ADR-018：typed nodes/edges + DAG + evidence）

- **图数据重构**（`data/conceptGraph.json`）：
  - `related`/`prerequisites` 两个无类型列表 → `nodeTypes`（8 种节点类型）+ `edges`
    （10 种有向关系：prerequisite/part_of/extends/alternative/tradeoff/contrasts/related_to/technique
    + 面试迁移 deep_dive/challenge）；每对主题单条有向边，无向语义由遍历层双向展开。
  - prerequisite 统一为"基础→进阶"有向 DAG（如 agent-fundamentals → tool-calling → react → plan-and-execute）。
- **领域层升级**（`domain/conceptGraph.ts`）：`prerequisiteClosure`（传递闭包）、`childrenOf`、
  `interviewTargetsOf`、`nodeTypeOf`；coverage 的 blocked 判定改用闭包上溯；
  `expandWithPrerequisites` 沿闭包展开。
- **自适应选题消费新图**：deep-dive = 同主题更高难度 → 图声明的 deep_dive 目标 → 子概念；
  gap-probe 沿前置闭包回退到根因。
- **证据链**：`TopicStats.evidence`（questionId/score/at，最近 10 条），updateLearner 追加，
  掌握度可回溯到具体作答；localStorage v1 附加可选字段，向后兼容。
- 测试 70 例全过（含按新 DAG 更新的 gap-probe 断言）；typecheck/build 通过。

## 2026-08-23 · 自适应面试引擎 + 知识覆盖面（ADR-017）

- **自适应逐题模式**（`InterviewDefinition.adaptive`）：
  - `domain/adaptive.ts`：4 种迁移策略——纵向深挖 / 薄弱补查（降难度→退前置→同主题兜底）/ 横向扩展（概念图 related）/ 新方向；纯函数 + rng 注入 + 单测。
  - 引擎：`buildSession` 自适应时只组第一题；新增 `nextAdaptiveStep`（过滤已问 → 策略选题 → LLM 变体）；`pickQuestions/pickPrioritized` 支持 rng 注入。
  - UI：新增 `quiz/AdaptiveQuiz` 逐题视图（显示出题策略标签、提交即评分、可提前结束）；模拟面试页默认开启自适应；App 状态机支持逐题评分循环（grades 已实时填充时 doSubmit 跳过批量评估）。
- **知识图谱与覆盖面**：
  - 新增 `data/conceptGraph.json` + `domain/conceptGraph.ts`：topic 级 related/prerequisites 边；节点复用题库 topic，不给每题加元数据。
  - `computeCoverage`：按类目统计练过/掌握比例，识别 readyToLearn（前置已齐备）vs blocked（先补前置）。
  - ProgressPage 新增「知识覆盖面」卡片与「建议下一步」（薄弱优先 + 可学新主题及原因）。
  - 教练推荐升级：topicPriorities 经 `expandWithPrerequisites` 沿前置链展开（先补地基再攻难点）。
- 测试：新增 adaptive（6 例）+ conceptGraph（7 例），共 **70 例全过**；typecheck/build 通过。

## 2026-08-23 · Agentic AI 题库按能力维度扩充（46 题，总 100 题）

- 按能力维度重组 agentic-ai 题库（40 → 60 题），新增 topic 维度而非机械堆概念题：
  - **Scenario / System Design**（agentic-15~24）：知识库 Agent、GitHub 仓库问答、Research Agent、ESG 数据抽取、SQL 分析 Agent、金融多源研究、工具路由、长任务 checkpoint/resume、Multi-Agent 研究系统、企业级 Agent Platform。
  - **Debugging**（agentic-25~34）：重复调用、选错工具、非确定失败、context pollution、成功率回归定位、延迟放大、双重付款幂等、多 Agent 环路、表面正确检测、lab-to-prod 落差。全部 essay + rubric，主打 LLM 评分场景。
  - **Trade-off**（agentic-35~44）：Memory 存储选型、强/弱模型级联、Planner 确定性、Tool 候选集收窄、Multi-Agent 过度设计、trajectory 存储策略、RAG 放置位置、大窗口 vs Memory、system prompt 自改、CoT 展示策略。考察 senior/staff 级权衡论证。
  - **高级开放题**（agentic-45~52）：无标准答案，评分维度侧重 architecture + communication。
  - **客观题补充**（agentic-53~60）：从概念清单挑现有题库未覆盖的 8 题（workflow vs Agent、State 设计、Reflection vs retry、记忆≠历史、成本硬边界、注入危害差值、judge 三偏差、评估 vs 单测）转 single/multiple，保自动判分覆盖。
- **schema 不变**：expected_concepts 由 `rubric.required` 承担；新增评分维度（trade_off/practicality）需动四维评分引擎与 UI，作为独立变更另行决策（ADR 待补）。
- 校验：JSON 结构校验通过；54 例测试全过；typecheck 通过。

## 2026-08-23 · 题库扩充 + 代码展示/编辑组件（Shiki / Monaco）

- **题库 40 → 54 题**（基于 2026 面试趋势调研），全部复用现有 schema、不新增题型：
  - LLM：KV cache、MoE 总参/激活参数、解码带宽瓶颈优化（多选）、LoRA、RAG vs 微调 vs 提示工程选型（essay+rubric）、生产级 RAG 管线（多选）、手写 scaled dot-product attention（coding）。
  - Deep Learning：GQA 取代 MHA 的原因。NLP：BPE 分词与 "strawberry 数 r" 根因。
  - Agentic AI：MCP 协议、Agent 护栏（多选）、ReAct vs Plan-and-Execute（essay+rubric）、长任务上下文压缩。
- **代码组件边界确立**：只读高亮 = Shiki，可编辑/对比 = Monaco，不混用：
  - 新增 `components/common/CodeBlock`（Shiki 单例 highlighter + CSS 行号）、`RichText`（段落 + 围栏代码混合渲染）、`lib/codeFence.ts`（纯逻辑切分 + 8 例单测，容错未闭合围栏）。
  - 接入：题干/解析走 `RichText`；编程题参考答案与用户提交代码走 `CodeBlock`。
- **集成 Monaco Editor**：
  - 新增 `components/common/CodeEditor`（本地打包 monaco，不依赖 CDN；editor/json/ts worker 走 Vite `?worker`）。
  - 编程题作答由 TextArea 替换为懒加载 `CodeEditor`；结果页新增「用户代码 vs 参考答案」DiffEditor 对比（展开才挂载）。
- 测试共 **54 例全过**；typecheck/build 通过。

## 2026-08-23 · 产品转向 Training Coach（Learner Memory + 四页结构）

- 按用户评审，从"Quiz Configurator"转为"Training Coach"（ADR-015）：
  - **首屏 = 训练入口**：继续训练（按薄弱项）/ 快速训练（自动选题，10 分钟）/ 自定义训练（折叠的高级配置）。
  - **隐藏系统内部概念**：删除评分权重 UI；API Key 移入「设置」页，首页只显示 "AI ✓ / AI 未配置" 状态 chip，不再弹黄色大 Alert。
  - **Learner Memory**：新增 `domain/learner.ts`（纯逻辑）+ `storage/learner.ts`（localStorage v1 key）。结构化学习信号（topicStats 的 avgScore/mastery/trend/commonWeaknesses + 最近 50 条 SessionRecord），**不存对话原文**。
  - **Coach 抽题**：`InterviewDefinition.topicPriorities` + `domain/quiz.pickPrioritized`，薄弱主题（mastery<0.85 且均分<85）优先进入训练。
  - **结果页升级**：比上次得分 delta、亮点/待加强聚合、AI 训练建议（`recommendationText`）、按薄弱项继续训练。
  - **进度页**：总体分 + 主题掌握度条 + 最近趋势折线（内联 SVG）+ 需要关注 + 最近训练列表。
  - **面试页**：30 分钟限时模拟面试入口（追问式 loop 待 pi-agent-core 后续接入）。
- 组件：新增 `home/TrainingHome`、`progress/ProgressPage`、`interview/InterviewPage`、`settings/SettingsPanel`；删除 `SetupPanel`、`SettingsModal`（不向后兼容）。
- 测试：新增 `domain/learner.test.ts`（13 例），共 **46 例全过**；构建通过。

## 2026-08-23 · 接入 pi-agent-core（Interview Agent 层）+ Vitest 测试

- 采纳评审结论：pi-agent-core **只做 LLM Agent 层**，Quiz Domain 完全自写（ADR-012）：
  - 新增 `ai/interviewAgent.ts`：唯一依赖 `@earendil-works/pi-agent-core` 的地方，用 `Agent` + `subscribe(message_update→text_delta)` 做开放/编程题流式评分，`parseEvaluation` 结构化输出；`(model, streamFn)` 依赖注入便于测试。
  - 变体留在 `ai/variantGenerator.ts`（pi-ai one-shot，不走 Agent）；`ai/client.ts` 更名 `ai/models.ts`，`ai/piProvider.ts` 拆为 `variantGenerator.ts` + `provider.ts` 里的 `PiAIProvider` 委托实现。
  - 浏览器 local-first：pi-ai `streamSimple` 作 Agent `streamFn`，无后端代理。
  - 验证：pi-agent-core 不静态 import `pi-ai/compat`；`node:fs/crypto/...` externalize 成警告（只用 Agent 不触 harness 则不崩）；主 chunk 1.26 MB / 369 kB gzip。
- 评分升级（ADR-013）：四维更名为 正确性/完整性/架构/表达；`Question.rubric` 支持 `required` 要点 + 该题 `dimensions` 权重覆盖；题库 5 道开放/编程题补 rubric 样例。
- 测试基建（ADR-014）：引入 **Vitest**（`npm run test`），33 个用例覆盖 domain 抽题/判分/评分聚合/变体校验 + ai 提示词/解析纯函数 + **真实 Agent + mock streamFn** 集成；`*.test.ts` 从生产 tsc 排除。
- 删除：`src/ai/client.ts`、`src/ai/piProvider.ts`（被 models/variantGenerator 取代，不向后兼容）。

## 2026-08-23 · 架构边界重构（domain / ai / storage）

- 采纳评审建议，重构 LLM 变体 / 评分 / 题库模型的边界：
  - 目录拆分：`domain/`（纯逻辑）、`ai/`（LLMProvider 适配层，唯一依赖 pi-ai）、`storage/`、`lib/interviewEngine.ts` 编排；组件按 `quiz/result/settings` 分组。
  - 题库模型升级：每题加 `topic`/`tags`/`reference.concept`，`category` 改 slug；新增 `agentic-ai` 类目 10 题（现共 38 题）。
  - 变体安全：`validateVariant` 校验 + 失败回退原题，开放题 `referenceAnswer` 永不被 LLM 改写（ADR-006）。
  - LLM 藏在 `LLMProvider` 接口后，PiAIProvider 为唯一实现（ADR-007）。
  - 评分升级为四维 Rubric（正确性/完整性/深度/表达）（ADR-008）。
  - 删除旧 `lib/quiz.ts`、`lib/piClient.ts`、`lib/storage.ts` 及旧组件文件（不向后兼容）。

## 2026-08-23 · 文档分层重构

- 将 AGENTS.md 中的"常用命令""技术栈注意点"移除。
- 常用命令并入 `README.md` 的"常用命令"段。
- 技术栈注意点并入 `docs/ARCHITECTURE.md`。
- 新建 `docs/`：`ARCHITECTURE.md`（架构设计）、`DECISIONS.md`（ADR）、本文件（变更记录）。
- 动因：AGENTS.md 应保持"只放原则"，与 README / docs 去重（ADR-005）。

## 2026-08-23 · 引入 AGENTS.md（两大原则）

- 新增 `AGENTS.md`，固化两条大原则：不向后兼容（删死代码优先）、关键逻辑必须加测试（Vitest）。

## 2026-08-23 · Interview Engine 化改造

- 新增 `src/lib/interviewEngine.ts`：声明式 `InterviewDefinition` → `buildSession` → `evaluateAnswer` / `evaluateSession`。
- 类型系统升级：`EvaluationResult`（三维评分）、`coding` 编程题、`tags`、`evaluationCriteria` 等。
- `piClient.gradeEssay` 升级为 `evaluateOpenAnswer`，返回三维评分。
- 新增倒计时（`timeLimitSec`，到点自动交卷）。
- 题库 `questions.json` 增加 2 道 coding 题（softmax / 线性回归 BGD）。

## 2026-08-23 · 初始脚手架

- Vite + React 18 + TS + Ant Design 应用。
- 集成 `@earendil-works/pi-ai`（0.84.2）做题目变体与问答题评分。
- 题库 28 题 / 8 类别 / 单选择·多选·问答三类。
- 修正：antd 6 的 `Divider` 移除 `orientation`；pi-ai 浏览器密钥改用 `createModels({ credentials })`。
