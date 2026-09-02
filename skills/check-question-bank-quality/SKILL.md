---
name: check-question-bank-quality
description: "检查题库质量。用户要求审查题库、校验题目、找坏题、检查覆盖率或评估题库内容时使用。"
---

# 检查题库质量

对本仓库题库做可复现、证据驱动的质量检查。默认只读；只有用户明确要求修复时才修改题目或规则。

**内容规范在 `docs/question-content-spec.md`**（本 skill 只写怎么查，不重复写"什么算好题"）。
判定一条内容问题时，引用 `spec §N`，不要在 skill 里另立一套说法。

## 检查顺序

质量分四层，逐层推进；上层通过不保证下层通过，下层问题不靠上层脚本自动判定。

### Level 1 — Contract（契约与结构）

1. 读取 `AGENTS.md`、`README.md`、题目 schema 和相关校验脚本，确认当前数据契约。
2. 运行基础检查：
   - `npm run validate:questions`
   - `npm run lint:bias`
   - `npx vitest run src/data/bank.test.ts`
3. 确认 `id` 唯一、题干无精确/规范化重复、`topic` 映射到知识节点、`angle` 合法、答案索引合法且不重复、choice 与 open 双形态答案一致、选项无占位/原题指代/不互斥内容。

### Level 2 — Heuristic（启发式分布与重复）

4. 运行 `npm run question:coverage` 与 `npm run question:audit`，统计题库规模、题型、难度、angle、topic × angle 密度、重复题和元数据覆盖率。
5. 用 `uv run --project analysis --extra analysis python analysis/question_analysis.py --semantic --json` 发现语义重复候选与概念簇过密信号（默认离线，不访问 Hugging Face）。
6. 启发式告警（长度偏差、topic × angle 过密、难度 × angle 不一致）是 soft 信号，需结合完整题目人工复核，不要直接当作事实错误。

### Level 3 — Content quality（内容质量，由 challenger + 人工负责）

7. 先跑 `npm run question:quality`（只读审计，非门禁）。它输出四类**词汇/统计嫌疑信号**，
   用来排人工复核的优先级；命中 ≠ 必须改写，不要据此新增硬门禁：
   - ① 正确项认知层级不一致 → 见 `spec §5`
   - ② 选项塞整段答案 → 见 `spec §5`
   - ③ 信息密度泄题 → 见 `spec §7`
   - ④ 多选只考一个判断（正确项互为复述）→ 见 `spec §2`

   **命中清单是候选集，不是结论。** 要回答「其中多少是真缺陷」必须抽检，且抽检要可复现：

   ```bash
   npm run question:quality -- --sample 20 --seed 20260902 \
     --review-sheet temp/quality-review-<date>.md
   ```

   `--sample` 按探测器分层（比例配额 + 最大余数法，**每层保底 1 条**，否则占比小的类会被漏掉），
   `--seed` 保证同种子必得同一样本，`--review-sheet` 导出含题干/选项/正确项标注与判定口径的复核表。
   人工判完后把「命中数 / 抽样数 / 精确率」写进报告，并按复核表里的分级下结论：
   **≥60% 可直接排优先级；40–60% 先收紧阈值；<40% 说明阈值太松，先调探测器，不要按清单改写。**
8. 对 Level 1/2 通过但内容上存疑的题（含上一步命中的），按以下维度做内容审查
   （这部分无法全自动，需 LLM challenger 或人工逐题判断）：
   - **Concept Scope**（`spec §1`）：每题是否只测一个可诊断的核心 Concept，没有混入多余独立主题？
   - **Answer Determinism**（`spec §2`）：正确答案在题干约束下是否唯一稳定，不依赖隐藏前提？
   - **Self-contained / Evidence Boundary**（`spec §3/§4`）：脱离来源文章能否作答？事实是否可追溯、未编造？
   - **Option Quality**（`spec §5/§6/§7`）：选项是否同决策层级？干扰项是否"差点就对"而非稻草人？
     正确项是否仅因更完整/信息量更大胜出？
   - **Diagnostic Value**：答错后能否较明确反映知识或能力缺口？
   - **工程推理 vs 术语记忆**：是否考理解/判断/应用而非文章原句记忆？产品绑定题是否改写为自包含工程场景？
9. 抽查失败项的完整题目、选项、答案、解析和开放题参考答案，不只看脚本摘要。
10. 按 P0/P1/P2 输出问题，**并按下面的生命周期表给出处置动作**：必须包含题目 id、文件、字段证据、
    影响、建议和**动作**（KEEP / REWRITE / DELETE / FIX REQUIRED / REVIEW）。

### Level 4 — Retrieval readiness（检索就绪，ADR-063/065/066）

题库同时是 Structured Knowledge RAG 的 corpus（`src/domain/knowledge/`）。结构、分布、内容都合格的题，仍可能"检索不到"或"被检索漏题"。

11. 跑检索就绪审计（纯 JSON 静态检查，无新依赖）：

    ```bash
    node -e "
    const fs=require('fs'),R=(d)=>fs.readdirSync(d).filter(f=>f.endsWith('.json')).flatMap(f=>JSON.parse(fs.readFileSync(d+'/'+f,'utf8')));
    const nodes=R('src/data/knowledge'),qs=R('src/data/questions'),ids=new Set(nodes.map(n=>n.id));
    const bad=nodes.filter(n=>!n.summary?.trim()||!n.required?.length||!n.misconceptions?.length);
    const clash=[];for(const a of nodes)for(const b of nodes){if(a!==b&&b.name.toLowerCase().includes(a.name.toLowerCase())&&a.name!==b.name)clash.push(a.id+' ⊂ '+b.id);}
    const orphan=[...new Set(qs.map(q=>q.topic))].filter(t=>!ids.has(t));
    const noMis=qs.filter(q=>!q.misconceptions?.length),noMap=qs.filter(q=>q.formats.choice&&!q.formats.choice.misconceptionMap);
    console.log('节点',nodes.length,'| 题目',qs.length);
    console.log('P0 无节点 topic:',orphan.join(', ')||'无');
    console.log('P1 字段缺失节点:',bad.map(n=>n.id).join(', ')||'无');
    console.log('P2 名称锚点冲突:',clash.join('; ')||'无');
    console.log('P2 缺 misconceptions:',noMis.length,'/',qs.length,'| 选择题缺 misconceptionMap:',noMap.length,'/',qs.filter(q=>q.formats.choice).length);
    "
    ```

    - **P0 无节点 topic**：该 topic 下所有题在 `topic` / `knowledge` 范围检索不到，`validate:questions` 之外无人兜底。
    - **P1 节点字段缺失**（`summary` / `required` / `misconceptions`）：知识文档正文主体缺失，Copilot 只能靠题面作答。
    - **P2 名称锚点冲突**：`detectQueryTopic` 用「id + name 最长匹配」锚定用户想问的节点，短 name 被长 name 包含会让短 query 误锚。
    - **P2 缺 `misconceptions`**：hint 模式下"用户错在哪"的唯一证据缺失，诊断价值归零。选择题 `choice.misconceptionMap` 同理（可用 `npm run backfill:misconceptions` 回填）。

12. 抽查"检索会漏题"的题（无法自动判定，逐题读）：
    - 题干或选项里出现只对正确项成立的限定词（唯一 / 总是 / 必须同时 / 唯一不会），hint 模式下等于报答案。
    - `explanation` 是"见上文 / 该题选 X"式指代表述：被 `[Q]` 引用出去即成废话。
13. 跑 `npx vitest run src/domain/knowledge/retrieve.test.ts src/application/conversation/knowledgeCapability.test.ts`，确认检索契约（投影 / 混合评分 / graph 1 跳扩展 / 四种答案安全模式 / scope 规划）未被数据改动破坏。

## 分级 → 动作映射（生命周期）

报告里每条问题必须落到**一个**动作。agent 不自行决定处置方式。

| 级别 | 动作 | 含义 | 约束 |
| --- | --- | --- | --- |
| P0 structural | **FIX REQUIRED** | 阻塞，必须修 | **不可 delete 绕过**——结构坏了就是坏了，删掉只是把洞藏起来 |
| P1 content | **REWRITE** | 保留核心 Concept，换认知任务/场景/干扰项 | 低价值**且**无可改造价值时才用下一行 |
| P1 content（无改造价值） | **DELETE** | 移除 | 必须在报告里写明「为什么不能 rewrite」；DELETE 后该题覆盖的 `topic × angle` 格子回到缺口状态，需同步告知 |
| P2 heuristic | **REVIEW** | 只记录，不改 | 不因启发式告警直接改题 |
| 无问题 | **KEEP** | 明确判定为保留 | 报告要能看出"查过且通过"，不只是"没出错" |

规模较大（> 20 题）的 KEEP/REWRITE/DELETE 执行，转 **curate-question-bank** skill。

### 闭环要求（最后一步，别漏）

重新检查后，报告里必须**逐条确认原问题已消失**——不是「改完了」，
是「原 P1 项重新审计后**不再命中**」。写法：

```text
- P1 `xxx-01`（Option Quality / spec §6）：REWRITE → 复核：重跑 question:quality 探测器 ②，
  原命中项已不在清单内 ✓
```

复核没过的要标 `REWRITE → 复核未通过`，回到待办，不要靠"已处理"糊过去。

## 自动化工具

- `npm run question:quality`：内容质量只读审计，输出四类嫌疑信号，用于排人工复核优先级。**软信号，非门禁**。
  加 `--sample N --seed S --review-sheet <file>` 做可复现的分层抽检并导出人工复核表（见 Level 3 步骤 7）。
- `npm run question:audit`：运行无第三方依赖的 Python 离线审计，输出规模、分布、覆盖率和分级问题。
- `python analysis/question_audit.py --json --output reports/question-audit.json`：生成机器可读报告；Python 报告是辅助分析，TypeScript/Zod 仍是数据契约唯一来源。
- `uv run --project analysis --extra analysis python analysis/question_analysis.py --semantic --json`：使用仓库内 ARM64 ONNX INT8 模型发现语义重复和 embedding 概念簇；默认离线，不访问 Hugging Face。
- 审计报告中的 P0 表示结构性阻塞，P1/P2 仍需结合完整题目人工复核，不要把启发式告警直接当作事实错误。
- 如果发现 topic × angle 覆盖缺口且用户要求补题，转 **fill-coverage-gap** skill 处理，不在本 skill 内直接生成新题。

## 必查项目

- `id` 唯一，题干无精确或规范化重复。
- `topic` 映射到知识节点，`angle` 属于合法枚举。
- `single` 恰好一个答案，`multiple` 至少两个答案，答案索引合法且不重复。
- choice 与 open 双形态的答案契约一致。
- 选项无占位文本、原题指代、明显重复或不互斥内容。
- explanation 与正确答案一致，题干无需阅读原题即可作答。
- topic × angle 覆盖、难度梯度和题量偏斜。
- 厂商、API、模型和认证题的时效风险。
- 文章题的产品绑定风险：移除厂商/产品名后是否仍是可迁移的工程问题；"功能名是什么/主要做什么"属于 P1 内容质量问题，不因 schema、答案索引或测试通过而放行。
- 来源框架前置知识风险：题干是否出现"符合某 Lens/框架/考纲"并把它当作判断标准；这类题即使答案技术上正确也属于 P1，必须改写为给出目标、约束和验收标准的自包含工程场景。
- `source`、`lastVerified` 等字段若不存在，明确说明这是治理缺口，不要虚构来源。
- `topic` 有对应知识节点；该节点 `summary` / `required` / `misconceptions` 非空。
- 节点 `name` 不与其它节点互为子串（检索锚点唯一性，见 Level 4）。
- 题干与选项不含只对正确项成立的限定词——hint 模式下等于泄露答案。
- `explanation` 自包含：被 `[Q] <题干>` 单独引用时仍能自证。
- `misconceptions` 与 `choice.misconceptionMap` 的覆盖率（hint 模式的诊断证据来源）。

## 质量判断原则

- 结构通过不等于内容正确；测试全绿时仍要报告未被自动校验覆盖的风险。
- 题库审查必须抽查内容是否考察工程推理，而不是文章术语记忆；对产品绑定题优先改写为目标、约束、机制和权衡明确的场景题。
- 先修复会影响判分的答案冲突、错误索引和不可判定题，再补覆盖缺口。
- 检索走结构化路线（lexical + metadata + graph 1 跳），**不引入 embedding / 向量库 / reranker**（ADR-063 §13，Phase 2 再评估）；发现"检索不准"时先查节点字段与锚点，不要靠加向量库解决。
- 不要仅凭关键词命中断言语义正确；需要人工复核或独立事实来源。
- 选项长度偏差是启发式信号，soft 命中不要直接当作错误。
- 不要把 `subtopic` 缺失自动判为质量错误，除非产品明确依赖它。

## 存量题改写契约（REWRITE 执行标准）

当 `question:curate` 把一题标为 `rewrite` 时，**不要整题重新生成**——那样极易再生一道重复题。先定改造目标，再改写。

### 先定目标，再改写
- 保留核心 Knowledge：`topic` 不变，必要时只换 `angle`；不要改成一道全新同类题。
- 优先改 Cognitive Task，而非重出一道同类题。例：`kv-cache` 已有 4 道 `definition` → 目标 `angle` 改成 `tradeoff`、`difficulty` 改 `medium`，核心 Concept 不变。
- **只换 `angle` 的前提是：该题内容本身已经属于目标 angle（只是字段标错）。** 若内容是低价值 `definition` 回忆题，必须改写题干/选项/解释让它真正变成 mechanism/comparison/… 题，`angle` 随内容自然改变；**绝不允许只把标签从 `definition` 改成 `mechanism` 而内容不动**——那只是在骗 `topic×angle` 密度计数器，没有提升诊断价值。改前务必通读题目内容，逐题判断是「标错」还是「内容低价值」。
- 计划里的 `suggestedAngle` 作为首选目标；与 `fill-coverage-gap` 的题量控制一致：同 `topic×angle` 已有 ≥3 题时，新角度须证明新认知任务 / 场景 / misconception / 难度层次。

### 改写内部 Prompt（10 条硬约束）
> 你正在维护一个已有的 AI/ML 面试题库。任务不是简单换句话说，而是在保留核心知识的前提下提高面试价值与诊断价值：
> 1. 保留原题真正考察的核心知识。
> 2. 不得与已有题重复。
> 3. 若原题是低价值 `definition`，优先转 `mechanism` / `comparison` / `tradeoff` / `scenario` / `debugging`。
> 4. 保证正确答案唯一。
> 5. 错误选项必须来自真实技术误解或条件错配。
> 6. 所有选项处于相同决策层级和粒度。
> 7. 不得通过答案长度、完整程度、专业术语数量泄露答案。
> 8. 不要为增加难度而加入无关知识。
> 9. 保持题目 self-contained。
> 10. `explanation` 必须说明核心原理和关键误区。

### 改写后
重新跑 `npm run question:review -- <id>` 与 `npm run validate:questions`，确认无长度失衡、无同 cell 过密、答案唯一；若改动了 `topic` / `misconceptions` / `explanation`，再跑 Level 4 的检索就绪审计与知识检索用例。

## 修改后的验证

如果用户要求修复：

1. 最小化修改，保留题目 id 和现有数据格式。
2. 题目内容变更后重新运行上述专项检查。
3. 再运行 `npm run typecheck` 和 `npm run test`。
4. 用 `git diff --check` 检查格式。
5. 最终报告修复项、剩余风险和未处理的低优先级问题。
