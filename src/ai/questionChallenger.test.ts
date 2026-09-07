import { describe, expect, it } from 'vitest';
import { buildQuestionChallengeUser, challengeQuestion, parseQuestionChallenge, summarizeChallenges, type ChallengeOutcome } from './questionChallenger';
import type { Question } from '../schemas/question';

const question: Question = {
  id: 'challenger-test',
  category: 'ai-systems',
  topic: 'tool-security',
  difficulty: 'medium',
  angle: 'system-design',
  question: '一家金融机构要推广 AI 客服。为了降低安全配置漂移，哪种做法最合理？',
  explanation: '使用标准模板和自动化基线。',
  source: { materialId: 'https://example.com/lens', section: 'Security by design' },
  formats: {
    choice: {
      type: 'single',
      options: ['使用标准模板和自动化基线', '每个团队手工配置', '上线后再修复', '关闭审计'],
      answer: [0],
    },
  },
};

const lensPrerequisiteQuestion: Question = {
  ...question,
  question: '哪种安全策略更符合金融服务 Lens？',
};

describe('question challenger', () => {
  it('does not expose source metadata to the challenger model', () => {
    const prompt = buildQuestionChallengeUser(question);
    expect(prompt).toContain(question.question);
    expect(prompt).toContain('source、tags、category、topic、subtopic');
    expect(prompt).not.toContain('https://example.com/lens');
  });

  it('rejects a source-framework prerequisite even when the model accepts it', async () => {
    const result = await challengeQuestion(lensPrerequisiteQuestion, async () => JSON.stringify({
      verdict: 'accept',
      summary: '看起来合理',
      issues: [],
    }));
    expect(result.verdict).toBe('reject');
    expect(result.issues[0].dimension).toBe('self-contained');
    expect(result.issues[0].severity).toBe('critical');
  });

  it('parses an acceptable model challenge result', () => {
    const result = parseQuestionChallenge(JSON.stringify({
      verdict: 'accept',
      summary: '目标、约束和答案都清楚。',
      issues: [{
        severity: 'pass',
        dimension: 'self-contained',
        issue: '不依赖来源。',
        evidence: '题干给出了配置漂移目标。',
        suggestion: '无需修改。',
      }],
    }), question);
    expect(result.verdict).toBe('accept');
    expect(result.issues).toHaveLength(1);
  });

  it('falls back to a review issue for malformed model output', () => {
    const result = parseQuestionChallenge('not json', question);
    expect(result.verdict).toBe('revise');
    expect(result.issues[0].severity).toBe('critical');
  });

  it('uses the injected completion implementation', async () => {
    const result = await challengeQuestion(question, async () => JSON.stringify({
      verdict: 'accept',
      summary: '题目自包含。',
      issues: [],
    }));
    expect(result.verdict).toBe('accept');
  });

  // P1-6：区分度偏低（value=low）的题即使结构正确也降为 revise，避免只考记忆背诵的题入库。
  it('value=low 时把 accept 降级为 revise', () => {
    const result = parseQuestionChallenge(JSON.stringify({
      verdict: 'accept',
      value: 'low',
      summary: '结构正确但太 trivial。',
      issues: [{ severity: 'pass', dimension: 'self-contained', issue: '自包含', evidence: '题干完整', suggestion: '无需修改' }],
    }), question);
    expect(result.verdict).toBe('revise');
    expect(result.value).toBe('low');
    expect(result.summary).toContain('区分度偏低');
  });

  // 回归：过去统一问「是否只有一个正确答案」，对多选题是错误判据（多选题本就有多个正确答案）。
  it('多选题质询使用「答案有效性」判据，不再要求唯一正确答案', () => {
    const multi: Question = {
      ...question,
      formats: { choice: { type: 'multiple', options: question.formats.choice!.options, answer: [0, 2] } },
    };
    const prompt = buildQuestionChallengeUser(multi);
    expect(prompt).toContain('多选题');
    expect(prompt).toContain('独立成立');
    expect(prompt).not.toContain('是否只有一个可由通用工程知识推导的正确答案');
  });

  it('单选题质询仍要求恰好一个最佳答案', () => {
    const prompt = buildQuestionChallengeUser(question);
    expect(prompt).toContain('单选题');
    expect(prompt).toContain('恰好有一个');
  });

  it('接受 answer-validity 维度的质询结论', () => {
    const result = parseQuestionChallenge(JSON.stringify({
      verdict: 'revise',
      summary: '多选正确项互为换述。',
      issues: [{ severity: 'critical', dimension: 'answer-validity', issue: '两个正确项是同一判断的换述', evidence: 'B 与 D 同义', suggestion: '合并为一项并补一个真正的正确项' }],
    }), question);
    expect(result.verdict).toBe('revise');
    expect(result.issues[0].dimension).toBe('answer-validity');
  });

  it('value=high 且结构正确时保持 accept', () => {
    const result = parseQuestionChallenge(JSON.stringify({
      verdict: 'accept',
      value: 'high',
      summary: '能区分懂与不懂。',
      issues: [],
    }), question);
    expect(result.verdict).toBe('accept');
    expect(result.value).toBe('high');
  });
});

describe('summarizeChallenges（批量质询汇总：P1-2 challenger 层）', () => {
  const outcome = (id: string, challenge: unknown): ChallengeOutcome =>
    ({ id, challenge: challenge as ChallengeOutcome['challenge'] });

  it('统计结论 / 区分度分布，并按维度累计 critical / warning', () => {
    const s = summarizeChallenges([
      outcome('a', { verdict: 'accept', value: 'high', summary: 'ok', issues: [{ severity: 'pass', dimension: 'logic', issue: 'x', evidence: 'y', suggestion: 'z' }] }),
      outcome('b', {
        verdict: 'revise',
        value: 'low',
        summary: '多选正确项互为换述',
        issues: [
          { severity: 'critical', dimension: 'answer-validity', issue: 'B 与 D 同义', evidence: 'e', suggestion: 's' },
          { severity: 'warning', dimension: 'distractors', issue: '干扰项太弱', evidence: 'e', suggestion: 's' },
        ],
      }),
    ]);
    expect(s.total).toBe(2);
    expect(s.judged).toBe(2);
    expect(s.verdicts).toEqual({ reject: 0, revise: 1, accept: 1, skipped: 0 });
    expect(s.values).toEqual({ high: 1, medium: 0, low: 1, unknown: 0 });
    expect(s.dimensions['answer-validity']).toEqual({ critical: 1, warning: 0 });
    expect(s.dimensions.distractors).toEqual({ critical: 0, warning: 1 });
  });

  it('blockers = reject 或含 critical；reviewQueue 按严重度降序', () => {
    const s = summarizeChallenges([
      outcome('low', { verdict: 'accept', value: 'low', summary: 'trivial', issues: [] }),
      outcome('crit', { verdict: 'revise', summary: '题干不自洽', issues: [{ severity: 'critical', dimension: 'logic', issue: 'i', evidence: 'e', suggestion: 's' }] }),
      outcome('rej', { verdict: 'reject', summary: '来源前置', issues: [] }),
    ]);
    expect(s.blockers.map((b) => b.id).sort()).toEqual(['crit', 'rej']);
    expect(s.reviewQueue[0].id).toBe('rej'); // reject +20 最重
    expect(s.reviewQueue[1].id).toBe('crit');
    expect(s.reviewQueue[2].id).toBe('low'); // value=low 也进队列（+2）
    // 未得结论（LLM 失败）只计入 failed，不污染结论分布
    expect(summarizeChallenges([{ id: 'x', error: 'network down' }])).toMatchObject({ total: 1, judged: 0, failed: 1 });
  });
});
