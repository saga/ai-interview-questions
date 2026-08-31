// 应用层知识检索能力测试（ADR-063 §6/§7）：scope 规划、答案安全模式、prompt 片段。
// query planner 必须确定性——检索范围与"能暴露什么"属于安全边界，不能交给模型判断。

import { describe, expect, it } from 'vitest';
import type { Question } from '../../schemas/question';
import {
  buildKnowledgePromptSection,
  combineFollowUp,
  detectQueryTopic,
  knowledgeCitations,
  planRetrievalMode,
  planRetrievalScope,
  retrieveForCopilot,
} from './knowledgeCapability';

const activeQuestion: Question = {
  id: 'q-rag-1',
  category: 'llm-applications',
  topic: 'rag',
  tags: ['retrieval'],
  difficulty: 'medium',
  angle: 'mechanism',
  question: '为什么 RAG 通常需要 reranker？',
  explanation: '向量召回以相关性粗排为目标，reranker 用交叉编码重排提升 top-k 精度。',
  formats: { open: { referenceAnswer: '召回粗排 + 交叉编码精排。' } },
};

describe('planRetrievalScope（含 P0-2 当前题与知识主题解耦）', () => {
  it('提到"这道题"时锁定当前题', () => {
    expect(planRetrievalScope({ query: '这道题为什么选 B', activeQuestion })).toBe('current_question');
    expect(planRetrievalScope({ query: '我刚才那道为什么错了', activeQuestion })).toBe('current_question');
  });

  it('显式 topic → topic', () => {
    expect(planRetrievalScope({ query: '讲一下原理', topic: 'rag' })).toBe('topic');
    expect(planRetrievalScope({ query: '随便聊聊', topic: 'rag' })).toBe('topic');
  });

  it('P0-2：有当前题(rag)时问另一个知识点不被当前题 topic 限制', () => {
    expect(planRetrievalScope({ query: 'GQA 和 MQA 有什么区别', activeQuestion })).toBe('topic');
    expect(planRetrievalScope({ query: '讲讲 KV Cache', activeQuestion })).toBe('topic');
  });

  it('P0-2：有当前题求提示/答案 → current_question（锚定当前题，而非被其他 topic 带走）', () => {
    expect(planRetrievalScope({ query: '给我一点提示，不要直接给答案', activeQuestion })).toBe('current_question');
    expect(planRetrievalScope({ query: '这题正确答案是什么', activeQuestion })).toBe('current_question');
  });

  it('纯概念提问（无当前题/无锚点）→ knowledge', () => {
    expect(planRetrievalScope({ query: '什么是 reranker？' })).toBe('knowledge');
    expect(planRetrievalScope({ query: 'RAG 和微调有什么区别？' })).toBe('topic');
  });

  it('有当前题的普通 follow-up（无锚点、非求助）→ global，不被当前题 topic 限制', () => {
    expect(planRetrievalScope({ query: '为什么', activeQuestion })).toBe('global');
    expect(planRetrievalScope({ query: '还有呢', activeQuestion })).toBe('global');
  });

  it('其他情况走 global', () => {
    expect(planRetrievalScope({ query: '今天天气不错' })).toBe('global');
  });

  it('显式 scope 优先级最高', () => {
    expect(planRetrievalScope({ query: '这道题为什么选 B', activeQuestion, scope: 'global' })).toBe('global');
  });
});

describe('detectQueryTopic（P1 最长匹配）', () => {
  it('不被数组顺序里先出现的泛化节点劫持：收集全部命中、取 term 最长者', () => {
    // 'training'(8) ⊂ 'pretraining'(11)：query 明确含更具体的 pretraining 时应锚定它。
    expect(detectQueryTopic('pretraining 和 training 有什么区别')).toBe('pretraining');
    // 'ranking'(7) ⊂ 'reranking'(9)
    expect(detectQueryTopic('reranking 与 ranking 的关系')).toBe('reranking');
    // 'attention'(9) ⊂ 'self-attention'(13)（带连字符）
    expect(detectQueryTopic('self-attention 的注意力机制')).toBe('self-attention');
  });
});

describe('planRetrievalMode（答案安全模式）', () => {
  it('要提示 → hint', () => {
    expect(planRetrievalMode({ query: '给我一点提示，不要直接给答案', activeQuestion })).toBe('hint');
    expect(planRetrievalMode({ query: '这题从哪入手？', activeQuestion })).toBe('hint');
  });

  it('要被考 → quiz', () => {
    expect(planRetrievalMode({ query: '考考我 RAG' })).toBe('quiz');
    expect(planRetrievalMode({ query: '给我出一道题' })).toBe('quiz');
  });

  it('明确要答案 → answer（覆盖默认保护）', () => {
    expect(planRetrievalMode({ query: '这题的正确答案是什么', activeQuestion })).toBe('answer');
    expect(planRetrievalMode({ query: '解析一下正确选项', activeQuestion })).toBe('answer');
  });

  it('P0-B：有当前题但没在谈它 → 安全模式 hint（不因页面上恰好有题就开真值闸门）', () => {
    expect(planRetrievalMode({ query: '讲考点', activeQuestion })).toBe('hint');
  });

  it('当前题 + 详细解读类请求 → explain（而非只给提示）', () => {
    expect(planRetrievalMode({ query: '这道题我不会，给我详细解读', activeQuestion })).toBe('explain');
    expect(planRetrievalMode({ query: '帮我讲透这道题', activeQuestion })).toBe('explain');
    expect(planRetrievalMode({ query: '为什么错', activeQuestion })).toBe('explain');
  });

  it('P0-B：有当前题(rag)却问另一个知识点 → hint，不暴露 GQA 题库的 assessment truth', () => {
    expect(planRetrievalMode({ query: 'GQA 和 MQA 有什么区别', activeQuestion })).toBe('hint');
    expect(planRetrievalMode({ query: '讲讲 KV Cache', activeQuestion })).toBe('hint');
  });

  it('P0-B：没有当前题的纯知识问题同样走安全模式（旧实现为 answer）', () => {
    expect(planRetrievalMode({ query: '什么是 GQA？' })).toBe('hint');
    expect(planRetrievalMode({ query: '介绍一下 RAG' })).toBe('hint');
  });
});

describe('buildKnowledgePromptSection', () => {
  it('无命中时不产生片段', () => {
    expect(buildKnowledgePromptSection(null)).toBe('');
    const empty = retrieveForCopilot({ query: 'zzz 不存在的主题 zzz', scope: 'topic', topic: 'zzz-none' });
    expect(empty.hits.length).toBe(0);
    expect(buildKnowledgePromptSection(empty)).toBe('');
  });

  it('answer 模式提示按引用标记作答', () => {
    const evidence = retrieveForCopilot({ query: 'RAG 为什么需要 reranker', mode: 'answer', limit: 3 });
    const section = buildKnowledgePromptSection(evidence);
    expect(section).toContain('【知识库检索依据】');
    expect(section).toContain('模式=answer');
    expect(section).toContain('不得编造');
  });

  it('非 answer 模式写入硬性禁止项', () => {
    const evidence = retrieveForCopilot({ query: 'RAG reranker', mode: 'hint', limit: 3 });
    const section = buildKnowledgePromptSection(evidence);
    expect(section).toContain('模式=hint');
    expect(section).toContain('严禁直接给出或变相暗示正确答案');
  });

  it('explain 模式与 answer 同样允许暴露真值（不写禁止项）', () => {
    const evidence = retrieveForCopilot({ query: 'RAG reranker', mode: 'explain', limit: 3 });
    const section = buildKnowledgePromptSection(evidence);
    expect(section).toContain('模式=explain');
    expect(section).not.toContain('严禁直接给出或变相暗示正确答案');
  });

  it('片段长度受控，避免单条长文档挤爆上下文', () => {
    const evidence = retrieveForCopilot({ query: 'agent 记忆', scope: 'global', limit: 8 });
    const section = buildKnowledgePromptSection(evidence);
    expect(section.length).toBeLessThan(8000);
  });
});

describe('combineFollowUp（ADR-065 P1-1）', () => {
  it('当前消息已有主题锚点（已知 topic 或较长查询）时直接返回，不污染检索', () => {
    expect(combineFollowUp('讲一下 KV Cache 的显存优化', '这道题为什么错', 'kv-cache')).toBe('讲一下 KV Cache 的显存优化');
    expect(combineFollowUp('什么是 GQA，它和 MHA 有什么区别', '上一轮问题')).toBe('什么是 GQA，它和 MHA 有什么区别');
  });

  it('短追问拼接上一轮用户消息以提供上下文', () => {
    expect(combineFollowUp('为什么', '这道题为什么错')).toBe('这道题为什么错 为什么');
    expect(combineFollowUp('那多选题呢', '给我出一道 RAG 的题')).toBe('给我出一道 RAG 的题 那多选题呢');
  });

  it('与上一轮完全相同时不拼接', () => {
    expect(combineFollowUp('这道题为什么错', '这道题为什么错')).toBe('这道题为什么错');
  });

  it('无上一轮时直接返回当前消息', () => {
    expect(combineFollowUp('什么是 GQA')).toBe('什么是 GQA');
  });

  it('P1-4：上一轮是 command / answer 时不参与拼接（避免污染 lexical 检索）', () => {
    expect(combineFollowUp('为什么', '给我出一道题', undefined, 'command')).toBe('为什么');
    expect(combineFollowUp('为什么', 'A', undefined, 'answer')).toBe('为什么');
    expect(combineFollowUp('为什么', '这道题为什么错', undefined, 'copilot')).toBe('这道题为什么错 为什么');
  });
});

describe('retrieveForCopilot 端到端', () => {
  it('真实题库上能检索到带 source 的 evidence', () => {
    const evidence = retrieveForCopilot({ query: 'RAG 为什么通常需要 reranker？', limit: 5 });
    expect(evidence.hits.length).toBeGreaterThan(0);
    expect(evidence.hits.length).toBeLessThanOrEqual(5);
    expect(evidence.seeds.length).toBeGreaterThan(0);
    expect(knowledgeCitations(evidence).length).toBe(evidence.hits.length);
    for (const hit of evidence.hits) expect(hit.source.label.length).toBeGreaterThan(0);
  });

  it('当前题 + 提示语境下不泄露参考答案', () => {
    const evidence = retrieveForCopilot({
      query: '这道题给我一点提示',
      activeQuestion,
      mode: 'hint',
      limit: 8,
    });
    const joined = evidence.hits.map((h) => h.content).join('\n');
    expect(joined).not.toContain('参考答案：');
    expect(joined).not.toContain('正确选项：');
  });

  it('同一问题在 answer 模式可以看到解析', () => {
    const evidence = retrieveForCopilot({
      query: '这题的答案是什么',
      activeQuestion,
      mode: 'answer',
      limit: 8,
    });
    expect(evidence.mode).toBe('answer');
    expect(evidence.hits.map((h) => h.content).join('\n')).toContain('解析：');
  });

  it('P0-2：有当前题(rag)问另一知识点 → 锚定该节点、不被当前题 topic 限制', () => {
    const evidence = retrieveForCopilot({ query: 'GQA 和 MQA 有什么区别', activeQuestion, limit: 5 });
    expect(evidence.scope).toBe('topic');
    expect(evidence.seeds).toContain('gqa');
    expect(evidence.seeds).not.toContain('rag'); // 关键：没有退化为 activeQuestion.topic
  });

  it('P0-2：有当前题求提示 → current_question 范围（锚定当前题）', () => {
    const evidence = retrieveForCopilot({ query: '给我一点提示，不要直接给答案', activeQuestion, limit: 5 });
    expect(evidence.scope).toBe('current_question');
  });

  it('P0-B：有当前题(rag)问 GQA → 检索结果不含任何题库真值（只是想聊知识）', () => {
    const evidence = retrieveForCopilot({ query: 'GQA 和 MQA 有什么区别', activeQuestion, limit: 8 });
    expect(evidence.scope).toBe('topic');
    expect(evidence.mode).toBe('hint');
    const joined = evidence.hits.map((h) => h.content).join('\n');
    expect(joined).not.toContain('正确选项：');
    expect(joined).not.toContain('参考答案：');
    expect(joined).not.toContain('解析：');
  });

  it('P0-B：明确谈当前题时仍可拿到该题真值（explain 未被误伤）', () => {
    const evidence = retrieveForCopilot({ query: '这道题我不会，给我详细解读', activeQuestion, limit: 8 });
    expect(evidence.scope).toBe('current_question');
    expect(evidence.mode).toBe('explain');
    expect(evidence.hits.map((h) => h.content).join('\n')).toContain('解析：');
  });

  it('P1：priorKnowledgeIds 接成 graph 种子，让确定性 follow-up 也吃到上一轮知识点邻域', () => {
    const evidence = retrieveForCopilot({
      query: '那显存呢',
      activeQuestion,
      priorKnowledgeIds: ['kv-cache'],
      limit: 5,
    });
    expect(evidence.seeds).toContain('kv-cache');
  });
});
