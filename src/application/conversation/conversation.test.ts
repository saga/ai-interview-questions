import { describe, expect, it, vi } from 'vitest';
import { askQuestion } from './questionCapability';
import { evaluateAnswer } from './evaluationCapability';
import { routeUserMessage, detectCommand } from './commandDetector';
import { initialConversationContext, questionContext } from './conversationSession';
import { emptyProfile } from '../../domain/learner';
import type { QuestionBank } from '../../types';
import type { Question } from '../../schemas/question';

const question: Question = {
  id: 'conversation-q1',
  category: 'agent-engineering',
  topic: 'agent-fundamentals',
  tags: ['agent'],
  difficulty: 'medium',
  angle: 'mechanism',
  question: 'Agent 的执行循环如何处理工具结果？',
  explanation: '应说明观察、决策和工具执行的闭环。',
  misconceptions: [],
  formats: {
    choice: { type: 'single', options: ['A', 'B', 'C', 'D'], answer: [0] },
    open: { referenceAnswer: '说明观察、决策和工具执行的闭环。' },
  },
};

const bank: QuestionBank = { questions: [question] };

const baseDeps = { bank, profile: emptyProfile(), config: { providers: [], generateOpenQuestions: false } as any, provider: null };

describe('conversation capabilities', () => {
  it('从 canonical question bank 选择题目，并尊重排除列表', async () => {
    await expect(askQuestion(baseDeps, { excludeIds: ['conversation-q1'] })).resolves.toBeNull();
    const result = await askQuestion(baseDeps, { topic: 'agent-fundamentals', format: 'choice' });
    expect(result?.question.id).toBe('conversation-q1');
    expect(result?.format).toBe('choice');
  });

  it('选择题由共享 evaluation capability 确定性判分', async () => {
    const result = await evaluateAnswer(
      { question, format: 'choice' },
      [0],
      null,
    );
    expect(result?.overall).toBe(100);
  });

  it('provider 失败返回 null，不伪造 0 分', async () => {
    const openQuestion = { question, format: 'open' as const };
    const provider = {
      name: 'test',
      generateVariant: vi.fn(),
      challengeQuestion: vi.fn(),
      evaluateOpenAnswer: vi.fn(async () => { throw new Error('provider failed'); }),
    };
    await expect(evaluateAnswer(openQuestion, 'answer', provider as any)).resolves.toBeNull();
  });
});

describe('conversation command routing (ADR-064)', () => {
  it('合法选择题作答在 answer context 下走答案通道，而不是被当成求助', () => {
    const channel = routeUserMessage('A', questionContext(question.id), question);
    expect(channel.kind).toBe('answer');
  });

  it('「这道题我不会，给我详细解读」不再被阻断，走 Copilot 通道', () => {
    const channel = routeUserMessage('这道题我不会，给我一些详细的解读', questionContext(question.id), question);
    expect(channel.kind).toBe('copilot');
  });

  it('不确定是否命令时默认 Copilot，不再弹「意图不确定」', () => {
    const channel = routeUserMessage('什么是 RAG？', initialConversationContext(), null);
    expect(channel.kind).toBe('copilot');
  });

  it('确定性命令识别（不再消耗 LLM 意图分类）', () => {
    expect(detectCommand('给我出一道 RAG 的题')?.kind).toBe('ask_question');
    expect(detectCommand('给我出一道 RAG 的题')?.topic).toBe('rag');
    expect(detectCommand('下一题')?.kind).toBe('continue_interview');
    expect(detectCommand('开始模拟面试')?.kind).toBe('start_interview');
    expect(detectCommand('结束')?.kind).toBe('end_interview');
    expect(detectCommand('重新评价一下')?.kind).toBe('re_evaluate');
  });

  it('未知输入不识别为命令，交由 Copilot', () => {
    expect(detectCommand('随便聊点什么')).toBeNull();
  });

  it('「给我详细解读这道题」命中求助词，不误判为出题命令', () => {
    expect(detectCommand('给我详细解读这道题')).toBeNull();
    expect(routeUserMessage('给我详细解读这道题', questionContext(question.id), question).kind).toBe('copilot');
  });

  it('上一场已结束时「下一题」开新一轮（ask_question 而非续接）', () => {
    const ctx = { ...initialConversationContext(), endedAt: Date.now() };
    expect(detectCommand('下一题', ctx)?.kind).toBe('ask_question');
  });
});

