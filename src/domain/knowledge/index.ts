// 内存倒排索引（ADR-063 §3 第二层：lexical retrieval）。
//
// 为什么不是 embedding：corpus 只有几千条、且结构极强，BM25 + metadata + graph
// 已经给出非常强的信号；Phase 1 不引入向量库/外部依赖（ADR-063 §13）。
//
// 中文处理：CJK 没有空格，采用「单字 + 二字组（bigram）」双通道，
// 既保证"KV"这类拉丁词精确命中，也保证"推理延迟"这类中文短语可被切出。
//
// 纯函数，不依赖 React / LLM / 网络。

import type { KnowledgeDocument } from './types';

/** BM25 参数（标准值）。 */
const K1 = 1.2;
const B = 0.75;
/** 词频饱和归一化的半饱和常数：score = s / (s + K)。 */
const SATURATION_K = 6;
const CJK = /[㐀-䶿一-鿿豈-﫿]/;
const LATIN_TOKEN = /[a-z0-9][a-z0-9+#._-]*/g;

/** 单个文档的倒排项。 */
export interface Posting {
  doc: number;
  tf: number;
}

export interface KnowledgeIndex {
  documents: KnowledgeDocument[];
  /** token → 倒排链 */
  postings: Map<string, Posting[]>;
  /** token → IDF */
  idf: Map<string, number>;
  /** 每篇文档的 token 数（BM25 长度归一） */
  docLengths: number[];
  avgDocLength: number;
}

/**
 * 分词：拉丁/数字串整体成词（≥2 字符），CJK 生成单字 + 相邻二字组。
 * 例："KV cache 降低推理延迟" → kv, cache, 降, 低, 推, 理, 延, 迟, 降低, 低推, 推理, 理延, 延迟
 */
export function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const tokens: string[] = [];

  for (const match of lower.matchAll(LATIN_TOKEN)) {
    if (match[0].length >= 2) tokens.push(match[0]);
  }

  let run = '';
  const flushRun = () => {
    if (run.length === 0) return;
    for (let i = 0; i < run.length; i++) {
      tokens.push(run[i]);
      if (i + 1 < run.length) tokens.push(run.slice(i, i + 2));
    }
    run = '';
  };
  for (const ch of lower) {
    if (CJK.test(ch)) run += ch;
    else flushRun();
  }
  flushRun();

  return tokens;
}

/** 建索引。corpus 规模（≈2k 文档）下耗时可忽略；测试可传任意文档集。 */
export function buildKnowledgeIndex(documents: KnowledgeDocument[]): KnowledgeIndex {
  const postings = new Map<string, Posting[]>();
  const docLengths: number[] = new Array(documents.length).fill(0);

  documents.forEach((doc, index) => {
    const counts = new Map<string, number>();
    for (const token of tokenize(`${doc.title}\n${doc.text}`)) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
      docLengths[index] += 1;
    }
    for (const [token, tf] of counts) {
      const chain = postings.get(token);
      if (chain) chain.push({ doc: index, tf });
      else postings.set(token, [{ doc: index, tf }]);
    }
  });

  const total = documents.length || 1;
  const idf = new Map<string, number>();
  for (const [token, chain] of postings) {
    // BM25 概率 IDF，下限 0 避免超高频词变成负分。
    idf.set(token, Math.max(0, Math.log(1 + (total - chain.length + 0.5) / (chain.length + 0.5))));
  }

  const avgDocLength =
    docLengths.length === 0 ? 0 : docLengths.reduce((a, b) => a + b, 0) / docLengths.length;

  return { documents, postings, idf, docLengths, avgDocLength };
}

/** BM25 原始分：docIndex → score（只返回有命中的文档）。 */
export function bm25Scores(index: KnowledgeIndex, query: string): Map<number, number> {
  const scores = new Map<number, number>();
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return scores;

  for (const token of queryTokens) {
    const chain = index.postings.get(token);
    if (!chain) continue;
    const idf = index.idf.get(token) ?? 0;
    if (idf <= 0) continue;
    for (const { doc, tf } of chain) {
      const len = index.docLengths[doc] || 0;
      const norm = 1 - B + B * (len / (index.avgDocLength || 1));
      const gain = (idf * (tf * (K1 + 1))) / (tf + K1 * norm);
      scores.set(doc, (scores.get(doc) ?? 0) + gain);
    }
  }
  return scores;
}

/**
 * 归一到 0~1：绝对饱和分与"相对最佳命中"各占一半。
 * 前者避免长文档刷分，后者保证弱查询下仍有可用的相对排序。
 */
export function normalizeLexical(raw: Map<number, number>): Map<number, number> {
  let max = 0;
  for (const score of raw.values()) if (score > max) max = score;
  const out = new Map<number, number>();
  for (const [doc, score] of raw) {
    const saturated = score / (score + SATURATION_K);
    const relative = max > 0 ? score / max : 0;
    out.set(doc, max > 0 ? 0.6 * saturated + 0.4 * relative : 0);
  }
  return out;
}

/** 便捷入口：一次拿到归一化的词法分。 */
export function lexicalScores(index: KnowledgeIndex, query: string): Map<number, number> {
  return normalizeLexical(bm25Scores(index, query));
}
