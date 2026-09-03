你会收到一篇 AI / ML / LLM / Agent / AI Systems 技术文章。

任务：从文章中提取长期有面试价值的核心知识（Concept），生成高质量、可独立理解的选择题；只在值得降低记忆效应处配少量 Variant（表达变体，不增加诊断维度）。

> 内容规范见 [`docs/question-content-spec.md`](./question-content-spec.md)，
> 完整版生成指令见 [`docs/添加题库prompt.md`](./添加题库prompt.md)。
> 本精简版是完整版的导出子集（任务 + 硬规则 + 流程 + schema），用于 token 受限场景，与完整版同源——改了完整版需同步检查本文件。

## 核心原则

### 1. Concept-first

先识别高价值 Concept，再出题。

优先：

* 核心机制
* 高频知识
* 典型误解
* 工程判断
* trade-off
* debugging
* design / system-design

不要按文章段落平均出题，也不要为了数量制造低价值题。

每题默认：

* 1 个 Core Concept
* 0～2 个 supporting / prerequisite concepts

### 2. Canonical

对每个高价值 Concept，先识别值得独立训练的 `angle × cognitiveTask` 组合；每个有独立 assessment value 的组合建立一条 Canonical，作为该知识的标准题。

Canonical 必须：

* self-contained
* 有明确正确答案
* 有明确诊断价值
* 不依赖原文章
* 能长期复用

### 3. Variant = 表达变体

> **Variant = 同一 assessment contract 的表达 / 情境变体。**
> 与 `src/schemas/variant.ts` 一致：变体只存 `question` + `options`，
> `topic / angle / difficulty / concepts / answer / explanation` 全部由程序从 canonical 继承。

只有值得降低记忆效应的 Canonical 才生成少量 Variant；具体生成多少、保留多少由离线流程决定。

Variant 只能改：

* 换 framing（提问方式、句式、视角）
* 换 scenario（等价工程情境，不得增加推理步骤/背景负担/决策变量）
* 换问法
* 换选项表达（逐项重述，非同义替换）

Variant 必须保持：

* 相同 Core Concept
* **相同 `angle`**
* **相同 `cognitiveTask`**
* 相同 `difficulty`
* 相同核心技术结论
* 相同答案逻辑（第 N 个选项的真假属性一一对应）
* 相同选项数量
* 相同诊断目标

不得引入新的独立核心知识。

**需要换 `angle` 或 `cognitiveTask` → 新建一道 Canonical，不是生成 Variant。**

```text
Canonical A → mechanism / explain
  ├─ Variant A1 → mechanism / explain   ← 继承，不可改
  └─ Variant A2 → mechanism / explain
Canonical B → debugging / diagnose      ← 新建 canonical
Canonical C → tradeoff / evaluate       ← 新建 canonical
```

改写幅度：换词或换语序不够，会被近重复门禁丢弃（阈值由验证器决定）；
要做到「重述级」——看起来像重写过，技术结论一字不改。正确项之间不得是同事实重复/因果拆分；选项真假不得依赖“通常/一定/可能”措辞强弱。

### 4. 选择题

全部使用选择题：

* 4～6 个选项
* single：恰好 1 个正确
* multiple：至少 2 个正确
* answer 使用 0-based index

正确答案必须唯一、稳定。

错误选项应来自真实 misconception 或工程误判，而不是明显荒谬的答案。

选项应尽量：

* 同一抽象层级
* 长度和信息量接近
* 不通过“更长、更完整、更专业”暴露答案

每个选项必须独立、可理解，并具有稳定的技术含义，以便后续可以做轻量语义改写。

### 5. Architecture

RAG、Agent、MCP、Memory、Context Engineering、AI Systems、Security 等主题，在文章证据充分时优先考虑 scenario / design / system-design。

架构题必须有真实工程约束；不要只问“哪个方案更好”。system-design 需 3 个真实且相互独立、确实影响方案的约束，不足则不生成、不凑数。

### 6. Evidence

正确答案的核心依据必须来自：

* 文章可靠内容；或
* 文章明确提供的可靠专业背景。

不得编造 benchmark、性能数字、产品行为或关键技术事实。允许补 context 使题目自包含（enrichment），但不得新增决定答案的独立知识点（injection）。

### 7. Self-contained

题目必须脱离文章独立成立。

禁止：

* “根据本文”
* “文中提到”
* “作者认为”
* “上述方法”
* “前文所述”

需要背景时，把最小必要 context 写进题干。

### 8. Explanation

每题提供简短 explanation：

* 为什么正确
* 核心机制
* 必要时说明 trade-off / misconception

不要写成教程。

---

## 数量

每篇文章生成 5～13 个 Assessment Items。

数量由高价值知识密度决定。

同一个 Core Concept 有多少个有独立 assessment value 的 angle / cognitiveTask 组合，就建多少道 Canonical；Variant 数量由离线流程决定。

不要为了满足数量重复或制造低价值题。

---

## 最终检查

输出前检查：

1. 是否 self-contained？
2. 是否有明确 Core Concept？
3. 是否有明确诊断价值？
4. 正确答案是否唯一稳定？
5. 错误选项是否可信？
6. 是否存在明显 answer leakage？
7. 是否与其它题重复？
8. Variant 是否换了 framing / scenario / 问法，并做了重述级的选项改写？
9. Variant 的 `angle` / `cognitiveTask` / `difficulty` 是否与 Canonical 逐字相同？
10. Variant 是否仍然考察同一个 Core Concept、保持同一答案逻辑？
11. 是否需要换 angle / 认知任务？（是 → 应改为新建 Canonical）

发现问题，直接重写，不要解释。

---

## 输出格式

最终只输出 JSON Array，不输出任何额外文字。

```json
[
  {
    "id": "unique-question-id",
    "questionRole": "canonical",
    "variantOf": null,
    "category": "taxonomy-domain",
    "topic": "topic-id",
    "knowledgeId": "knowledge-id",
    "concepts": [
      "core-concept",
      "supporting-concept"
    ],
    "tags": [
      "concept-tag",
      "engineering-tag"
    ],
    "difficulty": "medium",
    "angle": "mechanism",
    "cognitiveTask": "explain",
    "question": "题目",
    "explanation": "解释",
    "formats": {
      "choice": {
        "type": "single",
        "options": [
          "选项1",
          "选项2",
          "选项3",
          "选项4"
        ],
        "answer": [2]
      }
    }
  }
]
```

Variant 使用：

```json
{
  "questionRole": "variant",
  "variantOf": "canonical-question-id"
}
```

其余字段与 Canonical 保持一致。

`difficulty` 只能是：

```text
easy
medium
hard
```

`angle` 只能是：

```text
definition
fundamental
mechanism
comparison
calculation
tradeoff
scenario
debugging
design
system-design
```

`cognitiveTask` 只能是：

```text
define
explain
mechanism
compare
apply
diagnose
evaluate
design
```
