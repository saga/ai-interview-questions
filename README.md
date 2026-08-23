# AI 面试题训练器

**会记住你的训练表现，并根据薄弱项动态调整下一次训练的 AI 面试教练。**

Vite + React 18 + TypeScript + Ant Design 单页应用（四页：训练 / 进度 / 面试 / 设置）。集成 [`@earendil-works/pi-ai`](https://github.com/earendil-works/pi) 做题目变体与开放题评分。内部采用 Interview Engine + Learner Memory 架构（声明式 `InterviewDefinition` → `InterviewSession` → 多维 `EvaluationResult` → `LearnerProfile` 教练推荐）。

## 功能

- 首屏训练入口：**继续训练**（按薄弱项）/ **快速训练**（自动选题，10 分钟）/ 自定义训练（折叠的高级配置）
- **Learner Memory**：本地记录每次训练的分数、弱项、掌握度与趋势，据此推荐下一次训练（薄弱主题优先出题）
- 题库驱动（`src/data/questions/`，11 类别），每题同时具备选择与开放双形态，LLM 变体出题（保持知识点不变）
- 开放题 Agent 多维评分（正确性 / 完整性 / 架构 / 表达）+ 选择题确定性判分
- 结果页对比上次得分、给出亮点/待加强与 AI 训练建议；进度页展示主题掌握度与趋势
- 模拟面试（30 分钟限时题组；追问式对话面试后续接入）——未配置 AI 也可开始，选择题照常判分
- 多引擎降级链：Chrome 内置模型 / 本地 Unsloth / 云端服务商可同时启用并排定优先级，失败自动降级到下一个（ADR-023）；密钥仅存浏览器 `localStorage`（「设置」页配置）
## 常用命令

```bash
npm install
npm run dev        # 本地开发，http://localhost:5173
npm run build      # 类型检查 + 生产构建（tsc -b && vite build）
npm run preview    # 预览构建产物
npm run test       # Vitest 单元测试（见 AGENTS.md 原则 2）
```

## 文档

- `docs/ARCHITECTURE.md`：架构、目录职责、技术栈注意点
- `docs/DECISIONS.md`：关键决策（ADR，含"为何不迁 Astro"）
- `docs/CHANGELOG.md`：设计变更记录
- `AGENTS.md`：协作原则（不向后兼容 / 关键测试）

## 配置 LLM（可选但推荐）

进入「设置」页，直接在 JSON 编辑器里编辑引擎配置（示例见 `docs/config.example.json`）：`providers` 数组顺序即降级链优先级——调用时从上到下依次尝试，失败自动切换到下一个。可用引擎：`chrome`（浏览器内置 AI，免密钥）、`local`（本机 OpenAI 兼容服务如 Unsloth/vLLM/Ollama，免密钥）、`deepseek` / `openrouter` / `google`（Gemini，云端直连，需 API Key）、`cloudflare-workers-ai`（需 API Token + Account ID）。推荐把免费的本地引擎放前面、云端强模型殿后兜底；保存时自动校验格式。密钥仅存本机 `localStorage`。首页右上角会显示 "AI ✓ / AI 未配置" 状态。

> **local-first 隐私架构，但浏览器侧密钥并非安全机密**：密钥不上传任何服务器，但受 XSS / 恶意浏览器扩展威胁，请勿使用高权限生产密钥。未配密钥也能用题库原题（开放题不评分）。

## 扩展题库

题库按类目拆分为 `src/data/questions/<category>.json`（启动时自动合并，无需改代码）。新增题目：追加到对应类目文件；新增类目：建同名 JSON 文件并在 `src/domain/categories.ts` 登记中文标签：

```json
{
  "id": "ml-99",
  "category": "machine-learning",   // slug，见 src/domain/categories.ts
  "topic": "regularization",        // 细分主题
  "tags": ["可选", "标签"],
  "difficulty": "easy",             // easy | medium | hard
  "question": "题干…",
  "explanation": "解析…",
  "formats": {                      // 双形态（ADR-027）：至少一种，建议两种都给
    "choice": {
      "type": "single",             // single | multiple
      "options": ["A", "B", "C", "D"],
      "answer": [0]                 // 正确选项索引数组（multiple 可多个）
    },
    "open": {
      "referenceAnswer": "参考答案…",
      "language": "python"          // 可选：给出则为编程形态（Monaco 编辑器 + 代码对比）
    }
  },
  "rubric": {                       // 可选：题目级评分量表
    "required": ["必须覆盖的要点1", "要点2"],
    "dimensions": { "correctness": 0.4, "completeness": 0.2, "architecture": 0.2, "communication": 0.2 }
  }
}
```

- 题库对象是知识本体；「本次出选择还是开放」由组卷分配（会话实例 `SessionQuestion`），同一道题可跨会话换形态。
- 开放形态由 LLM 按四维评分（正确性/完整性/架构/表达）；`rubric.required` 会作为"必须覆盖的要点"注入评分提示，`rubric.dimensions` 覆盖该题的四维权重。
