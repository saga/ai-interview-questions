// P0-2（DeepSeek KV Cache）：锁死「一场 session 内 system prompt + 工具 schema 恒稳定」不变量。
//
// 为什么重要：DeepSeek 的 KV Cache 是 prefix cache —— 后续请求只有完整复用已落盘的
// [system + tools + history] 前缀才能命中。任何把动态数据（薄弱主题 / 题号 / 答案 / 评分）
// 写进 system prompt 或 tool definition（description / parameters）的行为，都会让前缀从 tools
// 区域开始整段 miss，cache 命中率崩塌。
//
// 本测试证明两点：
//  1) buildAgentSystemPrompt 是纯函数，且安全层 + 契约层永远排在最前、不可被用户指令挤掉
//     （稳定前缀 → 利于跨轮 / 跨 session 复用同一 cache prefix）。
//  2) createAgentTools 产出的工具定义（name / description / parameters）不随 session 运行时状态
//     变化 —— 同一 session 被 mutate、或不同 session（空 / 已作答 / 已评分）之间，工具定义字节一致，
//     且绝不包含任何动态数据（题号 / 薄弱主题 id / 答案）。

import { describe, it, expect } from 'vitest';
import { buildAgentSystemPrompt, INTERVIEW_SECURITY_PROMPT, INTERVIEW_AGENT_SYSTEM_PROMPT } from './prompt';
import { createAgentTools } from './tools';
import { createAgentSession } from './types';
import { emptyProfile } from '../domain/learner';
import type { InterviewAgentSession } from './types';
import type { Question } from '../schemas/question';
import type { EvaluationResult } from '../schemas/evaluation';

const BANK: Question[] = [];

/** 把工具集抽成「定义指纹」：只含 name / description / parameters（不含 execute 闭包）。 */
function toolFingerprint(tools: ReturnType<typeof createAgentTools>) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: JSON.stringify(t.parameters),
  }));
}

describe('P0-2 system prompt 稳定不变量', () => {
  it('buildAgentSystemPrompt 是纯函数：相同输入产出完全相同字符串', () => {
    const a = buildAgentSystemPrompt('只考察 RAG 主题');
    const b = buildAgentSystemPrompt('只考察 RAG 主题');
    expect(a).toBe(b);
    // 空指令也应稳定
    expect(buildAgentSystemPrompt()).toBe(buildAgentSystemPrompt());
  });

  it('安全层 + 契约层永远排在最前，用户自定义指令只能追加在后', () => {
    const base = buildAgentSystemPrompt();
    const withCustom = buildAgentSystemPrompt('请重点考察 attention 机制');
    // 稳定前缀（安全层 + 契约层）完全一致
    expect(withCustom.startsWith(INTERVIEW_SECURITY_PROMPT)).toBe(true);
    expect(withCustom.includes(INTERVIEW_AGENT_SYSTEM_PROMPT)).toBe(true);
    expect(base).toBe(INTERVIEW_SECURITY_PROMPT + '\n\n' + INTERVIEW_AGENT_SYSTEM_PROMPT);
    // 自定义指令作为后缀追加，且不改变前面的稳定部分
    expect(withCustom.endsWith('请重点考察 attention 机制')).toBe(true);
    expect(withCustom.length).toBe(base.length + '请重点考察 attention 机制'.length + 2);
  });

  it('系统提示不含任何「由 session 推导」的动态数据（题号形态）', () => {
    // 系统提示是纯常量拼接，绝不应出现运行时才有的题号；
    // 「评分 / 薄弱 / Coverage」等词是固定的行为策略文案（静态），允许出现，不算动态泄漏。
    const p = buildAgentSystemPrompt('custom');
    expect(p).not.toMatch(/q-[a-z0-9-]+/); // 不应出现题库 id 形态（动态）
  });
});

describe('P0-2 工具 schema 稳定不变量', () => {
  it('工具定义不随 session 运行时状态变化（空 vs 已作答 vs 已评分）', () => {
    const empty: InterviewAgentSession = createAgentSession();

    const answered: InterviewAgentSession = createAgentSession();
    answered.answers['q-rag-1'] = [0, 1];
    answered.currentQuestion = { question: { id: 'q-rag-1' } as Question, format: 'choice' } as any;
    answered.lastSearchIds = ['q-rag-1', 'q-rag-2'];

    const scored: InterviewAgentSession = createAgentSession();
    scored.answers['q-rag-1'] = [0, 1];
    scored.evaluations['q-rag-1'] = { overall: 3 } as EvaluationResult;
    scored.log = [{ at: Date.now(), kind: 'tool', tool: 'getQuestion', summary: 'x', details: {} }];

    const fpEmpty = toolFingerprint(createAgentTools({ bank: BANK, profile: emptyProfile(), provider: null, session: empty }));
    const fpAnswered = toolFingerprint(createAgentTools({ bank: BANK, profile: emptyProfile(), provider: null, session: answered }));
    const fpScored = toolFingerprint(createAgentTools({ bank: BANK, profile: emptyProfile(), provider: null, session: scored }));

    expect(fpAnswered).toEqual(fpEmpty);
    expect(fpScored).toEqual(fpEmpty);
  });

  it('同一 session 被 mutate 后重建工具，定义仍字节一致（运行时状态不污染 schema）', () => {
    const session = createAgentSession();
    const before = toolFingerprint(createAgentTools({ bank: BANK, profile: emptyProfile(), provider: null, session }));

    // 模拟 Agent 跑了几轮后 session 被大量写入（含一个绝不会出现在正常文案里的合成 topic id）
    session.answers['q-a'] = [0];
    session.evaluations['q-a'] = { overall: 2 } as EvaluationResult;
    session.lastSearchIds = ['q-a', 'q-b'];
    session.log.push({ at: Date.now(), kind: 'tool', tool: 'evaluateAnswer', summary: '弱', details: { weakTopics: ['zzz-dyntopic'] } });

    const after = toolFingerprint(createAgentTools({ bank: BANK, profile: emptyProfile(), provider: null, session }));
    expect(after).toEqual(before);
    // 关键：工具 description / parameters 不含任何「由 session 推导」的动态数据
    // （题号、或合成注入的 topic id 'zzz-dyntopic'）。注意「薄弱 / Coverage」等词是工具固定用途文案，允许出现。
    for (const t of after) {
      expect(t.description).not.toMatch(/q-[a-z0-9-]+/); // 不含题号
      expect(t.description).not.toContain('zzz-dyntopic'); // 不含由 session 注入的动态 topic id
      expect(t.parameters).not.toContain('zzz-dyntopic');
    }
  });

  it('工具名 / 数量固定（KV Cache 的 tools 前缀需稳定）', () => {
    const fp = toolFingerprint(createAgentTools({ bank: BANK, profile: emptyProfile(), provider: null, session: createAgentSession() }));
    const names = fp.map((t) => t.name);
    expect(names).toEqual([
      'searchQuestions',
      'getQuestion',
      'evaluateAnswer',
      'getUserWeaknesses',
      'getWeakAngles',
      'getCoverageGaps',
      'finishInterview',
    ]);
  });
});
