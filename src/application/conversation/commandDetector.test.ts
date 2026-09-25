import { describe, expect, it } from 'vitest';
import {
  detectCommand,
  isHelpSeeking,
  parseChatAnswer,
  routeUserMessage,
} from './commandDetector';
import { initialConversationContext, questionContext } from './conversationSession';
import type { Question } from '../../schemas/question';

const choiceQuestion: Question = {
  id: 'cd-q1',
  category: 'agent-engineering',
  topic: 'agent-fundamentals',
  tags: ['agent'],
  difficulty: 'medium',
  angle: 'mechanism',
  question: 'Agent 的执行循环如何处理工具结果？',
  explanation: '应说明观察、决策和工具执行的闭环。',
  misconceptions: [],
  formats: { choice: { type: 'single', options: ['A', 'B', 'C', 'D'], answer: [0] } },
};

const openQuestion: Question = {
  id: 'cd-q2',
  category: 'llm',
  topic: 'rag',
  tags: ['rag'],
  difficulty: 'medium',
  angle: 'mechanism',
  question: '简述 RAG 的基本流程。',
  explanation: '检索—增强—生成。',
  misconceptions: [],
  formats: { open: { referenceAnswer: '检索相关文档，拼入上下文，再生成。' } },
};

describe('detectCommand（确定性命令，无 LLM）', () => {
  it('识别训练控制命令及其参数', () => {
    expect(detectCommand('结束')?.kind).toBe('end_interview');
    expect(detectCommand('下一题')?.kind).toBe('continue_interview');
    expect(detectCommand('开始模拟面试')?.kind).toBe('start_interview');
    expect(detectCommand('重新评价一下')?.kind).toBe('re_evaluate');
    expect(detectCommand('跳过这道题')?.kind).toBe('continue_interview');
    expect(detectCommand('换一道')?.kind).toBe('continue_interview');
  });

  it('ask 解析主题别名与难度', () => {
    const rag = detectCommand('给我出一道 RAG 的题');
    expect(rag?.kind).toBe('ask_question');
    expect(rag?.topic).toBe('rag');
    expect(detectCommand('出一道困难题')?.difficulty).toBe('hard');
    expect(detectCommand('出一道简单题')?.difficulty).toBe('easy');
    expect(detectCommand('给我出一道 Transformer 题')?.topic).toBe('transformer');
  });

  it('识别不出返回 null（交由 Copilot，而非报错）', () => {
    expect(detectCommand('讲讲 RAG 的设计权衡')).toBeNull();
    expect(detectCommand('随便聊聊')).toBeNull();
  });

  // ── 「继续」类命令必须整句匹配（P1 回归）──
  // 旧实现只有 `^` 前缀：用户说「继续解释一下」（想让它接着讲），却被判成「要下一题」，
  // 题目当场被换掉。这是与 Copilot 定位直接冲突的行为。
  it('「继续 + 说明动词」不是命令，而是接着讲（让位给 Copilot）', () => {
    expect(detectCommand('继续解释一下')).toBeNull();
    expect(detectCommand('继续讲刚才的知识点')).toBeNull();
    expect(detectCommand('接着讲')).toBeNull();
  });

  // 整句匹配不能把自然说法一起挡掉。`跳过这道题` / `换一道` 已在上一组覆盖，此处只测新增的尾巴形态。
  it('自然说法仍识别为命令（难度修饰 / 语气词）', () => {
    expect(detectCommand('下一题吧')?.kind).toBe('continue_interview');
    const harder = detectCommand('下一题难一点');
    expect(harder?.kind).toBe('continue_interview');
    expect(harder?.difficulty).toBe('hard');
    expect(detectCommand('再难一点')?.kind).toBe('continue_interview');
  });

  it('上一场已结束时「下一题」应开新一轮', () => {
    const ctx = { ...initialConversationContext(), endedAt: Date.now() };
    expect(detectCommand('下一题', ctx)?.kind).toBe('ask_question');
  });
});

describe('isHelpSeeking（求助判定，决定走 Copilot）', () => {
  it('明确的求助/咨询信号', () => {
    expect(isHelpSeeking('这道题我不会')).toBe(true);
    expect(isHelpSeeking('为什么选 B')).toBe(true);
    expect(isHelpSeeking('给我详细解读这道题')).toBe(true);
    expect(isHelpSeeking('RAG 和微调有什么区别？')).toBe(true);
  });

  it('纯选项字母不是求助（那是作答）', () => {
    expect(isHelpSeeking('A')).toBe(false);
    expect(isHelpSeeking('B C')).toBe(false);
  });

  it('训练控制词不误判为求助', () => {
    expect(isHelpSeeking('下一题')).toBe(false);
    expect(isHelpSeeking('结束')).toBe(false);
  });
});

describe('parseChatAnswer（作答解析）', () => {
  it('选择题抽出去重选项下标', () => {
    expect(parseChatAnswer(choiceQuestion, 'A')).toEqual([0]);
    expect(parseChatAnswer(choiceQuestion, 'B,C')).toEqual([1, 2]);
    expect(parseChatAnswer(choiceQuestion, '我觉得是 A 或 D')).toEqual([0, 3]);
  });

  it('选择题抽不出合法选项时回退原文', () => {
    expect(parseChatAnswer(choiceQuestion, '我的理解是观察—决策闭环')).toBe('我的理解是观察—决策闭环');
  });

});

describe('routeUserMessage（唯一通道决策点，ADR-064 §5）', () => {
  it('命令优先于求助', () => {
    expect(routeUserMessage('结束', initialConversationContext()).kind).toBe('command');
    expect(routeUserMessage('下一题', initialConversationContext()).kind).toBe('command');
  });

  it('求助优先于作答：避免「这道题我不会」被误判成一次评分', () => {
    const channel = routeUserMessage('这道题我不会，给我一些详细的解读', questionContext(choiceQuestion.id), choiceQuestion);
    expect(channel.kind).toBe('copilot');
  });

  it('当前确有待作答题且输入可解析为答案时走答案通道', () => {
    expect(routeUserMessage('A', questionContext(choiceQuestion.id), choiceQuestion).kind).toBe('answer');
    expect(routeUserMessage('先检索再生成', questionContext(openQuestion.id), openQuestion).kind).toBe('answer');
  });

  it('其余一律 Copilot，不做「意图不确定」阻断', () => {
    expect(routeUserMessage('什么是 RAG？', initialConversationContext(), null).kind).toBe('copilot');
    expect(routeUserMessage('讲讲 agent 的设计权衡', initialConversationContext(), null).kind).toBe('copilot');
  });

  // 端到端路由（比单独测 detectCommand 更关键）：开放题下**任何非空文本**都会走答案通道，
  // 所以「继续解释一下」若不被判成命令，就必须被判成求助——否则它会被当成一次作答去评分。
  it('待作答开放题时说「继续解释一下」→ Copilot，绝不能被当成一次作答', () => {
    const ctx = questionContext(openQuestion.id);
    expect(routeUserMessage('继续解释一下', ctx, openQuestion).kind).toBe('copilot');
    expect(routeUserMessage('继续讲刚才的知识点', ctx, openQuestion).kind).toBe('copilot');
    expect(routeUserMessage('继续详细说', ctx, openQuestion).kind).toBe('copilot');
  });

  it('待作答开放题时说「继续」→ 仍是命令（换下一题），不受上一条影响', () => {
    expect(routeUserMessage('继续', questionContext(openQuestion.id), openQuestion).kind).toBe('command');
    expect(routeUserMessage('跳过这道题', questionContext(openQuestion.id), openQuestion).kind).toBe('command');
  });
});
