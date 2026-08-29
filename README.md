# AI 面试题训练器

**会记住你的训练表现，并根据薄弱项动态调整下一次训练的 AI 面试教练。**

Vite + React 18 + TypeScript + Ant Design 单页应用（五页：训练 / 进度 / 面试 / Agent 面试 / 设置）。集成 [`@earendil-works/pi-ai`](https://github.com/earendil-works/pi) 做题目变体与开放题评分，并引入 [`@earendil-works/pi-agent-core`](https://github.com/earendil-works/pi) 作为「Agent 面试」的决策运行时。内部采用 Interview Engine + Learner Memory 架构（声明式 `InterviewDefinition` → `InterviewSession` → 多维 `EvaluationResult` → `LearnerProfile` 教练推荐）。

## 功能

- 首屏训练入口：**继续训练**（按薄弱项）/ **快速训练**（自动选题，10 分钟）/ 自定义训练（折叠的高级配置）
- **Learner Memory**：本地记录每次训练的分数、弱项、掌握度与趋势，据此推荐下一次训练（薄弱主题优先出题）
- 题库驱动（`src/data/questions/`，按 topic 拆分 34 个文件、624 题；6 大能力域为 taxonomy 逻辑分组），其中 618 题同时具备选择与开放双形态，LLM 变体出题保持知识点不变
- 开放题 Agent 多维评分（正确性 / 完整性 / 架构 / 表达）+ 选择题确定性判分
- 结果页对比上次得分、给出亮点/待加强与 AI 训练建议；进度页展示主题掌握度与趋势
- 模拟面试（30 分钟限时题组；追问式对话面试后续接入）——未配置 AI 也可开始，选择题照常判分
- **Agent 面试**（第五页）：基于 `pi-agent-core` 的自主决策运行时——Agent 实时决定下一题问什么、是否追问、何时收尾；评分与 Learner 管线复用同一套，与规则式「模拟面试」并存（ADR-034）
- 多引擎降级链：Chrome 内置模型 / 本地 Unsloth / 云端服务商可同时启用并排定优先级，失败自动降级到下一个（ADR-023）；密钥仅存浏览器 `localStorage`（「设置」页配置）
## 常用命令

```bash
npm install
npm run dev                # 本地开发，http://localhost:5173
npm run build              # 类型检查 + 生产构建（tsc -b && vite build）
npm run preview            # 预览构建产物
npm run test               # Vitest 单元测试（见 AGENTS.md 原则 2）
npm run question:coverage  # 题库覆盖矩阵（topic × angle）+ 补题建议清单（ADR-032）
npm run question:blueprint # 把缺口格输出为题目蓝图 JSON（含变体候选），如 -- 10
npm run question:audit    # Python 结构/分布/覆盖率审计
npm run question:analysis # Python 统计、近重复、TF-IDF 聚类、难度分类、图分析
```

Python 分析工具使用 `uv` 管理，首次运行前执行 `uv sync --extra analysis`。`question:analysis` 默认不会加载语义模型；需要语义去重时显式运行：

```bash
uv run --extra analysis python scripts/question_analysis.py --json
uv run --extra analysis python scripts/question_analysis.py --semantic --json
```

报告中的 `pandas.topicCounts` 对应 `df.groupby("topic").size()`，`pandas.topicAngleCounts` 对应 `df.groupby(["topic", "angle"]).size()`。TF-IDF/KMeans、embedding 聚类和难度分类是质量信号，不是题目正确性的证明；`--semantic` 会用仓库内 ARM64 INT8 ONNX 模型，通过 ONNX Runtime 的同一次 embedding 编码同时发现语义重复题和语义题簇。`optimum-onnx` 负责 Sentence Transformers 的 ONNX backend 接入，运行设备为 CPU；M5 的 CoreML provider 需单独 benchmark，不默认宣称使用 Neural Engine。默认模型路径为 `models/paraphrase-multilingual-MiniLM-L12-v2`，加载使用 `local_files_only=True`，模型缺失会直接报错，不会访问 Hugging Face。模型权重通过 Git LFS 管理，模型卡为 Apache-2.0 并随模型文件保留。Python 只负责离线分析，题目运行时契约仍由 TypeScript/Zod 校验。

## 文档

- `docs/ARCHITECTURE.md`：架构、目录职责、技术栈注意点
- `docs/DECISIONS.md`：关键决策（ADR，含"为何不迁 Astro"）
- `docs/CHANGELOG.md`：设计变更记录
- `AGENTS.md`：协作原则（不向后兼容 / 关键测试）

## 配置 LLM（可选但推荐）

进入「设置」页，直接在 JSON 编辑器里编辑引擎配置（示例见 `docs/config.example.json`）：`providers` 数组顺序即降级链优先级——调用时从上到下依次尝试，失败自动切换到下一个。可用引擎：`chrome`（浏览器内置 AI，免密钥）、`local`（本机 OpenAI 兼容服务如 Unsloth/vLLM/Ollama，免密钥）、`deepseek` / `openrouter` / `google`（Gemini，云端直连，需 API Key）、`cloudflare-workers-ai`（需 API Token + Account ID）。推荐把免费的本地引擎放前面、云端强模型殿后兜底；保存时自动校验格式。密钥仅存本机 `localStorage`。首页右上角会显示 "AI ✓ / AI 未配置" 状态。

> **local-first 隐私架构，但浏览器侧密钥并非安全机密**：密钥不上传任何服务器，但受 XSS / 恶意浏览器扩展威胁，请勿使用高权限生产密钥。未配密钥也能用题库原题（开放题不评分）。

## 扩展题库

题库按 topic 拆分为 `src/data/questions/<topic>.json`（启动时自动合并，无需改代码）。新增题目：追加到对应 topic 文件；新增 topic：在 `src/data/taxonomy.ts` 登记骨架与中文标签，再建同名 JSON 文件。

补题前先跑 `npm run question:coverage` 看覆盖矩阵——优先补「知识点 × 角度」缺口格，而不是盲目堆题量。给题目加 `"angle"` 字段（可选，共 10 角度：`definition / fundamental / mechanism / comparison / calculation / tradeoff / scenario / debugging / design / system-design`）即可计入矩阵；未标注的题不计入，报告会单列数量：

```json
{
  "id": "ml-99",
  "category": "training",           // topic slug，与文件名一致（见 src/data/taxonomy.ts）
  "topic": "regularization",        // 知识节点 id（见 src/data/knowledge/）
  "tags": ["可选", "标签"],
  "difficulty": "easy",             // easy | medium | hard
  "angle": "tradeoff",              // 可选：主考察角度（覆盖矩阵用）
  "question": "题干…",
  "explanation": "解析…",
  "formats": {                      // 双形态（ADR-027）：至少一种，建议两种都给
    "choice": {
      "type": "single",             // single | multiple
      "question": "可选：选择形态专属场景题干…",  // 工程情境类题建议提供
      "options": ["A", "B", "C", "D"],
      "answer": [0]                 // 正确选项索引数组（multiple 可多个）
    },
    "open": {
      "referenceAnswer": "参考答案…",
      "language": "python"          // 可选：给出则为编程形态（Monaco 编辑器 + 代码对比）
    }
  }
}
```

- 题库对象是知识本体；「本次出选择还是开放」由组卷分配（会话实例 `SessionQuestion`），同一道题可跨会话换形态。
- 开放形态由 LLM 按四维评分（正确性/完整性/架构/表达）；评分要点来自知识节点的 `required` 与题目的 `explanation`，权重统一使用训练定义中的全局 rubric。
