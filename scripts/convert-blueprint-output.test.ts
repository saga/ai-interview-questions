import { describe, expect, it } from 'vitest';
import { mapMisconceptionMap, misconceptionMapsEqual } from './convert-blueprint-helpers.ts';

const opts = [
  { key: 'A' },
  { key: 'B' },
  { key: 'C' },
  { key: 'D' },
];

describe('mapMisconceptionMap', () => {
  it('key 对齐对象 → 索引数组', () => {
    const { array, problems } = mapMisconceptionMap(opts, [0, 2], { A: null, B: 0, C: null, D: 1 }, 'q1');
    expect(problems).toEqual([]);
    expect(array).toEqual([null, 0, null, 1]);
  });

  it('缺 key → 报错且对应槽位补 null', () => {
    const { array, problems } = mapMisconceptionMap(opts, [0], { A: null, B: null, C: null }, 'q1');
    expect(problems).toContain('q1: misconceptionMap 缺少 key "D"');
    expect(array).toEqual([null, null, null, null]);
  });

  it('正确选项标了误解 → 报错', () => {
    const { array, problems } = mapMisconceptionMap(opts, [0, 2], { A: 0, B: null, C: null, D: 1 }, 'q1');
    expect(problems).toContain('q1: 正确选项 A 不应标注误解（保持 null）');
    expect(array).toEqual([0, null, null, 1]);
  });

  it('未声明 map → null', () => {
    const { array, problems } = mapMisconceptionMap(opts, [0], null, 'q1');
    expect(problems).toEqual([]);
    expect(array).toBeNull();
  });
});

describe('misconceptionMapsEqual', () => {
  it('逐项相等', () => {
    expect(misconceptionMapsEqual([null, 0, null, 1], [null, 0, null, 1])).toBe(true);
  });
  it('单槽不等 → false', () => {
    expect(misconceptionMapsEqual([null, 0, null, 1], [null, 1, null, 0])).toBe(false);
  });
  it('长度不等 → false', () => {
    expect(misconceptionMapsEqual([null, 0], [null, 0, null])).toBe(false);
  });
  it('任一为 null → false', () => {
    expect(misconceptionMapsEqual(null, [null, 0])).toBe(false);
  });
});
