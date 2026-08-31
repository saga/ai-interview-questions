import { describe, expect, it } from 'vitest';
import { buildQuestionChallengeUser, challengeQuestion, parseQuestionChallenge } from './questionChallenger';
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
