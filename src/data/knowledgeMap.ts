// 知识点层加载：按领域拆分的静态 JSON（content source），与 questionBank 同构——
// import.meta.glob eager 合并；知识点是一等公民，题目只是它的 View（ADR-029）。
// 边界校验：Zod 负责形状，domain 负责跨引用不变量。

import type { KnowledgeNode } from '../types';
import { knowledgeNodeSchema } from '../schemas/knowledge';
import { formatSchemaErrorMessage } from '../schemas/errors';

const modules = import.meta.glob('./knowledge/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown[]>;

function validateKnowledgeNode(raw: unknown, file: string, index: number): KnowledgeNode {
  const result = knowledgeNodeSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      formatSchemaErrorMessage(result.error, `知识点校验失败 ${file}[${index}]`),
    );
  }
  return result.data as KnowledgeNode;
}

export const knowledgeNodes: KnowledgeNode[] = Object.keys(modules)
  .sort()
  .flatMap((file) =>
    (modules[file] as unknown[]).map((raw, i) => validateKnowledgeNode(raw, file, i)),
  );
