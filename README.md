# AI 面试题训练器（AI Interview Trainer）

基于 **Ant Design + React + Vite** 的 AI 面试题训练 Web 应用。每次从题库随机抽取题目（默认 10 道），题型涵盖**单选题、多选题、问答题**。集成 [`@earendil-works/pi-ai`](https://github.com/earendil-works/pi) 调用大模型，对题目做"变体变换"（重新措辞、打乱选项、重算答案）并对问答题进行智能评分。

## 功能特性

- 📚 **题库驱动**：题目存储在 `src/data/questions.json`，覆盖机器学习、深度学习、NLP、大语言模型、计算机视觉、统计数学、MLOps、安全伦理等 8 大类别。
- 🔀 **三类题型**：单选 / 多选 / 问答，自动判分与逐题解析。
- 🤖 **LLM 变体出题**：启用后，每道题由大模型生成变体（保持知识点与正确答案不变），避免死记硬背原题。
- 📝 **问答题 AI 评分**：提交后用大模型对问答题给出 0–100 评分、亮点与遗漏点反馈。
- ⚙️ **多服务商**：支持 OpenAI / Anthropic / OpenRouter，密钥仅存于本地浏览器。

## 快速开始

```bash
npm install
npm run dev      # 本地开发，默认 http://localhost:5173
npm run build    # 类型检查 + 生产构建
npm run preview  # 预览构建产物
```

## 配置 LLM（可选但推荐）

点击右上角 **「LLM 设置」**：

1. 选择服务商（OpenRouter 对浏览器直连最友好，模型也最多）。
2. 选择 / 输入模型 ID。
3. 填写 API Key（仅保存在本机 `localStorage`，不上传任何服务器）。

> 浏览器直连大模型 API 可能受 CORS 限制。若 OpenAI/Anthropic 直连失败，优先使用 **OpenRouter**，或自行配置代理。未配置密钥时仍可正常使用题库原题（问答题不自动评分）。

若从 Node 环境调用，也可通过环境变量 `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` 提供密钥（浏览器中需显式填写）。

## 目录结构

```
src/
  data/questions.json     # 题库（JSON）
  types.ts                # 题型与数据结构定义
  lib/
    piClient.ts           # pi-ai 封装：变体生成、问答题评分
    storage.ts            # 本地配置读写
    quiz.ts               # 抽题、判分等逻辑
  components/
    SettingsModal.tsx     # LLM 设置弹窗
    SetupPanel.tsx        # 训练配置（题量/类别/AI 开关）
    QuestionCard.tsx      # 单题作答卡片
    ResultPanel.tsx       # 成绩与解析
  App.tsx                 # 主流程编排
  main.tsx                # 入口
```

## 扩展题库

编辑 `src/data/questions.json`，按以下格式追加（无需改代码）：

```json
{
  "id": "ml-99",
  "category": "机器学习基础",
  "type": "single",            // single | multiple | essay
  "difficulty": "easy",        // easy | medium | hard
  "question": "题干…",
  "options": ["A", "B", "C", "D"],
  "answer": [0],               // 正确选项索引数组（multiple 可多个）
  "explanation": "解析…"
}
```

问答题将 `type` 设为 `essay`，用 `referenceAnswer` 代替 `options`/`answer` 即可。
