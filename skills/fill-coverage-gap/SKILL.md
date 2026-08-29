---
name: fill-coverage-gap
description: "补齐题库覆盖缺口。用户要求分析题库缺口、生成补题蓝图、按优先级补题或提升 topic × angle 覆盖率时使用。"
---

# 补齐题库覆盖缺口

把"发现缺口"到"写入合格新题"串成一个可重复流程，覆盖索引统一为 `topic × angle`（ADR-043）。默认按用户要求的数量处理，不批量生成未经检查的题目。

## 流程

1. 运行 `npm run question:coverage`，读取覆盖矩阵和补题建议（按 P0/P1/P2 优先级排序）。
2. 与用户确认要处理的范围：哪些 topic、处理几条建议、只报告还是要实际补题。
3. 运行 `npm run question:blueprint -- <limit>`，为选定数量的缺口生成蓝图 JSON。每条蓝图包含：
   - 对应知识节点的 `purpose` / `expectedConcepts`（约束这道题该考什么）
   - `variantCandidateIds`：同 topic 下已有题的 id，用于判断"复用/改写变体"是否比"从零生成"更合适
4. 对每条蓝图，按优先级决策：
   - 若 `variantCandidateIds` 中已有题可以通过调整 angle/难度覆盖该缺口，优先建议变体而不是新写一题。
   - 否则起草新题，遵守蓝图里的 `purpose` 和 `expectedConcepts` 约束，不要跑题到其他知识点。
5. 起草完成后，交给 **add-question-to-bank** skill 的完整校验与写入流程（题目契约、去重、语义重复检查、typecheck、test）。本 skill 不重复实现写入逻辑。
6. 补题后重新运行 `npm run question:coverage`，确认目标缺口确实被填上，且没有引入新的 topic × angle 失衡。

## 优先级判断

- P0 建议表示知识节点在该 angle 上完全没有题，优先处理。
- P1/P2 表示已有题但数量或角度分布不均，价值判断需要结合该 topic 的实际面试重要性，不要机械地"每个缺口都补一题"。
- 不要为了让矩阵数字好看而生成低价值、生拼硬凑的题目；覆盖率是信号，不是目标本身。

## 边界

- 蓝图的 `purpose`/`expectedConcepts` 来自知识节点，起草新题必须尊重这个约束，不能自行扩大考察范围。
- 不引入概念层或额外索引维度（ADR-042/043 已明确废弃概念层，覆盖索引只有 `topic × angle`）。
- 最终报告需包含：处理了哪些缺口、新增/变体题的 id、剩余未处理的建议及其优先级。
