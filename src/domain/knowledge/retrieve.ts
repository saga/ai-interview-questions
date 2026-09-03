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
  BASE_RETRIEVAL_WEIGHTS,
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
  const w = BASE_RETRIEVAL_WEIGHTS;
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
  // Learner Memory 弱项信号：小幅提权（见 learnerBoost），不影响已有命中等级。
  return score + learnerBoost(doc, q);
}

/**
 * Learner Memory 信号（ADR-065 P1-2）：弱项节点在检索排序里轻微上浮。
 * 刻意只做"小幅提权、不主导"——上限 0.15，远小于 lexical/metadata 命中，
 * 避免把弱项证据挤出真实语义命中，也避免引入新的排序层。
 * - weakTopics：命中 knowledgeId（最强）/ topic 的节点上浮
 * - weakAngles：命中 question.angle 的节点上浮
 */
function learnerBoost(doc: KnowledgeDocument, q: KnowledgeSearchQuery): number {
  const lc = q.learnerContext;
  if (!lc) return 0;
  const meta = doc.metadata;
  let boost = 0;
  if (lc.weakTopics && lc.weakTopics.length > 0) {
    if (meta.knowledgeId && lc.weakTopics.includes(meta.knowledgeId)) boost = Math.max(boost, 0.15);
    if (meta.topic && lc.weakTopics.includes(meta.topic)) boost = Math.max(boost, 0.12);
  }
  if (lc.weakAngles && lc.weakAngles.length > 0 && meta.angle && lc.weakAngles.includes(meta.angle)) {
    boost = Math.max(boost, 0.1);
  }
  return boost;
}

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
 * Knowledge = truth（primary），Question = assessment projection（secondary evidence）。
 *
 * 结构性原因：考试题刻意省略信息、制造有效 distractor（错误说法），而知识检索要
 * 正确、完整、可解释的上下文。把选择题（含错误选项）当 primary corpus，
 * 会让"RAG 为什么需要 reranking"这类查询捡到 A/B/C/D 里混杂的错误说法。
 * 因此 Copilot 先检索 Knowledge，Question 只作次级证据：
 *   1. 分数降权（QUESTION_SECONDARY_WEIGHT）：同等命中下知识文档恒排在前面；
 *   2. 槽位上限（questionSlotLimit）：top N 里题目最多占 2 席。
 * 两个例外不降权不限槽：`current_question`（当前题就是检索目标）与 `quiz`（题目就是素材）。
 *
 * 实测（1317 题 / 123 节点）：题干 + 4 个选项文本远长于知识节点，词面命中天然更多，
 * 不加限制时 top 5 会全部是题目——模型于是"从题库答案里总结答案"，而不是从知识模型回答。
 */
export function questionSlotLimit(
  scope: RetrievalScope,
  mode: RetrievalMode,
  limit: number,
): number {
  if (scope === 'current_question' || mode === 'quiz') return limit;
  return Math.min(2, limit);
}

/**
 * 题目次级权重：global / topic / knowledge 范围下，question doc 的混合分数
 * 乘以该系数后再排序，保证"同等命中下 Knowledge 恒在前"。
 * current_question / quiz 例外（题目即目标/素材），权重为 1。
 */
export const QUESTION_SECONDARY_WEIGHT = 0.7;

export function questionSecondaryWeight(scope: RetrievalScope, mode: RetrievalMode): number {
  if (scope === 'current_question' || mode === 'quiz') return 1;
  return QUESTION_SECONDARY_WEIGHT;
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
      const raw =
        weightsUsed.lexical * lexicalScore +
        weightsUsed.metadata * metaScore +
        weightsUsed.graph * graphScore +
        weightsUsed.semantic * 0;
      // Question 是次级证据：同等命中下 Knowledge 恒排在前（P1-3）。
      const score = doc.kind === 'question' ? raw * questionSecondaryWeight(scope, mode) : raw;

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
    /**
     * 去重键用 canonical id，不再用 title。
     *
     * 按 title 去重会让"两个不同知识点恰好同名"的其中一个直接消失——例如不同知识节点下
     * 的同名词条、或题干前 80 字相同的两道独立题目。title 是展示字段，不是身份。
     *
     * 唯一例外是 `concept`：它只是**概念锚点**（"X 出现在某节点的前置要点中"），本身不含
     * 知识内容。同名锚点在不同节点下正文近乎一致，若按 id 去重会让 top N 被同一个概念名刷屏。
     */
    const questionSlots = questionSlotLimit(scope, mode, limit);
    const seen = new Set<string>();
    const deduped: KnowledgeHit[] = [];
    let usedOtherQuestionSlots = 0;
    let usedCurrentQuestion = false;
    // P1-3（ADR-065）：current_question 范围下，当前题本身恒保留 1 条，其余其他题目
    // （同 knowledgeId、不同 questionId）最多 1 条，避免"题库里类似题"刷满 top5，
    // 让"这题为什么错"真正回到知识解释，而不是把相似题重新喂一遍。
    const otherQuestionCap = scope === 'current_question' ? 1 : questionSlots;
    for (const hit of scored) {
      const dedupKey = hit.kind === 'concept' ? `concept:${hit.title}` : hit.id;
      if (seen.has(dedupKey)) continue;
      if (hit.kind === 'question') {
        if (scope === 'current_question' && q.questionId && hit.metadata.questionId === q.questionId) {
          if (usedCurrentQuestion) continue;
          usedCurrentQuestion = true;
        } else {
          if (usedOtherQuestionSlots >= otherQuestionCap) continue;
          usedOtherQuestionSlots += 1;
        }
      }
      seen.add(dedupKey);
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
