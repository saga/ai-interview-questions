# 架构/工程文档与代码实现一致性核查报告

> 核查对象：主架构文档 `docs/ARCHITECTURE.md` + 工程文档（AGENTS / README / PR* / CHECKLIST 等）
> 对照实现：`src/`（domain / ai / agent / application / storage / config / types）
> 日期：2026-08-28

## 一、已验证一致的要点（节选）

| 文档声明 | 代码实现 | 结论 |
| --- | --- | --- |
| DEFAULT_RUBRIC 四维权重 0.4/0.2/0.2/0.2 | `domain/evaluation.ts` `DEFAULT_RUBRIC` | ✓ |
| 开放题占比 `floor(count*0.3)` | `domain/quiz.ts` `MAX_OPEN_RATIO = 0.3` | ✓ |
| 自适应开放随机概率 0.3 | `application/interviewEngine.ts` `ADAPTIVE_OPEN_PROBABILITY = 0.3` | ✓ |
| 自适应开启后 buildSession 只组 1 题 | `interviewEngine.ts` `count = adaptive ? 1 : count` | ✓ |
| Learner 历史会话上限 50 / trend 阈值 2 / 薄弱阈值 0.85, 85 | `domain/learner.ts` `SESSION_CAP / TREND_EPSILON / WEAK_*` | ✓ |
| Dexie schema version 2（含 errorLog 表） | `storage/db.ts` `version(2)` | ✓ |
| 底层依赖：antd 6.x、@dagrejs/graphlib、zod 4.4. 3、monaco 0.56、React 18 | `package.json`（antd 6.6.1 / graphlib 4.0.5 / zod 4.4.3 / monaco 0.56.0 / react 18.3.1） | ✓ |
| LLMProvider 工厂 + isEntryValid/isConfigValid/mergeQuestionRubric/ChromeAIProvider/PiAIProvider/FallbackProvider | `ai/provider.ts`（均存在） | ✓ |
| conceptGraph 使用 `@dagrejs/graphlib`（Graph/alg） | `domain/conceptGraph.ts` `import { Graph, alg } from '@dagMrejs/graphlib'` | ✓ |
| sessionRecordFromAgent → updateLearner 同一管线 | `agent/types.ts` `sessionRecordFromAgent` + `domain/learner.sessionFromQuiz` | ✓ |
| AIConfig 全局默认 `generateOpenQuestions: false`（样例 + loadConfig 清洗） | `config/sample-config.json` + `storage/settings.ts` | ✓ |
| `ai/` 不得依赖 `learner/adaptive/quiz` 业务流程 | grep `src/ai` 无此类 import | ✓ |
| InterviewDefinition 字段（categories/difficulties/formats/count/useAI/scoringRubric/timeLimitSec/evaluationCriteria…） | `schemas/interview.ts` | ✓ |
| Agent 面试「单 provider 起步，不接 FallbackProvider」 | `AgentInterviewPage.tsx` 传单一 provider | ✓ |

## 二、发现的不一致 / 潜在问题

### 1. `generateOpenQuestions` 默认语义错位（中等，潜在功能隐患）
- **文档**：`AIConfig.generateOpenQuestions` 默认 **false**（ADR-031），`storage/settings.ts` 与 `config/sample-config.json` 均显式 `false`，`parseConfigJSON` 注释「已由 Zod 默认 false」。
- **代码**：`src/agent/interviewAgent.ts` 的 `CreateInterviewAgentOptions.generateOpenQuestions` 与 `src/agent/tools.ts` 的 `AgentToolDeps.generateOpenQuestions` 默认值均为 **true**（解构 `?? true`），`tools.ts` 注释亦写「默认 true（允许开放题）」。
- **影响**：当前 `AgentInterviewPage` 显式传入 `config.generateOpenQuestions`，实际行为跟随全局 false，所以运行时正确。但「Agent 层默认 true」与「全局默认 false」是语义错位——一旦未来某处漏传该参数，会**悄悄放开开放题、绕过 `generateOpenQuestions` 全局开关**，正是此前已修过的一类隐患（agent 绕过开关）。
- **建议**：将 Agent 层两处默认改为 `false`（或 `?? config?.generateOpenQuestions`），与全局默认值对齐。

### 2. 文档对 `SessionQuestion` 的描述前后矛盾（中等，文档内部不一致）
- **准确处**：ARCHITECTURE.md 前文（ADR-027）写明「SessionQuestion 是会话实例（同一道题本次以哪种形态呈现）」—— 与代码一致。
- **矛盾处**：「Interview Engine」段却写「`InterviewSession.questions: SessionQuestion[] (question 快照 + format + 用户答案 + 评分)`」。
- **实际**：`schemas/session.ts` 中 `SessionQuestion = { question, format }`，**不包含**用户答案与评分；答案（`answers`）与评分（`evaluations`）分别由会话对象（InterviewSession / AgentSession）承载（`interviewEngine.ts` 的 `evaluateSession(answers)`、`agent/types.ts` 的 `evaluations`）。
- **建议**：修正「Interview Engine」段，把「用户答案 + 评分」从 SessionQuestion 描述中移除（或移至 Session 层级），避免读者误以为 SessionQuestion 自带作答与评分。

### 3. `graphology` 依赖未提及且代码中未使用（轻微）
- `package.json` 声明了 `graphology@^0.26.0`，但 `src/` 全树无任何引用；架构文档「依赖 / 技术栈」一节只提 `@dagrejs/graphlib`（conceptGraph 确实用它，已验证）。
- **建议**：确认是否为预留/冗余依赖；若是废弃则移除，否则在文档补充用途（例如若计划用于蓝图管线）。

### 4. `courses/` 目录仅占位（轻微，基本相符）
- 文档：「`data/courses/` 目录尚未创建——首个真实课程接入时新建」。
- 现状：`src/data/courses/` 仅有 `.gitkeep`，无实质内容，与「尚未创建」语义一致（占位而已）。可忽略，仅作记录。

## 三、结论

核心架构、分层、默认值与边界约定（`DEFAULT_RUBRIC`、`MAX_OPEN_RATIO`、`SESSION_CAP`、降级链 `FallbackProvider`、`mergeQuestionRubric`、`conceptGraph` 的 graphlib、AgentLifetime `sessionRecordFromAgent` 等）与架构文档**高度一致**，说明设计与实现同步良好。

需要跟进的三处：
1. **（建议修复）** Agent 层 `generateOpenQuestions` 默认 `true` 与全局 `false` 错位 —— 改为 `false` 消除潜在绕过隐患。
2. **（文档修正）** ARCHITECTURE.md 中 `SessionQuestion` 混淆了「题实例」与「会话级答案/评分」，需校订表述。
3. **（文档/依赖清理）** `graphology` 既未被文档提及、也未被代码引用，建议清理或补说明。

> 注：`courses/` 仅 `.gitkeep` 占位，符合文档「尚未创建」。
