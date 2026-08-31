// 纯逻辑：知识图谱（Knowledge Graph）。只回答"知识之间是什么关系"，
// 不持有任何学习状态与掌握度策略（那些在 learner.ts，见 ADR-030）。
// 数据形态：有向边列表，两类关系：
//   prerequisite  基础 → 进阶（加载期 isAcyclic 校验的 DAG）
//   related       一般相关（无向语义，遍历层双向展开）
// 图的存储与算法委托给 @dagrejs/graphlib：
//   - 邻接查询 predecessors
//   - prerequisite 子图的 DAG 校验（isAcyclic/findCycles，数据错误在加载期暴露）
//   - 拓扑排序（topsort）给出"基础→进阶"学习顺序
// 图是模块级单例（数据来自 data/conceptGraph.json），公开 API 不再要求传 graph 参数。
// graphlib 的数据结构不向其他 domain 模块泄漏——对外只有 topic 字符串数组/序号。
// 不依赖 React / LLM / 网络。

import { Graph, alg } from '@dagrejs/graphlib';
import graphData from '../data/conceptGraph.json';
import { conceptGraphSchema } from '../schemas/conceptGraph';
import { formatSchemaErrorMessage } from '../schemas/errors';

export type EdgeType =
  | 'prerequisite' // from 是 to 的前置（DAG，基础 → 进阶）
  | 'related'; // 一般相关（无向语义，双向可遍历）

export interface ConceptEdge {
  from: string;
  to: string;
  type: EdgeType;
}

export interface ConceptGraph {
  edges: ConceptEdge[];
}

const parsedGraph = conceptGraphSchema.safeParse(graphData);
if (!parsedGraph.success) {
  throw new Error(formatSchemaErrorMessage(parsedGraph.error, 'conceptGraph.json 形状校验失败'));
}
export const conceptGraph: ConceptGraph = parsedGraph.data as unknown as ConceptGraph;

/** 无向语义的边类型。 */
const UNDIRECTED_TYPES: EdgeType[] = ['related'];

// ── graphlib 实例（模块级单例） ─────────────────────────────

const g = new Graph({ directed: true });
for (const e of conceptGraph.edges) {
  g.setNode(e.from);
  g.setNode(e.to);
  g.setEdge(e.from, e.to, e.type);
}

/** prerequisite 子图（基础→进阶的学习依赖 DAG）。 */
const prerequisiteDag = (() => {
  const dag = new Graph({ directed: true });
  for (const { v, w } of g.edges()) {
    if (g.edge(v, w) === 'prerequisite') dag.setEdge(v, w);
  }
  return dag;
})();

if (!alg.isAcyclic(prerequisiteDag)) {
  throw new Error(`conceptGraph: prerequisite 边存在环，请修正数据：${JSON.stringify(alg.findCycles(prerequisiteDag))}`);
}

/** 全部前置关系的拓扑序（基础在前）；不在依赖关系中的节点排在最后。 */
const topoRank = new Map<string, number>(
  alg.topsort(prerequisiteDag).map((id, i) => [id, i]),
);

// ── 遍历 API ───────────────────────────────────────────────

/** 前置传递闭包（沿 DAG 上溯，BFS 近者在前；环已由加载期校验排除）。 */
export function prerequisiteClosure(topic: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>([topic]);
  const queue = [...(prerequisiteDag.predecessors(topic) ?? [])];
  while (queue.length > 0) {
    const t = queue.shift() as string;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    queue.push(...(prerequisiteDag.predecessors(t) ?? []));
  }
  return out;
}

/**
 * 横向扩展候选（broaden）：related 边的双端（双向遍历）。
 */
export function relatedOf(topic: string): string[] {
  const result = new Set<string>();
  for (const e of conceptGraph.edges) {
    if (!UNDIRECTED_TYPES.includes(e.type)) continue;
    if (e.from === topic) result.add(e.to);
    else if (e.to === topic) result.add(e.from);
  }
  return [...result];
}

/** 直接前置（1 跳，不含传递闭包）。供知识检索的 graph expansion 使用。 */
export function prerequisitesOf(topic: string): string[] {
  return [...(prerequisiteDag.predecessors(topic) ?? [])];
}

/** 直接后继（1 跳：以该主题为前置的进阶概念）。 */
export function dependentsOf(topic: string): string[] {
  return [...(prerequisiteDag.successors(topic) ?? [])];
}

/** 主题在 prerequisite DAG 拓扑序中的位置（越靠前越基础）；不在依赖图中返回 Infinity。 */
export function topoRankOf(topic: string): number {
  return topoRank.get(topic) ?? Infinity;
}
