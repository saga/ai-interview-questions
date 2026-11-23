import { describe, expect, it } from 'vitest';
import { detectAnswerLengthBalance, detectOptionLengthRatio } from './bias';

const chars = (character: string, length: number) => character.repeat(length);

describe('detectOptionLengthRatio', () => {
  it('默认以 1.7 为上限', () => {
    expect(detectOptionLengthRatio([chars('a', 34), chars('b', 20)]).biased).toBe(false);
    expect(detectOptionLengthRatio([chars('a', 35), chars('b', 20)]).biased).toBe(true);
  });
});

describe('detectAnswerLengthBalance', () => {
  it('正确项与干扰项接近时通过', () => {
    const result = detectAnswerLengthBalance(
      [chars('A', 40), chars('B', 39), chars('C', 41), chars('D', 40)], [0], 'single',
    );
    expect(result.biased).toBe(false);
    expect(result.averageGap).toBeLessThanOrEqual(8);
    expect(result.singleCorrectLead).toBeLessThanOrEqual(4);
  });

  it('正确项平均长度明显更长时拒绝', () => {
    const result = detectAnswerLengthBalance(
      [chars('A', 40), chars('B', 30), chars('C', 31), chars('D', 29)], [0], 'single',
    );
    expect(result.biased).toBe(true);
    expect(result.averageGap).toBeGreaterThan(8);
  });

  it('正确项平均长度明显更短时同样拒绝', () => {
    const result = detectAnswerLengthBalance(
      [chars('A', 20), chars('B', 30), chars('C', 31), chars('D', 32)], [0], 'single',
    );
    expect(result.biased).toBe(true);
    expect(result.averageGap).toBeLessThan(-8);
  });

  it('单选正确项即使均长差未超 8，也不能比最长干扰项长超过 4 字符', () => {
    const result = detectAnswerLengthBalance(
      [chars('A', 50), chars('B', 45), chars('C', 44), chars('D', 44)], [0], 'single',
    );
    expect(Math.abs(result.averageGap)).toBeLessThan(8);
    expect(result.singleCorrectLead).toBe(5);
    expect(result.biased).toBe(true);
  });

  it('多选按正确项组与干扰项组的平均长度比较', () => {
    const result = detectAnswerLengthBalance(
      [chars('A', 39), chars('B', 40), chars('C', 41), chars('D', 30)], [0, 1, 2], 'multiple',
    );
    expect(result.biased).toBe(true);
    expect(result.detail).toContain('相差');
  });

  it('缺少可比较项时不抛异常，结构错误仍由 schema 负责', () => {
    expect(() => detectAnswerLengthBalance([], [], 'single')).not.toThrow();
    expect(detectAnswerLengthBalance(['only option'], [0], 'single').biased).toBe(false);
    expect(detectAnswerLengthBalance(['a', 'b'], [99], 'single').biased).toBe(false);
  });
});
