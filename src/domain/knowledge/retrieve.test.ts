// 结构化知识检索测试（ADR-063）：投影 / 分词 / 混合评分 / graph 扩展 / scope / 答案安全模式。
// 用自建小语料跑断言，graph 扩展复用真实 conceptGraph.json（kv-cache 的 1 跳邻域已固定）。

import { describe, expect, it } from 'vitest';
import type { KnowledgeNode } from '../../schemas/knowledge';
import type { Question } from '../../schemas/question';
import { buildKnowledgeDocuments, questionDocument, renderDocument } from './documents';
import { expandGraph } from './graph';
import { buildKnowledgeIndex, tokenize } from './index';
import {
  buildIndexFrom,
  defaultKnowledgeIndex,
  effectiveWeights,
  formatCitations,
  questionSlotLimit,
  searchKnowledge,
} from './retrieve';

const nodes: KnowledgeNode[] = [
  {
    id: 'kv-cache',
    name: 'KV Cache',
    area: 'llm',
    topic: 'Inference',
    priority: 'P1',
    summary: 'KV Cache 缓存 attention 的 Key/Value，避免自回归解码时重复计算历史 token。',
    required: ['attention', '自回归解码'],
    misconceptions: ['KV Cache 会降低总显存占用'],
    angles: ['mechanism', 'tradeoff'],
  },
  {
    id: 'inference-optimization',
    name: '推理优化',
    area: 'llm',
    topic: 'Inference',
    priority: 'P0',
    summary: '推理优化通过算子融合、批处理与显存管理提升吞吐并降低延迟。',
    required: ['batching', '显存管理'],
    misconceptions: ['吞吐与延迟总是一起改善'],
    angles: ['tradeoff', 'system-design'],
  },
  {
    id: 'quantization',
    name: '量化',
    area: 'llm',
    topic: 'Inference',
    priority: 'P1',
    summary: '量化用低精度权重压缩模型，降低显存与带宽压力。',
    required: ['数值精度'],
    misconceptions: ['量化一定不损失效果'],
    angles: ['tradeoff'],
  },
];

const questions: Question[] = [
  {
    id: 'q-kv-1',
    category: 'llm',
    topic: 'kv-cache',
    tags: ['inference'],
    difficulty: 'medium',
    angle: 'mechanism',
    question: 'KV Cache 为什么能降低自回归解码的延迟？',
    explanation: '因为历史 token 的 Key/Value 被复用，解码时不必重新计算整段注意力。',
    misconceptions: ['认为 KV Cache 减少总显存'],
    formats: {
      choice: {
        type: 'single',
        options: [
          '它减少了模型参数量',
          '它复用了历史 token 的 Key/Value，避免重复计算',
          '它把注意力换成了卷积',
          '它降低了 batch size',
        ],
        answer: [1],
      },
    },
  },
  {
    id: 'q-quant-1',
    category: 'llm',
    topic: 'quantization',
    tags: ['inference'],
    difficulty: 'easy',
    angle: 'tradeoff',
    question: '量化的主要收益与代价是什么？',
    explanation: '收益是显存与带宽下降，代价是可能出现精度损失。',
    formats: { open: { referenceAnswer: '降低显存/带宽，代价是精度损失。' } },
  },
];

const testIndex = () => buildIndexFrom(nodes, questions);

describe('tokenize', () => {
  it('拉丁词整体成词，中文生成单字与二字组', () => {
    const tokens = tokenize('KV cache 降低推理延迟');
    expect(tokens).toContain('kv');
    expect(tokens).toContain('cache');
    expect(tokens).toContain('推理');
    expect(tokens).toContain('延迟');
    expect(tokens).toContain('降');
  });

  it('单字中文查询不会丢词', () => {
    expect(tokenize('缓存')).toEqual(expect.arrayContaining(['缓存']));
  });
});

describe('KnowledgeDocument 投影', () => {
  it('知识节点摊平成可检索文本并保留 metadata', () => {
    const [doc] = buildKnowledgeDocuments([nodes[0]], []);
    expect(doc.kind).toBe('knowledge');
    expect(doc.text).toContain(nodes[0].summary);
    expect(doc.text).toContain('attention');
    expect(doc.text).toContain('KV Cache 会降低总显存占用');
    expect(doc.metadata).toMatchObject({ area: 'llm', knowledgeId: 'kv-cache', topic: 'Inference' });
    expect(doc.sensitive).toBe(false);
  });

  it('题目把真值隔离到 sensitiveText', () => {
    const doc = questionDocument(questions[0]);
    expect(doc.text).toContain('KV Cache 为什么能降低自回归解码的延迟？');
    expect(doc.text).toContain('B. 它复用了历史 token');
    expect(doc.text).not.toContain('解析：');
    expect(doc.sensitive).toBe(true);
    expect(doc.sensitiveText).toContain('解析：');
    expect(doc.sensitiveText).toContain('B. 它复用了历史 token 的 Key/Value');
  });

  it('开放题的参考答案同样进入 sensitiveText', () => {
    const doc = questionDocument(questions[1]);
    expect(doc.text).not.toContain('参考答案');
    expect(doc.sensitiveText).toContain('参考答案：');
  });
});

describe('答案安全模式（ADR-063 §7）', () => {
  const doc = questionDocument(questions[0]);

  it('answer 模式可暴露解析与正确选项', () => {
    const content = renderDocument(doc, 'answer');
    expect(content).toContain('解析：');
    expect(content).toContain('正确选项：');
  });

  it('explain 模式与 answer 同样暴露解析与正确选项（ADR-065）', () => {
    const content = renderDocument(doc, 'explain');
    expect(content).toContain('解析：');
    expect(content).toContain('正确选项：');
  });

  it('hint 模式剥离真值，保留题干与误解', () => {
    const content = renderDocument(doc, 'hint');
    expect(content).toContain('KV Cache 为什么能降低');
    expect(content).toContain('常见误解');
    expect(content).not.toContain('解析：');
    expect(content).not.toContain('正确选项：');
  });

  it('quiz 模式只保留题干，连选项都不给', () => {
    const content = renderDocument(doc, 'quiz');
    expect(content).toContain('KV Cache 为什么能降低');
    expect(content).not.toContain('A.');
    expect(content).not.toContain('解析：');
  });
});

describe('graph 扩展（1 跳）', () => {
  it('seed 自身权重最高，前置 / 相关 / 后继依次递减', () => {
    const weights = expandGraph(['kv-cache']);
    expect(weights.get('kv-cache')).toBe(1);
    // 真实 conceptGraph：inference-optimization 既是前置也是 related，取最强权重
    expect(weights.get('inference-optimization')).toBeGreaterThan(0);
    expect(weights.get('gqa')).toBeGreaterThan(0);
  });

  it('2 跳之外不进入邻域', () => {
    const weights = expandGraph(['kv-cache']);
    // quantization 只与 inference-optimization 相关，属于 kv-cache 的 2 跳
    expect(weights.has('quantization')).toBe(false);
  });
});

describe('searchKnowledge', () => {
  it('命中知识点并按混合评分排序', () => {
    const evidence = searchKnowledge(
      { query: 'KV Cache 为什么能降低自回归解码的延迟', scope: 'topic', topic: 'kv-cache', limit: 5 },
      { index: testIndex(), nodes },
    );
    expect(evidence.scope).toBe('topic');
    expect(evidence.seeds).toContain('kv-cache');
    expect(evidence.hits.length).toBeGreaterThan(0);
    expect(evidence.hits[0].metadata.knowledgeId).toBe('kv-cache');
  });

  it('topic scope 只返回 1 跳邻域内的文档', () => {
    const evidence = searchKnowledge(
      { query: '推理阶段如何降低延迟', scope: 'topic', topic: 'kv-cache', limit: 10 },
      { index: testIndex(), nodes },
    );
    const topics = new Set(evidence.hits.map((h) => h.metadata.knowledgeId));
    expect(topics.has('kv-cache')).toBe(true);
    expect(topics.has('quantization')).toBe(false);
  });

  it('knowledge scope 不返回题目，避免模型从题库答案总结答案', () => {
    const evidence = searchKnowledge(
      { query: '推理优化', scope: 'knowledge', limit: 10 },
      { index: testIndex(), nodes },
    );
    expect(evidence.hits.length).toBeGreaterThan(0);
    expect(evidence.hits.every((h) => h.kind !== 'question')).toBe(true);
  });

  it('current_question scope 只返回该题与其知识点', () => {
    const evidence = searchKnowledge(
      { query: '我刚才那道题为什么错', scope: 'current_question', questionId: 'q-kv-1', knowledgeId: 'kv-cache', limit: 10 },
      { index: testIndex(), nodes },
    );
    expect(evidence.hits.length).toBeGreaterThan(0);
    for (const hit of evidence.hits) {
      const ok = hit.metadata.questionId === 'q-kv-1' || hit.metadata.knowledgeId === 'kv-cache';
      expect(ok).toBe(true);
    }
  });

  it('topic scope 无命中时不回退 global（错证据比没证据更糟）', () => {
    const evidence = searchKnowledge(
      { query: 'zzz 不存在的主题', scope: 'topic', topic: 'zzz-none' },
      { index: testIndex(), nodes },
    );
    expect(evidence.hits).toHaveLength(0);
  });

  it('current_question 锁不到题时回退到 topic 层（靠节点名/词法推断种子）', () => {
    const evidence = searchKnowledge(
      { query: '我刚才那道 KV Cache 题为什么错', scope: 'current_question', questionId: 'q-missing' },
      { index: testIndex(), nodes },
    );
    expect(evidence.scope).toBe('topic');
    expect(evidence.seeds).toContain('kv-cache');
    expect(evidence.hits.length).toBeGreaterThan(0);
  });

  it('excludeIds 能排除指定题目', () => {
    const evidence = searchKnowledge(
      { query: '延迟', scope: 'global', excludeIds: ['q-kv-1'], limit: 20 },
      { index: testIndex(), nodes },
    );
    expect(evidence.hits.some((h) => h.metadata.questionId === 'q-kv-1')).toBe(false);
  });

  it('hint 模式下检索结果不含正确选项，answer 模式含', () => {
    const base = { query: 'KV Cache 延迟', topic: 'kv-cache', limit: 10 };
    const hinted = searchKnowledge({ ...base, mode: 'hint' }, { index: testIndex(), nodes });
    const answered = searchKnowledge({ ...base, mode: 'answer' }, { index: testIndex(), nodes });
    const allHinted = hinted.hits.map((h) => h.content).join('\n');
    expect(allHinted).not.toContain('正确选项：');
    expect(answered.hits.map((h) => h.content).join('\n')).toContain('正确选项：');
  });

  it('命中数量不超过 limit 且标题不重复', () => {
    const evidence = searchKnowledge({ query: '推理', scope: 'global', limit: 3 }, { index: testIndex(), nodes });
    expect(evidence.hits.length).toBeLessThanOrEqual(3);
    const titles = evidence.hits.map((h) => h.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('每条命中都带可溯源 source（ADR-063 §8）', () => {
    const evidence = searchKnowledge({ query: 'KV Cache', topic: 'kv-cache', limit: 5 }, { index: testIndex(), nodes });
    for (const hit of evidence.hits) {
      expect(['knowledge', 'question', 'concept']).toContain(hit.source.kind);
      expect(hit.source.id.length).toBeGreaterThan(0);
      expect(hit.source.label.length).toBeGreaterThan(0);
    }
    expect(formatCitations(evidence.hits)[0]).toMatch(/^\[[KQC]\] /);
  });
});

describe('题目证据槽位上限（ADR-063 §11）', () => {
  const index = defaultKnowledgeIndex();

  it('global / topic 下题目至多占 2 条，知识节点必然出现在 evidence 里', () => {
    const evidence = searchKnowledge(
      { query: 'KV cache 为什么能降低推理延迟', scope: 'global', limit: 5 },
      { index },
    );
    expect(evidence.hits.filter((h) => h.kind === 'question').length).toBeLessThanOrEqual(2);
    expect(evidence.hits.some((h) => h.kind === 'knowledge')).toBe(true);
  });

  it('quiz 模式只给题，且不受槽位限制', () => {
    const evidence = searchKnowledge(
      { query: '考考我 transformer', scope: 'global', mode: 'quiz', limit: 5 },
      { index },
    );
    expect(evidence.hits.length).toBeGreaterThan(0);
    expect(evidence.hits.every((h) => h.kind === 'question')).toBe(true);
  });

  it('current_question 下题目不受槽位限制，且语义为"当前题 + 其知识点 + 误解/概念证据"', () => {
    const evidence = searchKnowledge(
      { query: '这道题为什么错', scope: 'current_question', knowledgeId: 'kv-cache', mode: 'answer', limit: 5 },
      { index },
    );
    expect(evidence.hits.length).toBeGreaterThan(0);
    expect(evidence.hits.length).toBeLessThanOrEqual(5);
    // 正确语义（不改实现）：命中只能是当前题（questionId=q-kv-1）或该知识点（knowledgeId=kv-cache），
    // 含其知识节点 / 误解 / 概念证据，而非"全是 question"。
    for (const hit of evidence.hits) {
      const ok = hit.metadata.questionId === 'q-kv-1' || hit.metadata.knowledgeId === 'kv-cache';
      expect(ok).toBe(true);
    }
  });

  it('questionSlotLimit 口径：quiz / current_question 放开，其余最多 2', () => {
    expect(questionSlotLimit('global', 'answer', 5)).toBe(2);
    expect(questionSlotLimit('topic', 'hint', 5)).toBe(2);
    expect(questionSlotLimit('current_question', 'answer', 5)).toBe(5);
    expect(questionSlotLimit('global', 'quiz', 5)).toBe(5);
    expect(questionSlotLimit('global', 'answer', 1)).toBe(1);
  });
});

describe('混合评分权重', () => {
  it('semantic 未接入时把 0.15 按比例回填，总分仍在 0~1', () => {
    const w = effectiveWeights(0);
    expect(w.semantic).toBe(0);
    expect(w.lexical + w.metadata + w.graph + w.semantic).toBeCloseTo(1, 6);
    expect(w.lexical).toBeGreaterThan(0.4);
  });

  it('接入 semantic 后回到设计权重', () => {
    const w = effectiveWeights(0.5);
    expect(w.lexical).toBeCloseTo(0.4, 6);
    expect(w.graph).toBeCloseTo(0.2, 6);
  });
});

describe('全库索引', () => {
  it('能建成索引并在真实题库上检索', () => {
    const index = defaultKnowledgeIndex();
    expect(index.documents.length).toBeGreaterThan(100);
    const evidence = searchKnowledge({ query: 'RAG 为什么通常需要 reranker', limit: 5 }, { index });
    expect(evidence.hits.length).toBeGreaterThan(0);
    expect(evidence.hits.length).toBeLessThanOrEqual(5);
    for (const hit of evidence.hits) {
      expect(hit.score).toBeGreaterThan(0);
      expect(hit.score).toBeLessThanOrEqual(1.000001);
    }
  });

  it('真实题目在 hint 模式下不会泄露正确选项', () => {
    const index = defaultKnowledgeIndex();
    const evidence = searchKnowledge({ query: 'rag reranking 二阶段排序', limit: 8, mode: 'hint' }, { index });
    const joined = evidence.hits.map((h) => h.content).join('\n');
    expect(joined).not.toContain('正确选项：');
    expect(joined).not.toContain('参考答案：');
  });

  it('空查询不炸，且能靠 metadata/graph 兜底', () => {
    const index = buildKnowledgeIndex(buildKnowledgeDocuments(nodes, questions));
    const evidence = searchKnowledge({ query: '', topic: 'kv-cache', limit: 3 }, { index, nodes });
    expect(evidence.hits.length).toBeGreaterThan(0);
  });
});

describe('current_question 槽位（P1-3）', () => {
  const manyQuestions: Question[] = [
    { id: 'q-kv-main', category: 'llm', topic: 'kv-cache', tags: ['inference'], difficulty: 'medium', angle: 'mechanism', question: 'KV Cache 主问？', explanation: 'x', misconceptions: [], formats: { choice: { type: 'single', options: ['a', 'b', 'c', 'd'], answer: [1] } } },
    { id: 'q-kv-o1', category: 'llm', topic: 'kv-cache', tags: ['inference'], difficulty: 'easy', angle: 'mechanism', question: 'KV Cache 其他题1？', explanation: 'x', misconceptions: [], formats: { choice: { type: 'single', options: ['a', 'b', 'c', 'd'], answer: [1] } } },
    { id: 'q-kv-o2', category: 'llm', topic: 'kv-cache', tags: ['inference'], difficulty: 'easy', angle: 'mechanism', question: 'KV Cache 其他题2？', explanation: 'x', misconceptions: [], formats: { choice: { type: 'single', options: ['a', 'b', 'c', 'd'], answer: [1] } } },
    { id: 'q-kv-o3', category: 'llm', topic: 'kv-cache', tags: ['inference'], difficulty: 'easy', angle: 'mechanism', question: 'KV Cache 其他题3？', explanation: 'x', misconceptions: [], formats: { choice: { type: 'single', options: ['a', 'b', 'c', 'd'], answer: [1] } } },
  ];
  const idx = buildIndexFrom(nodes, manyQuestions);
  it('当前题恒保留 1 条，其余同知识点其他题最多 1 条（不被题库类似题刷满）', () => {
    const ev = searchKnowledge(
      { query: '这道题为什么错', scope: 'current_question', questionId: 'q-kv-main', knowledgeId: 'kv-cache', limit: 5 },
      { index: idx, nodes },
    );
    const questions = ev.hits.filter((h) => h.kind === 'question');
    expect(questions.some((h) => h.metadata.questionId === 'q-kv-main')).toBe(true);
    expect(questions.filter((h) => h.metadata.questionId !== 'q-kv-main').length).toBeLessThanOrEqual(1);
  });
});

describe('检索排名 fixture（P2-7）', () => {
  it('"为什么 KV Cache 占显存" top 应为 kv-cache 知识节点', () => {
    const ev = searchKnowledge(
      { query: '为什么 KV Cache 会占用大量显存', scope: 'topic', topic: 'kv-cache', limit: 5 },
      { index: testIndex(), nodes },
    );
    expect(ev.hits[0].metadata.knowledgeId).toBe('kv-cache');
  });
});
