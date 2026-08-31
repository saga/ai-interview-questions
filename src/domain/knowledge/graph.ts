// 图扩展层（ADR-063 §3 第三层 / §9）：Concept Graph 不再只服务于 adaptive selection，
// 它同时是 Knowledge Retrieval 的骨架（Graph = Knowledge Backbone）。
//
// 复用 domain/conceptGraph 的字符串级 API，1 跳扩展：
//   seed          → 1.0
//   prerequisite  → 0.8（先修概念：解释 A 往往必须提到它的前置）
//   related       → 0.6（横向相关：比较类问题的主力）
//   dependent     → 0.45（后继：它能用来干什么）
//
// 纯函数，不依赖 React / LLM。

import { dependentsOf, prerequisitesOf, relatedOf } from '../conceptGraph';

export interface GraphEdgeWeights {
  seed: number;
  prerequisite: number;
  related: number;
  dependent: number;
}

export const GRAPH_EDGE_WEIGHTS: GraphEdgeWeights = {
  seed: 1,
  prerequisite: 0.8,
  related: 0.6,
  dependent: 0.45,
};

/** 1 跳扩展结果：conceptId → 相关度权重（0~1）。 */
export type GraphWeights = Map<string, number>;

/**
 * 从若干 seed 概念出发做 1 跳扩展。同一节点被多条边命中时取最强权重。
 */
export function expandGraph(seeds: string[]): GraphWeights {
  const weights: GraphWeights = new Map();
  const bump = (id: string, weight: number) => {
    if (!id) return;
    const current = weights.get(id) ?? 0;
    if (weight > current) weights.set(id, weight);
  };
  for (const seed of seeds) {
    if (!seed) continue;
    bump(seed, GRAPH_EDGE_WEIGHTS.seed);
    for (const id of prerequisitesOf(seed)) bump(id, GRAPH_EDGE_WEIGHTS.prerequisite);
    for (const id of relatedOf(seed)) bump(id, GRAPH_EDGE_WEIGHTS.related);
    for (const id of dependentsOf(seed)) bump(id, GRAPH_EDGE_WEIGHTS.dependent);
  }
  return weights;
}

/** 查某个概念在图扩展中的权重；不在邻域内返回 0。 */
export function graphScoreOf(weights: GraphWeights, conceptId: string | undefined): number {
  if (!conceptId) return 0;
  return weights.get(conceptId) ?? 0;
}

/** 邻域内按权重降序的概念 id（含 seed 自身），便于调试与引用展示。 */
export function rankedNeighborhood(weights: GraphWeights): string[] {
  return [...weights.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}
