// 检索层（ADR-063 §3/§4/§6/§7/§8）：metadata 精确匹配 + lexical + graph 1-hop，
// 混合评分 0.40 lexical + 0.25 metadata + 0.20 graph + 0.15 semantic（Phase 2 接入）。
//
// 职责边界：
//   - 本文件只回答"哪些 evidence 相关、以及它们能暴露到什么程度"
//   - "该查什么范围 / 查多少" 由 application/conversation/knowledgeCapability 决定
//   - prompt 组装仍在 application 层
//
// 纯函数 + 模块级索引缓存，不依赖 React / LLM。

import { knowledgeNodes } from '../../data/knowledgeMap';
import { questionBank } from '../../data/questionBank';
import type { KnowledgeNode } from '../../schemas/knowledge';
import type { Question } from '../../schemas/question';
import { buildKnowledgeDocuments, renderDocument } from './documents';
import { expandGraph, graphScoreOf, type GraphWeights } from './graph';
import { buildKnowledgeIndex, lexicalScores, tokenize, type KnowledgeIndex } from './index';
import {
  DEFAULT_KNOWLEDGE_LIMIT,
  HYBRID_WEIGHTS,
  type KnowledgeDocument,
  type KnowledgeEvidence,
  type KnowledgeHit,
  type KnowledgeSearchQuery,
  type RetrievalMode,
  type RetrievalScope,
  type KnowledgeScoreBreakdown,
} from './types';

// ── 默认索引（单例，冷启动一次）──────────────────────────────

let cached: KnowledgeIndex | null = null;

/** 全库索引：KnowledgeNode + Question 投影后的统一 corpus。 */
export function defaultKnowledgeIndex(): KnowledgeIndex {
  if (!cached) {
    cached = buildKnowledgeIndex(buildKnowledgeDocuments(knowledgeNodes, questionBank.questions));
  }
  return cached;
}

/** 供测试注入（不污染单例）。 */
export function buildIndexFrom(nodes: KnowledgeNode[], questions: Question[] = []): KnowledgeIndex {
  return buildKnowledgeIndex(buildKnowledgeDocuments(nodes, questions));
}

// ── 评分 ─────────────────────────────────────────────────────

/**
 * 语义通道（Phase 2 embedding）尚未接入时，把 0.15 的权重按比例回填给其余三路，
 * 保证 Phase 1 与最终版评分同量纲。
 */
export function effectiveWeights(semantic: number): KnowledgeScoreBreakdown {
  const w = HYBRID_WEIGHTS;
  if (semantic > 0) return { ...w, semantic };
  const total = w.lexical + w.metadata + w.graph;
  return { lexical: w.lexical / total, metadata: w.metadata / total, graph: w.graph / total, semantic: 0 };
}

function metadataScore(doc: KnowledgeDocument, q: KnowledgeSearchQuery, tokens: string[]): number {
  const meta = doc.metadata;
  let score = 0;
  const bump = (value: number) => {
    if (value > score) score = value;
  };
  if (q.questionId && meta.questionId === q.questionId) bump(1);
  if (q.knowledgeId && meta.knowledgeId === q.knowledgeId) bump(1);
  if (q.topic && (meta.knowledgeId === q.topic || meta.topic === q.topic)) bump(0.9);
  if (q.area && meta.area === q.area) bump(0.4);
  if (meta.tags && meta.tags.length > 0 && tokens.length > 0) {
    const hit = meta.tags.some((tag) => {
      const lower = tag.toLowerCase();
      return tokens.some((tk) => tk.length >= 2 && (lower === tk || lower.includes(tk)));
    });
    if (hit) bump(0.35);
  }
  return score;
}

// ── scope 过滤（ADR-063 §6）──────────────────────────────────

function inScope(
  doc: KnowledgeDocument,
  q: KnowledgeSearchQuery,
  scope: RetrievalScope,
  mode: RetrievalMode,
  neighborhood: Set<string>,
): boolean {
  // quiz：用户要的是"题"，知识节点不是素材（ADR-063 §7 quiz 模式）。
  if (mode === 'quiz') return doc.kind === 'question';
  switch (scope) {
    case 'current_question':
      // 当前题 + 它所属知识点；不再做全局检索（"我刚才那道题为什么错"）。
      return Boolean(
        (q.questionId && doc.metadata.questionId === q.questionId) ||
          (q.knowledgeId && doc.metadata.knowledgeId === q.knowledgeId),
      );
    case 'topic':
      return Boolean(doc.metadata.knowledgeId && neighborhood.has(doc.metadata.knowledgeId));
    case 'knowledge':
      // 只要概念层：不把 10 道题塞给模型，避免"从题库答案总结答案"（ADR-063 §11）。
      return doc.kind !== 'question';
    case 'global':
      return true;
    default:
      return true;
  }
}

/**
 * 空结果的兜底链。刻意只保留 current_question → topic：
 * 当前题的知识点可能未登记（冷门 topic），此时回退到主题层比什么都不给更好；
 * 而 topic → global 会把不相关证据塞进 prompt（错证据比没证据更糟），故不做。
 */
const SCOPE_FALLBACK: Partial<Record<RetrievalScope, RetrievalScope>> = {
  current_question: 'topic',
};

// ── seed 推断 ────────────────────────────────────────────────

/**
 * 推断 graph 扩展起点：显式指定 > 题干/查询里出现节点名或 slug > 词法 top 命中的知识点。
 */
export function inferSeeds(
  index: KnowledgeIndex,
  q: KnowledgeSearchQuery,
  lexical: Map<number, number>,
  nodes: KnowledgeNode[] = knowledgeNodes,
): string[] {
  const explicit = [q.knowledgeId, q.topic].filter((v): v is string => Boolean(v));
  if (explicit.length > 0) return [...new Set(explicit)];

  const lower = q.query.toLowerCase();
  const byName: string[] = [];
  for (const node of nodes) {
    if (lower.includes(node.name.toLowerCase())) byName.push(node.id);
    else if (node.id.length >= 3 && lower.includes(node.id.toLowerCase())) byName.push(node.id);
  }
  if (byName.length > 0) return [...new Set(byName)].slice(0, 3);

  // 兜底：词法命中最强的知识点节点。
  const top = [...lexical.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([docIdx]) => index.documents[docIdx]?.metadata.knowledgeId)
    .filter((id): id is string => Boolean(id));
  return [...new Set(top)].slice(0, 2);
}

// ── 主入口 ───────────────────────────────────────────────────

/**
 * 题目证据槽位上限（ADR-063 §11）：Question 是 Knowledge 的 evidence，不是主知识源。
 *
 * 实测（1317 题 / 123 节点）：题干 + 4 个选项文本远长于知识节点，词面命中天然更多，
 * 不加限制时 top 5 会全部是题目——模型于是"从题库答案里总结答案"，而不是从知识模型回答。
 * 两个例外不设限：`current_question`（当前题就是检索目标）与 `quiz`（题目就是素材）。
 */
export function questionSlotLimit(
  scope: RetrievalScope,
  mode: RetrievalMode,
  limit: number,
): number {
  if (scope === 'current_question' || mode === 'quiz') return limit;
  return Math.min(2, limit);
}

export interface SearchOptions {
  index?: KnowledgeIndex;
  nodes?: KnowledgeNode[];
}

export function searchKnowledge(q: KnowledgeSearchQuery, options: SearchOptions = {}): KnowledgeEvidence {
  const index = options.index ?? defaultKnowledgeIndex();
  const mode: RetrievalMode = q.mode ?? 'answer';
  const requestedScope: RetrievalScope = q.scope ?? 'global';
  const limit = Math.max(1, q.limit ?? DEFAULT_KNOWLEDGE_LIMIT);

  const lexical = lexicalScores(index, q.query);
  const tokens = tokenize(q.query);
  const seeds = q.seeds && q.seeds.length > 0 ? q.seeds : inferSeeds(index, q, lexical, options.nodes);
  const weights: GraphWeights = expandGraph(seeds);
  const neighborhood = new Set(weights.keys());
  const excluded = new Set(q.excludeIds ?? []);

  const run = (scope: RetrievalScope): KnowledgeHit[] => {
    const weightsUsed = effectiveWeights(0);
    const scored: KnowledgeHit[] = [];
    index.documents.forEach((doc, docIndex) => {
      if (doc.metadata.questionId && excluded.has(doc.metadata.questionId)) return;
      if (!inScope(doc, q, scope, mode, neighborhood)) return;

      const lexicalScore = lexical.get(docIndex) ?? 0;
      const metaScore = metadataScore(doc, q, tokens);
      const graphScore = graphScoreOf(weights, doc.metadata.knowledgeId);
      if (lexicalScore === 0 && metaScore === 0 && graphScore === 0) return;

      const breakdown: KnowledgeScoreBreakdown = {
        lexical: lexicalScore,
        metadata: metaScore,
        graph: graphScore,
        semantic: 0,
      };
      const score =
        weightsUsed.lexical * lexicalScore +
        weightsUsed.metadata * metaScore +
        weightsUsed.graph * graphScore +
        weightsUsed.semantic * 0;

      scored.push({
        id: doc.id,
        kind: doc.kind,
        title: doc.title,
        content: renderDocument(doc, mode),
        score,
        breakdown,
        metadata: doc.metadata,
        source: sourceOf(doc),
      });
    });

    scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    // 同标题只保留最强一条：concept 锚点在不同节点下会重名，避免 top N 被同一概念刷屏。
    const questionSlots = questionSlotLimit(scope, mode, limit);
    const seenTitles = new Set<string>();
    const deduped: KnowledgeHit[] = [];
    let usedQuestionSlots = 0;
    for (const hit of scored) {
      if (seenTitles.has(hit.title)) continue;
      if (hit.kind === 'question') {
        if (usedQuestionSlots >= questionSlots) continue;
        usedQuestionSlots += 1;
      }
      seenTitles.add(hit.title);
      deduped.push(hit);
      if (deduped.length >= limit) break;
    }
    return deduped;
  };

  let scope = requestedScope;
  let hits = run(scope);
  while (hits.length === 0 && SCOPE_FALLBACK[scope]) {
    scope = SCOPE_FALLBACK[scope] as RetrievalScope;
    hits = run(scope);
  }

  return { query: q.query, scope, mode, seeds, hits };
}

function sourceOf(doc: KnowledgeDocument): KnowledgeHit['source'] {
  if (doc.kind === 'question') {
    return { kind: 'question', id: doc.metadata.questionId ?? doc.id, label: doc.title };
  }
  if (doc.kind === 'concept') {
    return { kind: 'concept', id: doc.metadata.knowledgeId ?? doc.id, label: doc.title };
  }
  return { kind: 'knowledge', id: doc.metadata.knowledgeId ?? doc.id, label: doc.title };
}

/** 引用列表（ADR-063 §8）：回答末尾的"依据"。 */
export function formatCitations(hits: KnowledgeHit[]): string[] {
  const prefix: Record<KnowledgeHit['source']['kind'], string> = {
    knowledge: '[K]',
    question: '[Q]',
    concept: '[C]',
  };
  return hits.map((hit) => `${prefix[hit.source.kind]} ${hit.source.label}`);
}
