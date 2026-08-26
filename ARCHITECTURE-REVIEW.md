# 架构与工程设计审查报告

> 审查日期：2026-08-26 · 基线：commit `1032d77` · typecheck ✅ / vitest 338 用例全过 ✅
> **状态更新（2026-08-26）**：第一节 P0 文档不一致问题已修复——ARCHITECTURE.md / README / DECISIONS(ADR-039、ADR-041) 已按代码实况更新，CHANGELOG 已追加记录。以下第二节起的问题仍待处理。

## 总体评价

代码本身的分层设计是健康的：`schemas → domain / ai → application → components` 依赖方向清晰，domain 纯函数化且测试覆盖扎实（37 个测试文件 / 338 用例），Zod 边界校验、LLM 变体的 Knowledge Contract 安全模型、降级链等关键决策都有 ADR 支撑。**真正的问题不在代码，而在工程纪律：文档已与代码严重脱节（恰好违反了 AGENTS.md 自己的原则 2），仓库卫生差，且存在多处违背自家「不留兼容层 / 不留死代码」原则的残留。**

---

## 一、P0：文档与代码严重不一致（违反自家 AGENTS.md 原则 2）

这是本次审查发现的最大问题。AGENTS.md 明确要求「不允许出现代码已改、文档还停在旧形态的状态」，但当前状态正是如此：

### 1.1 pi-agent-core 的描述完全过时
- `docs/ARCHITECTURE.md` 三处声称「pi-agent-core 已移除」「当前无 Agent 依赖」「interviewAgent.ts 与 pi-agent-core 依赖已删除」（第 5、279、433 行）。
- **实际情况**：`src/agent/` 目录存在且完整（`interviewAgent.ts` / `runtime.ts` / `tools.ts` / `prompt.ts`，含测试约 800 行），`package.json` 仍声明 `@earendil-works/pi-agent-core` 依赖，README 已把「Agent 面试」宣传为第五页功能（ADR-034）。
- 后果：新 Agent 读到 ARCHITECTURE.md 会认为 agent 层不存在，做出错误决策。

### 1.2 题库组织描述与实际不符
- ARCHITECTURE.md：「题库按 6 大能力域一文件：questions/<domain>.json」「存量 409 题」，并描述了尚不存在的 `data/courses/` 课程槽位目录（ADR-041）。
- **实际情况**：`src/data/questions/` 是 28 个按主题命名的文件（`transformer.json` / `rag.json` / `cnn.json`…），共 **520 题**；`data/courses/` 目录不存在。
- README 同样过时：「题库驱动（7 类别）」——既不是 7 也不是 6。

### 1.3 处理建议
以代码为准修正 ARCHITECTURE.md / README；若 ADR-038/039/041 描述的目标形态（6 域文件重组、courses 槽位）尚未落地，应在 DECISIONS.md 标注「Proposed / Partially implemented」，而不是写成已完成事实。

---

## 二、P1：依赖与死代码（违反自家 AGENTS.md 原则 3）

| 问题 | 位置 | 说明 |
| --- | --- | --- |
| **未使用的依赖 `graphology`** | `package.json` | 全仓库无任何 import；同时已有 `@dagrejs/graphlib`，属重复引入的第二个图库，应删除 |
| **types.ts 兼容 re-export 层** | `src/types.ts` | ARCHITECTURE.md 自述「增量迁移阶段保留以兼容存量引用」——这正是 AGENTS.md 原则 3 禁止的历史包袱，应一次性收敛为 `z.infer` 单源后删除 |
| **预留空表** | `storage/db.ts` | 「memory/agentSessions 预留表」是占位死代码，「不保留死代码占位」应删 |
| **旧配置迁移逻辑** | `storage/settings.ts` | `loadConfig` 保留历史 `provider → providers` 迁移与静默丢弃——单机 local-first 应用无存量用户数据契约压力，可按原则 3 直接删除迁移分支 |
| **双份示例配置** | `src/config/sample-config.json` vs `docs/config.example.json` | 两处维护同一信息，注释里自己都解释了区别——建议合并为一份，docs 版本由构建生成或删除 |

---

## 三、P1：仓库卫生

1. **根目录被工作过程文档淹没**：`PR0-*.md`、`PR1-PR4-*.md`、`PR5-PR6-*.md`、`llm-replacement-analysis.md`、`pi-agent-core-alignment.md`、`concept-coverage-action-list.md`、`embedding-questions-preset.md`、`CHECKLIST.md`、`QUALITY_AUDIT.md`、`prompt.txt` 共 10+ 个文件堆在根目录。结论性内容应归档进 `docs/`（或 DECISIONS.md），过程稿删除。
2. **`ttt/` 草稿目录入库**：26 个日期命名的工作笔记（`Aug23_0.md`…）被 git 追踪，明显是 AI 协作草稿区，不应进版本库；空的 `temp/` 同理。
3. **提交信息不可读**：最近 5 条 commit 为 `addddddd / adddd / addd / addddd / addddd`，历史完全失去追溯价值。
4. **`.gitignore` 是 Angular 模板拷贝**：包含 `/angular`、`/.ng/` 等无关条目；更严重的是 **`package-lock.json` 被 ignore** ——应用仓库锁定依赖版本是基本要求，当前 lockfile 仅存在于本地，协作者/CI 无法复现构建。应从 `.gitignore` 移除并提交 lockfile。
5. **scripts 依赖 Node 24+ 原生 TS 直跑**（相对导入带 `.ts` 扩展名），但 `package.json` 无 `engines` 字段约束，低版本 Node 用户会得到难懂的报错。

---

## 四、P2：架构层面的观察项

### 4.1 App.tsx 是事实上的 god component
530 行、13 个 `useState`、持有全部会话状态（session / answers / grades / 计时器 / 页面路由 / copilot 开关）。五页切换靠 `page` state，**无 URL 路由**——不能深链、刷新丢状态、浏览器后退失效。建议：
- 引入轻量路由（或至少 hash 路由）管理五个页面；
- 将训练会话状态抽为 reducer / context hook（如 `useTrainingSession`），App.tsx 只留壳。

### 4.2 数据装配的双轨制
`data/questionBank.ts`（浏览器走 `import.meta.glob`）与 `scripts/*.ts`（CLI 走 fs 直读）是两条加载路径，靠约定保持一致。目前 coverage/blueprint 纯函数注入式设计缓解了这个问题，但题库规模继续涨时值得统一为构建期索引。

### 4.3 杂项
- `scripts/pilot/` 混有 `.mjs` 脚本与一次性 JSON 产物，与其余 TS CLI 风格不一，属过渡产物应清理。
- API key 存 localStorage 的 XSS 风险已在 README/ARCHITECTURE 充分披露，local-first 定位下可接受（维持现状即可）。
- README 与 package.json `name` 不一致（`ai-interview-trainer` vs 仓库名 `ai-interview-questions`），小事但易混淆。

---

## 五、做得好的（保持）

- 分层边界清晰且有成文约定（domain 无 React/网络依赖、ai 只依赖 domain 纯计算、schemas 不进业务层）。
- 测试策略正确：338 个纯逻辑用例，LLM 全 mock，覆盖 LLM 残缺 JSON 兜底等边界。
- LLM 变体的 Knowledge Contract 安全模型（LLM 只改表达、不变量由 domain 校验）是这个项目最值得肯定的设计。
- 技术栈踩坑沉淀详实（Monaco exports map、pi-ai SSE/CORS/credential 等条目质量很高）。
- fail-fast 装配期校验 + bracket 记法错误定位，对维护大 JSON 题库非常实用。

---

## 六、行动清单（按优先级）

| # | 动作 | 量级 |
| --- | --- | --- |
| 1 | 重写 ARCHITECTURE.md 中 pi-agent-core / 题库组织 / 题量的过时段落；README 类别数同步 | 小 |
| 2 | 删除未使用的 `graphology` 依赖 | 小 |
| 3 | 删除 `types.ts` 兼容层（引用方直接改 import schemas）、db.ts 预留表、loadConfig 迁移分支 | 中 |
| 4 | 清理根目录工作文档 → 归档 docs/ 或删除；`ttt/`、`temp/` 移出版本库并 gitignore | 小 |
| 5 | 修 `.gitignore`（去 Angular 条目、提交 package-lock.json）；加 `engines: { node: ">=24" }` | 小 |
| 6 | App.tsx 拆分会话状态 hook + 引入 URL 路由 | 大（可排期） |
| 7 | 合并双份示例配置 | 小 |
