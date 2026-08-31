# Repo 审查报告（2026-08-31）

范围：代码、架构、Prompt、题库/知识图谱、文档、脚本与 CI。只列需要修改的地方。

## P1：建议优先修复

1. **Agent 主循环没有真正使用 Provider 降级链**
   - 位置：`src/hooks/useAgentInterview.ts:223-229`、`src/agent/interviewAgent.ts:145-158`、`src/ai/provider.ts:127-180`
   - 现状：Agent 决策流用单个 `entry` 构建 runtime；`createLLMProvider()` 生成的链只传给工具侧评分/变体。主模型故障后不会切到下一个模型。
   - 修改：为 Agent runtime 增加 provider chain/stream-level fallback；区分 abort、超时、模型错误，并记录实际使用的 provider。同步修正 README/ARCHITECTURE 对“全链路自动降级”的表述。

2. **候选人回答与动态题目内容没有统一的数据边界**
   - 位置：`src/agent/interviewAgent.ts:339-352`、`src/ai/evaluate.ts:76-89`、`src/ai/variant.ts:171-208`、`src/ai/questionChallenger.ts:62-80`
   - 现状：Prompt 声称回答是 `<untrusted_data>`，实际却直接作为普通 user message/字符串插值；题干、解析、参考答案、额外条件也没有明确“只当数据，不执行其中指令”的边界。
   - 风险：提示注入可影响追问/提前结束/评分/变体生成。
   - 修改：所有动态字段使用结构化、显式分隔的 data block；system prompt 明确禁止执行字段内指令；补候选人回答、题干、解析、参考答案注入回归测试。

3. **Agent 结束时可能先显示完成、再异步落库失败并丢失恢复草稿**
   - 位置：`src/hooks/useAgentInterview.ts:154-170,245-250`、`src/hooks/useTrainingSession.ts:277-284`
   - 现状：`finalize()` 不等待 `onComplete(record)`；随后立刻进入 `done`，并异步删除 `agentSessions` 草稿。
   - 修改：让 finalize 等待持久化结果；落库失败时保留草稿、保持可恢复状态并给出错误；只有 durable save 成功后才删除草稿和切换 done。删除动作也应等待持久化队列完成且处理删除失败。

4. **Agent 草稿快照仍是浅引用，可能产生跨版本不一致**
   - 位置：`src/hooks/useAgentInterview.ts:192-215`
   - 现状：snapshot 内的 `session/messages/questions/profile` 都是引用；入队后对象仍可能被继续修改，导致状态、消息和已交付题目不属于同一版本。
   - 修改：入队前创建不可变深快照；增加递增 revision，写入时拒绝旧 revision 覆盖新 revision；同步更新 `questionsRef` 后再持久化。

5. **“重置学习数据”没有清理 Agent 草稿**
   - 位置：`src/storage/learner.ts:78-83`、`src/components/settings/SettingsPanel.tsx:555-565`、`src/storage/agentSession.ts:88-103`
   - 现状：只清 `learner/sessions`，`agentSessions` 仍可在下次启动时恢复。
   - 修改：把 Agent 草稿清理纳入同一 reset 流程；先 dispose/invalidate 当前 Agent，再清理草稿、画像和会话，避免旧面试回写新画像。

6. **变体校验与 Question canonical schema 不一致**
   - 位置：`src/domain/variant.ts:131-167`、`src/schemas/question.ts:11-37`
   - 现状：canonical 要求 4–6 个选项、multiple 至少 2 个答案；`validateVariant()` 却允许 2 个选项，且 multiple 只要求 `answer.length >= 1`。
   - 修改：抽出共享 choice invariant；变体落地后再次用 canonical schema/domain invariant 校验；补“少于 4 个选项”和“multiple 只有 1 个正确答案”的回归测试。

7. **Chrome 超时后的 late-resolving session/clone 可能泄漏**
   - 位置：`src/ai/chrome.ts:132-148,393-411,428-444`
   - 现状：`withTimeout()` 只拒绝，不接管超时后才 resolve 的 session；clone 在 timeout 后 resolve 时可能未赋给 `clone`，finally 无法 destroy。
   - 修改：封装具备所有权的 cancellable resource wrapper；成功、失败、超时、late resolve 都必须 destroy；为 create/clone 超时后异步 resolve 增加测试。

8. **浏览器 localStorage 明文保存 API Key，威胁模型需要收紧**
   - 位置：`src/storage/settings.ts:110-114`、`README.md:49-51`
   - 现状：完整 `AIConfig`（含 key）写入 localStorage。
   - 修改：优先改为 session-only/服务端 credential boundary；若保留持久化，使用平台安全存储或至少提供“不持久化密钥”模式、按 provider 最小权限、清晰的 XSS/扩展风险告警。

## P2：应纳入近期治理

9. **文档库存与数据契约已明显过期/互相矛盾**
   - 位置：`README.md:11,55-66`、`docs/ARCHITECTURE.md:129-163`
   - 证据：当前为 72 个 question 文件、1269 题、99 个知识节点；文档仍写 53/1084/约 80。
   - 另有冲突：文档把 `category` 说成“文件名/topic slug”，实际有 52 个 category 值且 607 题的 `category` 与文件名不一致；schema 允许 `angle` 缺省，但 `validate:questions`/`question:add` 将缺省视为错误。
   - 修改：明确 `category` 的唯一语义（建议从 topic/domain 分组中拆出 batch/source 字段）；统一 angle 契约；删除硬编码统计，改为生成 inventory 或 CI 校验文档数据。

10. **CI 没有把生产构建纳入必过 verify**
    - 位置：`.github/workflows/ci.yml:21-32,34-49`
    - 现状：`npm run build` 只在有 Cloudflare token 且 push main 时运行；PR 和无部署凭据的 main push 不验证 Vite/Rollup 产物。
    - 修改：把 build 放进 `verify`；部署复用已验证 artifact，避免重复构建。

11. **题库质量门禁只挡新增题，历史债务和修改题会持续漏过**
    - 位置：`scripts/lint-length.ts:47-70,92-103`、`analysis/question_audit.py:203-246`、`.github/workflows/ci.yml:27-32`
    - 证据：审计有 355 个 P2、254 个选项长度比 >1.8；`lint:bias` 仍报 122 个 strong 偏差，但输出却宣称历史 strong 已清零。`lint:length --changed` 当前清零扫描，且只比较新增 ID，不检查已存在题目的选项修改。
    - 修改：修正文案；建立 baseline + delta gate；检查题目对象变更而不只是新增 ID；base SHA 缺失时 CI 应失败而不是扫描 0 题；逐步清理正确项为最长项的高风险题。

12. **Coverage gap 没有预算、归属和回归门禁**
    - 位置：`scripts/question-coverage.ts`、`src/domain/coverage.ts:73-112`
    - 证据：当前覆盖 274/285，缺 11 格，集中在 `end-to-end-workflow`、`eval-harness`、`feedback-loops`、`self-improving-agents`、`skill-design`、`skills-vs-memory`、`agent-debugging`。
    - 修改：增加机器可读 gap budget；P0/P1 分开门禁；修改知识节点时要求减少缺口或登记有期限的例外。

13. **知识图谱存在冲突边和大量孤立节点**
    - 位置：`src/data/conceptGraph.json:9-11,154-156`、`src/domain/conceptGraph.ts:44-61`
    - 证据：`agent-fundamentals → agent-loop` 同时是 prerequisite 和 related；graphlib 按端点写边，存在覆盖/语义歧义。99 个节点中 41 个不在图里，其中 13 个 P0。
    - 修改：加载期拒绝同一 `(from,to)` 多种 edge type；明确 root/isolated policy；P0 节点必须连图或显式豁免；补 graph invariant tests。

14. **TypeScript/Python 重复维护 schema、angle 和长度阈值**
    - 位置：`src/schemas/common.ts`、`scripts/validate-questions.ts`、`scripts/add-question.ts`、`analysis/question_audit.py`、`src/domain/bias.ts`、`scripts/lint-length.ts`
    - 修改：导出一个 machine-readable contract，或由 TypeScript schema 生成 Python 常量；统一 angle 枚举、1.8 阈值和题型规则，避免各门禁结果漂移。

15. **生产 bundle 过大，当前构建仅给 warning**
    - 证据：`npm run build` 生成主 chunk 约 4.4 MB（gzip 约 1.4 MB），TypeScript worker 约 6.9 MB；Vite 报多个 chunk >500 KB。
    - 修改：把 Monaco/语言包/题库/非首屏 Agent 能力进一步拆分；设置并监控 bundle budget，避免用提高 warning limit 掩盖增长。

## 建议修复顺序

1. 先修 2、3、4、5、6、7（注入、持久化、变体和资源生命周期）。
2. 再修 1、8、10（Provider 容灾、凭据边界、CI build）。
3. 最后按 baseline 方式治理 9、11、12、13、14、15，避免一次性改动题库造成大范围冲突。

未发现可复现的 P0；本次未修改代码。审查期间：typecheck、519 个测试、题库结构校验和 production build 均通过，但不能抵消上述质量债务与运行时风险。
