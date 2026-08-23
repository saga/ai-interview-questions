// 知识点层加载：按领域拆分的静态 JSON（content source），与 questionBank 同构——
// import.meta.glob eager 合并；知识点是一等公民，题目只是它的 View（ADR-029）。

import type { KnowledgeNode } from '../types';

const modules = import.meta.glob('./knowledge/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, KnowledgeNode[]>;

export const knowledgeNodes: KnowledgeNode[] = Object.keys(modules)
  .sort()
  .flatMap((file) => modules[file]);
