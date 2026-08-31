// 应用层知识检索能力测试（ADR-063 §6/§7）：scope 规划、答案安全模式、prompt 片段。
// query planner 必须确定性——检索范围与"能暴露什么"属于安全边界，不能交给模型判断。

import { describe, expect, it } from 'vitest';
import type { Question } from '../../schemas/question';
import {
  buildKnowledgePromptSection,
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

describe('planRetrievalScope', () => {
  it('提到"这道题"时锁定当前题', () => {
    expect(planRetrievalScope({ query: '这道题为什么选 B', activeQuestion })).toBe('current_question');
    expect(planRetrievalScope({ query: '我刚才那道为什么错了', activeQuestion })).toBe('current_question');
  });

  it('有明确主题时收敛到 topic', () => {
    expect(planRetrievalScope({ query: '讲一下原理', activeQuestion })).toBe('topic');
    expect(planRetrievalScope({ query: '随便聊聊', topic: 'rag' })).toBe('topic');
  });

  it('纯概念提问走 knowledge 层，不塞题目', () => {
    expect(planRetrievalScope({ query: '什么是 reranker？' })).toBe('knowledge');
    expect(planRetrievalScope({ query: 'RAG 和微调有什么区别？' })).toBe('knowledge');
  });

  it('"讲讲 X / 介绍 X" 也判为概念讲解', () => {
    expect(planRetrievalScope({ query: '给我讲讲 RAG' })).toBe('knowledge');
    expect(planRetrievalScope({ query: '介绍一下 KV Cache' })).toBe('knowledge');
  });

  it('其他情况走 global', () => {
    expect(planRetrievalScope({ query: '今天天气不错' })).toBe('global');
  });

  it('显式 scope 优先级最高', () => {
    expect(planRetrievalScope({ query: '这道题为什么选 B', activeQuestion, scope: 'global' })).toBe('global');
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

  it('有当前题但没明说 → 默认 hint，绝不主动泄露真值', () => {
    expect(planRetrievalMode({ query: '讲考点', activeQuestion })).toBe('hint');
  });

  it('没有当前题 → answer', () => {
    expect(planRetrievalMode({ query: '什么是 GQA？' })).toBe('answer');
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
    expect(section).toContain('引用标记');
  });

  it('非 answer 模式写入硬性禁止项', () => {
    const evidence = retrieveForCopilot({ query: 'RAG reranker', mode: 'hint', limit: 3 });
    const section = buildKnowledgePromptSection(evidence);
    expect(section).toContain('模式=hint');
    expect(section).toContain('严禁直接给出或变相暗示正确答案');
  });

  it('片段长度受控，避免单条长文档挤爆上下文', () => {
    const evidence = retrieveForCopilot({ query: 'agent 记忆', scope: 'global', limit: 8 });
    const section = buildKnowledgePromptSection(evidence);
    expect(section.length).toBeLessThan(8000);
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
});
