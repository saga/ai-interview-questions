# AI 面试题训练器

**会记住你的训练表现，并根据薄弱项动态调整下一次训练的 AI 面试教练。**

Vite + React 18 + TypeScript + Ant Design 单页应用（四页：训练 / 进度 / 面试 / 设置）。集成 [`@earendil-works/pi-ai`](https://github.com/earendil-works/pi) 做题目变体与开放题评分。内部采用 Interview Engine + Learner Memory 架构（声明式 `InterviewDefinition` → `InterviewSession` → 多维 `EvaluationResult` → `LearnerProfile` 教练推荐）。

## 功能

- 首屏训练入口：**继续训练**（按薄弱项）/ **快速训练**（自动选题，10 分钟）/ 自定义训练（折叠的高级配置）
- **Learner Memory**：本地记录每次训练的分数、弱项、掌握度与趋势，据此推荐下一次训练（薄弱主题优先出题）
- 题库驱动（`src/data/questions.json`，9 类别，四类题型），LLM 变体出题（保持知识点不变）
- 开放题 Agent 多维评分（正确性 / 完整性 / 架构 / 表达）+ 选择题确定性判分
- 结果页对比上次得分、给出亮点/待加强与 AI 训练建议；进度页展示主题掌握度与趋势
- 模拟面试（30 分钟限时题组；追问式对话面试后续接入）——未配置 AI 也可开始，选择题照常判分
- 多服务商 OpenAI / Anthropic / OpenRouter，密钥仅存浏览器 `localStorage`（「设置」页配置）

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

进入「设置」页 → 选服务商（**OpenRouter** 对浏览器直连最友好）→ 选/填模型 ID → 填 API Key（仅存本机 `localStorage`）。首页右上角会显示 "AI ✓ / AI 未配置" 状态。

> **local-first 隐私架构，但浏览器侧密钥并非安全机密**：密钥不上传任何服务器，但受 XSS / 恶意浏览器扩展威胁，请勿使用高权限生产密钥。浏览器直连受 CORS 限制，OpenAI/Anthropic 直连失败优先换 OpenRouter 或配代理。未配密钥也能用题库原题（开放题不评分）。

## 扩展题库

编辑 `src/data/questions.json`（无需改代码）：

```json
{
  "id": "ml-99",
  "category": "machine-learning",  // slug，见 src/domain/categories.ts
  "topic": "regularization",        // 细分主题
  "tags": ["可选", "标签"],
  "type": "single",                 // single | multiple | essay | coding
  "difficulty": "easy",             // easy | medium | hard
  "question": "题干…",
  "options": ["A", "B", "C", "D"],
  "answer": [0],                    // 正确选项索引数组（multiple 可多个）
  "explanation": "解析…",
  "rubric": {                       // 可选，仅开放/编程题：题目级评分量表
    "required": ["必须覆盖的要点1", "要点2"],
    "dimensions": { "correctness": 0.4, "completeness": 0.2, "architecture": 0.2, "communication": 0.2 }
  }
}
```

- 问答 `essay`：用 `referenceAnswer` 代替 `options`/`answer`。
- 编程 `coding`：加 `language`（如 `python`），`referenceAnswer` 存参考代码。
- 开放题由 LLM 按四维评分（正确性/完整性/架构/表达）；`rubric.required` 会作为"必须覆盖的要点"注入评分提示，`rubric.dimensions` 覆盖该题的四维权重。
