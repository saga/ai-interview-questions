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

  it('deriveCanonicalId 在同格内自增并跳过已占用', () => {
    expect(deriveCanonicalId('agent-loop', 'debugging', new Set())).toBe('agent-loop-debugging-01');
    expect(deriveCanonicalId('agent-loop', 'debugging', ['agent-loop-debugging-01'])).toBe(
      'agent-loop-debugging-02',
    );
  });
});
