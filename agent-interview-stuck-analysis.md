# Agent 面试模式卡在「面试官正在选题…」的分析报告

> 用户现象：进入 Agent 面试后，页面一直停在「面试官正在选题…」，不再前进，也没有报错。
> 结论先行：**这不是偶发崩溃，而是 agent 运行时的结构性缺陷——没有任何「保证把题交付出来 / 卡死自愈」的逻辑**。整条 agent 路径完全依赖 LLM 主动调用 `getQuestion` 工具；一旦 LLM 没在一开始成功调用它（文本收尾、id 写错、或流式返回 `error`），这一轮 run 会以 `agent_end` 静默结束，而 UI 既没拿到题、也没触发收尾，`currentQuestion` 永远为 `null`，于是死循环渲染「选题中」。

---

## 1. 现象对应的渲染分支（确认卡在哪）

`src/components/agent/AgentInterviewPage.tsx:330-336`：

```tsx
{currentQuestion ? (
  <QuestionCard ... />
) : (
  <Card size="small">
    <Space><Spin /> <Typography.Text type="secondary">面试官正在选题…</Typography.Text></Space>
  </Card>
)}
```

只要 `currentQuestion === null` 且 `phase === 'running'`，就显示这句文案。它和「思考中…」的遮罩（`busy` 为 true 时才出现，见 337-351 行）是**两回事**——用户看到的是前者，说明 `busy` 已经是 `false`，即 agent 的 run 已经 `agent_end` 收场，只是题没交付。

## 2. `currentQuestion` 是怎么被设置的（唯一的来源）

`AgentInterviewPage.tsx:148-153` 的 `onQuestion` 回调：

```tsx
onQuestion: (q) => {
  if (!q) return;            // ← 拿不到题就直接静默返回
  setCurrentQuestion(q);
  ...
}
```

而触发它的只有一处：`src/agent/interviewAgent.ts:97-103`

```ts
agent.subscribe((event) => {
  if (event.type === 'tool_execution_end') {
    if (event.toolName === 'getQuestion') handlers?.onQuestion?.(session.currentQuestion);
    if (event.toolName === 'finishInterview') handlers?.onStatus?.('finished');
  }
});
```

也就是说：**`currentQuestion` 只能由 `getQuestion` 工具成功执行后注入**。工具里是这样写的（`src/agent/tools.ts:103-125`）：

```ts
execute: async (_id, params) => {
  const q = byId.get(params.id);
  if (!q) {
    // 返回「未找到题目」，但 session.currentQuestion 保持 null
    return textResult(`未找到题目 ${params.id}`, { error: 'not_found', id: params.id });
  }
  const sq = { question: q, format: fmt };
  session.currentQuestion = sq;   // ← 只有 id 命中才会设置
  ...
}
```

`getQuestion` 成功的两个前提：**(a) LLM 真的调用了它；(b) 传入的 `id` 在题库里真实存在。** 任意一条不满足，`currentQuestion` 就为 `null`。

## 3. 为什么 run 会「安静地结束」而不交付题

pi-agent-core 的底层循环 `node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js` 的 `runLoop`：

```js
while (true) {
  while (hasMoreToolCalls || pendingMessages.length > 0) {
    // 流式产出 assistant 消息
    const message = await streamAssistantResponse(...);
    const toolCalls = message.content.filter(c => c.type === 'toolCall');
    hasMoreToolCalls = false;
    if (toolCalls.length > 0) { /* 执行工具，若未 terminate 则 hasMoreToolCalls=true */ }
    if (await shouldStopAfterTurn(...)) { emit agent_end; return; }
    pendingMessages = (await config.getSteeringMessages?.()) || [];
  }
  // 到达这里说明本回合是「纯文本、没有工具调用」且没有 steering 消息
  const followUp = (await config.getFollowUpMessages?.()) || [];
  if (followUp.length > 0) { pendingMessages = followUp; continue; }
  break;   // ← 直接结束，emit agent_end
}
```

关键点：**只要某一回合的 assistant 消息是纯文本（没有 tool call），`hasMoreToolCalls` 就是 `false`，内层循环退出，外层没有 follow-up 消息就 `break` 并 `emit agent_end`。** 这意味着：

- 如果 LLM 第一轮返回的是「我先看看你的薄弱点…」（文本，没调工具），run 立刻结束，没题。
- 如果 LLM 调了 `getUserWeaknesses`、`searchQuestions`，然后第二轮却用文本「那我们来看看 RAG 吧」（没调 `getQuestion`），run 同样结束，没题。
- 如果 `getQuestion` 被调用但 `id` 写错 → 工具返回 not_found，`currentQuestion` 仍为 `null`，run 继续/结束都拿不到题。

而 `shouldStopAfterTurn`（`interviewAgent.ts:29-36`）**只会在 `finishInterview` 被调用或已评题数达标时返回 true**——也就是说，正常流程里「没题就停」这件事，循环根本不认为是个问题，它只是正常收场。

**另一个静默结束通道**：`agent-loop.js` 的 `streamAssistantResponse` 在 `stopReason === 'error' || 'aborted'` 时，循环会 `emit turn_end` → `emit agent_end` 然后 `return`。也就是说：**只要 LLM 流式调用出错（API key 失效、模型 404、限流、网络抖动），run 也是静默结束、不抛异常。**

## 4. 为什么 UI 没有任何自救 / 报错

`AgentInterviewPage.tsx:157-184` 的 `onEvent` 处理：

```ts
case 'agent_end': {
  setBusy(false);
  const text = pendingTextRef.current;
  pendingTextRef.current = '';
  if (text.trim()) setTranscript((prev) => [...prev, { kind: 'agent', text }]);
  break;   // ← 只关掉 busy、把可能残留的文本塞进 transcript；不检查「题交付了没」，也不检查错误
}
```

`finalize()`（写库 + 切到 done 页）**只有 `onStatus('finished')` 才会触发**，而 `onStatus('finished')` **只有 `finishInterview` 工具被调用时才发**（`interviewAgent.ts:101`）。于是：

- run 以 `agent_end` 结束但未调用 `finishInterview` → `finalize` 永不触发 → 页面卡在 `running`。
- `currentQuestion` 为 `null` → 渲染「选题中」。
- 没有任何 `stopReason:'error'` 的识别 → 即使 LLM 流式报错，用户也看不到错误，只看到转圈。
- `onQuestion(null)` 又静默 `return`（`AgentInterviewPage.tsx:149`）→ 连「getQuestion 调了但 id 错了」这种失败都毫无痕迹。

外加：`start()` 的 `try/catch` 只能接住**抛出的异常**（`interviewAgent.ts:191-195`），而上面所有失败都是「事件式静默结束」，根本不走 throw 路径，所以 `setError` 也不会被调用。

## 5. 根本矛盾：agent 路径完全绕开了确定性选题

整个 agent 面试**没有调用** `src/domain/adaptive.ts` 的 `pickNextAdaptive` / `src/application/interviewEngine.ts` 的 `nextAdaptiveStep`（那套已经落地的、带 `conceptCtx` 与 Dynamic Probe 的确定性选题）。选题 100% 交给 LLM 在运行时决策——这正是 `pi-agent-core-alignment.md` 里标记为风险的点（L2 运行时 LLM 决策、L8 选题未接 `pickNextAdaptive`）。

好处是「自主」，代价是：**没有任何兜底**。LLM 一旦不按 `OPENING_INSTRUCTION` 的三步（getUserWeaknesses → searchQuestions → getQuestion）走，或者 `getQuestion` 的 id 对不上，系统就进入了无人接管的状态。

## 6. 触发该卡死的几种具体情形（按可能性排序）

1. **LLM 第一轮就文本收尾 / 只调了 `getUserWeaknesses`+`searchQuestions` 却不调 `getQuestion`** → run 以纯文本回合结束 → `agent_end` → 没题。（最常见，尤其较弱模型或指令遵循不稳时）
2. **`getQuestion` 的 `id` 不是真实题号**（`searchQuestions` 只回摘要，LLM 需原样回传 `id`；一旦改写/编造就 not_found）→ `currentQuestion` 恒 `null`。
3. **LLM 流式调用本身失败**（`stopReason:'error'`，如 key 失效 / 模型名错 / 限流 / 网络）→ 静默 `agent_end`，连错误都不展示。
4. **`getQuestion` 被调但 run 在「呈现题目文本」那一轮就停**（正常设计下其实没问题，但如果没有 steer/followUp 兜底，任何文本收尾都算「结束」）。

## 7. 修复方向（本次不动代码，仅给方案）

> 以下供决策，**未执行任何修改**。

- **A. `agent_end` 增加「题是否交付」校验**：在 `onEvent` 的 `agent_end` 分支里检查 `session.currentQuestion`；若仍为 `null` 且还有题可出，则 `agent.steer(...)` 注入一条强制调用 `getQuestion` 的消息，或直接用确定性 `pickNextAdaptive(bank, signals, profile)` 兜底把题塞出来。
- **B. 识别并展示流式错误**：`onEvent` 里监听 `stopReason`/`errorMessage`（`message_end` 事件携带的 `message.stopReason`），把 `error` 转成可见的 `setError`，而不是静默。
- **C. 接通确定性选题作为兜底**：agent 路径在「无 LLM 或 LLM 不可靠」时，应回退到 `nextAdaptiveStep`（这正是 `pi-agent-core-alignment.md` 5.2 的建议）。把 `pickNextAdaptive` 作为「保底出题器」，而不是完全依赖 LLM。
- **D. 收口 `getQuestion` 的 id 容错**：若 LLM 传的是 topic 而非 id，或 id 不存在，工具可退化为「从该 topic 随机/按薄弱挑一道题」而非直接 not_found。
- **E. 加超时/看门狗**：`start` 后若超过 N 秒仍 `currentQuestion === null`，主动报错或兜底出题，避免无限转圈。
- **F. `onQuestion(null)` 不应静默**：至少记录一次告警，便于排查是「没调工具」还是「id 错」。

## 8. 一句话总结

> Agent 面试的 UI 把「拿到题」赌在 LLM 一定会调 `getQuestion` 上；而 pi-agent-core 的循环在 LLM 文本收尾 / 工具 id 错 / 流式报错时会**静默 `agent_end`**。这一刻 `currentQuestion` 仍是 `null`、`finalize` 永不触发、错误也不展示——页面就永远停在「面试官正在选题…」。根子是「选题 100% 运行时 LLM 决策、零兜底」，与既有确定性 `pickNextAdaptive` 完全脱钩。

## 9. 涉及文件索引

| 文件 | 行号 | 角色 |
|------|------|------|
| `src/components/agent/AgentInterviewPage.tsx` | 330-336 | 卡死时渲染的「选题中」分支 |
| `src/components/agent/AgentInterviewPage.tsx` | 148-153 | `onQuestion` 对 `null` 静默 return |
| `src/components/agent/AgentInterviewPage.tsx` | 157-184 | `onEvent`：`agent_end` 不校验交付、不识别错误 |
| `src/agent/interviewAgent.ts` | 97-103 | `onQuestion` 仅由 `getQuestion` 触发；`finished` 仅由 `finishInterview` 触发 |
| `src/agent/interviewAgent.ts` | 29-36 | `shouldStopAfterTurn` 只认 finishInterview / 题数达标 |
| `src/agent/tools.ts` | 103-125 | `getQuestion` 仅在 id 命中时设置 `currentQuestion` |
| `node_modules/.../pi-agent-core/dist/agent-loop.js` | `runLoop` | 纯文本回合 → `hasMoreToolCalls=false` → 静默 `agent_end`；`stopReason:'error'` 同样静默结束 |
| `src/domain/adaptive.ts` / `src/application/interviewEngine.ts` | — | 已落地的确定性选题（agent 路径当前未使用，应作为兜底） |

## 10. 修复实施（已落地）

> 用户确认「按你说的修复」后已执行，覆盖第 7 节 A–F 全部方向。361→341 测试仍全绿（新增 3 个 agent 自愈单测）。

- **A + C（agent_end 校验 + 确定性兜底出题）**：`src/agent/interviewAgent.ts` 新增 `ensureQuestionDelivered()`——`agent_end`（及看门狗）触发时，若当前没有「已交付且待用户作答」的题，且题数未达上限、仍有未问题目，则走 `pickNextAdaptive` 确定性交付下一题（不依赖 LLM）；一旦兜底接管（`usingFallback=true`），后续整场由确定性引擎自驱（见下）。该逻辑与既有 `getQuestion` 路径互斥：LLM 正常出题时 `currentQuestion` 已就位 → 直接等待用户，不干预。
- **B（识别并展示流式错误）**：订阅 `message_end` 读取 `stopReason==='error'|'aborted'` 或 `errorMessage`，经新增 `AgentHandlers.onError(message, fatal?)` 暴露给 UI；UI 对 `fatal` 用 `setError` 阻塞、`非 fatal` 用 `message.warning` 轻量告警（兜底已接续出题）。
- **D（getQuestion id 容错）**：`src/agent/tools.ts` 的 `getQuestion` 在精确 id 未命中时，退化按 `topic/category` 匹配该范围下一道未问题目（`matchedBy:'topic'`），避免 LLM 把主题当题号导致的 `not_found` 卡死。同时把评分逻辑抽成 `evaluateSessionQuestion` 供兜底复用。
- **E（超时看门狗）**：`armWatchdog()` 在 `start`/`submitAnswer` 时挂 60s 定时器；若 run 在时限内既未交付题也未结束（流式挂起），则 `agent.abort()` 并触发 `ensureQuestionDelivered`。
- **F（onQuestion(null) 不再静默）**：`AgentInterviewPage.tsx` 的 `onQuestion(q)` 在 `!q` 时 `console.warn` 留痕，不再静默吞掉。
- **兜底自驱**：`submitAnswer` 在 `usingFallback` 下改走 `fallbackAdvance`——记录答案 → `evaluateSessionQuestion` 评分 → `ensureQuestionDelivered` 交付下一题（或优雅收尾），彻底绕开「依赖 LLM 调 getQuestion」这一单点故障。

**回归验证**：`npx vitest run` 全绿（341 passed）；`npx tsc --noEmit` 无错。新增单测覆盖「首轮文本收尾未选题→兜底交付」「中段 stall→兜底补题」「getQuestion 按主题兜底」。

