# 架构设计

## 总体形态

单页应用（SPA）：`Vite + React 18 + TypeScript + Ant Design`。LLM 能力通过 `@earendil-works/pi-ai` 在**浏览器内**直连，用户密钥存 `localStorage`，无独立后端。

> 决策背景：当前需求是"一个能跑的练习器"，内容站/SEO/多路由尚未出现，故保持 SPA，不引入 Astro。详见 `docs/DECISIONS.md` ADR-001。

## Interview Engine

内部采用声明式引擎，而非散装 setup 逻辑：

```
InterviewDefinition  (声明式：topic / categories / difficulties / questionTypes
                       / count / useAI / scoringRubric / timeLimitSec / evaluationCriteria)
        │
        ↓  interviewEngine.buildSession()
   InterviewSession  (本场抽中的题目 + 用户答案 + 评分)
        │
        ↓  interviewEngine.evaluateAnswer() / evaluateSession()
   EvaluationResult  (overall 0-100
                      + dimensions: correctness / depth / communication
                      + strengths / gaps / feedback)
```

- 选择题：`evaluateAnswer` 做确定性判分（仅 `correctness` 维度）。
- 开放题（问答 `essay` / 编程 `coding`）：调用 LLM 按三维评分；未配置密钥时退化为参考答案自评。

## 目录职责

```
src/
  data/questions.json     # 题库（JSON 用户数据契约，勿随手改结构）
  types.ts                # 题型 + Interview Engine 数据结构
  lib/
    piClient.ts           # pi-ai 封装：变体生成、开放题多维评分
    interviewEngine.ts    # 引擎编排：buildSession / evaluateAnswer / evaluateSession
    storage.ts            # 本地配置读写（localStorage）
    quiz.ts               # 抽题、判分、题型判定工具
  components/
    SettingsModal.tsx     # LLM 设置弹窗
    SetupPanel.tsx        # 训练配置（生成 InterviewDefinition）
    QuestionCard.tsx      # 单题作答卡片（含编程题代码框）
    ResultPanel.tsx       # 成绩与多维解析
  App.tsx                 # 主流程编排（含可选倒计时）
  main.tsx                # 入口
```

## 数据流

1. `SetupPanel` 收集用户选择 → 生成 `InterviewDefinition`。
2. `App` 调 `buildSession(def)`：按类别/难度/题型过滤 → 随机抽题 → 若 `useAI` 调 `piClient.transformQuestion` 生成变体（知识点与答案不变）。
3. 用户逐题作答，`QuestionCard` 维护答案。
4. 交卷：`evaluateSession` 聚合每题评分 → `ResultPanel` 展示总分 + 三维明细 + 逐题解析。

## 技术栈注意点

- **antd 为 6.x**：`Divider` 仅支持 `horizontal / vertical`，**无** `orientation` 的 `left/right/center`。其它 6.x API 差异也需留意。
- **pi-ai 浏览器注入密钥**：走 `createModels({ credentials })` 传入内存 `CredentialStore`；provider id 为 `openai / anthropic / openrouter`。`complete()` 的 options 类型不含 `apiKey`，不要往里塞。
- **浏览器直连 LLM 受 CORS 限制**：默认推荐 **OpenRouter**（模型多、CORS 阻力小）；OpenAI/Anthropic 直连可能失败，需自配代理。未配置 key 时仅用题库原题（开放题不评分）。
- **pi-ai 对浏览器友好**：库内部对 `globalThis.process` 与 `node:fs` 做了守卫/懒加载，打包时 `node:fs` 会外部化为警告，属预期且不崩。
- **构建**：`npm run build` 用 `tsc -b && vite build`，开启 `noUnusedLocals`，未使用的 import/变量会直接报错。
