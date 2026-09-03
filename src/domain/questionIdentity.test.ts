import { describe, expect, it } from 'vitest';
import { assessmentContractOf, deriveCanonicalId, isAssessmentChange } from './questionIdentity';

describe('canonical assessment 身份', () => {
  it('angle/difficulty/topic 任一变化即视为新身份', () => {
    const base = { topic: 'agent-loop', angle: 'mechanism', difficulty: 'medium' as const };
    expect(isAssessmentChange(assessmentContractOf(base), assessmentContractOf({ ...base, angle: 'debugging' }))).toBe(true);
    expect(isAssessmentChange(assessmentContractOf(base), assessmentContractOf({ ...base, difficulty: 'hard' }))).toBe(true);
    expect(isAssessmentChange(assessmentContractOf(base), assessmentContractOf({ ...base, topic: 'rag' }))).toBe(true);
    expect(isAssessmentChange(assessmentContractOf(base), assessmentContractOf({ ...base }))).toBe(false);
  });

  it('cognitiveTask 变化即视为新身份（D2 入约；缺省按 undefined 比较）', () => {
    const base = { topic: 'agent-loop', angle: 'mechanism', difficulty: 'medium' as const };
    const explained = { ...base, cognitiveTask: 'explain' as const };
    expect(isAssessmentChange(assessmentContractOf(base), assessmentContractOf(explained))).toBe(true);
    expect(
      isAssessmentChange(
        assessmentContractOf(explained),
        assessmentContractOf({ ...explained, cognitiveTask: 'diagnose' as const }),
      ),
    ).toBe(true);
    expect(isAssessmentChange(assessmentContractOf(explained), assessmentContractOf({ ...explained }))).toBe(false);
    // 存量题皆无该字段：两者皆缺省视为同一身份
    expect(isAssessmentChange(assessmentContractOf(base), assessmentContractOf({ ...base }))).toBe(false);
  });

  it('deriveCanonicalId 在同格内自增并跳过已占用', () => {
    expect(deriveCanonicalId('agent-loop', 'debugging', new Set())).toBe('agent-loop-debugging-01');
    expect(deriveCanonicalId('agent-loop', 'debugging', ['agent-loop-debugging-01'])).toBe(
      'agent-loop-debugging-02',
    );
  });
});
