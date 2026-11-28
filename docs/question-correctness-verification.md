# 题目事实正确性核验

结构校验与语义质量审查不能证明技术事实正确。事实核验由独立求解、来源证据和逐项裁定组成。核验器不改写题库，只生成报告。

## 证据文件

先从题目声明的来源实际取得相关正文，保存成 JSON：

```json
{
  "materials": [
    {
      "id": "snowflake-dynamic-tables-doc",
      "url": "https://docs.snowflake.com/en/user-guide/dynamic-tables/overview",
      "title": "Dynamic Tables",
      "content": "从该来源实际摘取、足以核对题目主张的正文内容。"
    }
  ]
}
```

`materials[].id` 必须与题目的 `source.materialId` 或 `source.relatedMaterials` 完全一致。不要把模型记忆、搜索摘要或未读过的页面内容作为证据摘录。

## 运行

```bash
npm run questions:manage -- verify --ids=<id1,id2> --evidence-file=reports/question-evidence.json
npm run questions:manage -- verify --topic=<knowledge-node-id> --limit=20 --evidence-file=reports/question-evidence.json --gate
```

核验器先只展示题干和选项，让模型独立解题；随后才提供题库答案、解析和来源摘录，检查每个选项、开放题参考答案和解析。来源引文必须逐字存在于提供的材料中，并且来源 ID 必须登记在题目 metadata 内。

## 裁定

- `VERIFIED`：独立解题与题库一致，选项答案和解析均得到来源支持，引用可精确匹配。
- `INCORRECT`：来源明确反驳题库答案、选项判定或解析中的关键事实。
- `REVIEW`：独立求解与题库不一致、存在条件依赖、缺失前提或模型无法给出确定裁定。独立模型分歧本身不直接判定题库错误。
- `NEEDS_EVIDENCE`：没有对应来源、引用无法匹配或引用了未登记的材料。
- `ERROR`：模型调用或输出结构失败。

默认只输出报告。添加 `--gate` 后，只有本批所有题目均为 VERIFIED 才返回成功。核验报告不会自动修正或删除题目。
