// 选项结构性变换（程序负责，纯逻辑）测试：Fisher–Yates 重排 + answer 索引确定性重映射、
// 顺序变化保证、多选题答案归一化、文本规范化。

import { describe, expect, it } from 'vitest';
import {
  shuffleChoiceOptions,
  ensureDifferentOrder,
  normalizeAnswer,
  normalizeOptionText,
} from './options';

describe('shuffleChoiceOptions', () => {
  it('rng=0 时确定性重排且正确答案经索引重映射仍对应原正确文本', () => {
    // 原题：a(正确) / b / c，answer=[0]
    const r = shuffleChoiceOptions(['a', 'b', 'c'], [0], () => 0);
    // rng=0 → 固定排列 ['b','c','a']，原正确文本 'a' 落在索引 2
    expect(r.options).toEqual(['b', 'c', 'a']);
    expect(r.answer).toEqual([2]);
    // 结构性不变量：正确文本在重映射后仍正确
    expect(r.options[r.answer[0]]).toBe('a');
    // 选项集合不变
    expect(new Set(r.options)).toEqual(new Set(['a', 'b', 'c']));
  });

  it('多选题：多个正确项全部正确重映射并归一化为升序', () => {
    // a / b(正确) / c / d(正确)，answer=[1,3]
    const r = shuffleChoiceOptions(['a', 'b', 'c', 'd'], [1, 3], () => 0);
    // 固定排列 ['b','c','d','a']（originalIndex [1,2,3,0]），原正确 b(原始1)→索引0、d(原始3)→索引2
    expect(r.options).toEqual(['b', 'c', 'd', 'a']);
    expect(r.answer).toEqual([0, 2]);
    expect(r.options[r.answer[0]]).toBe('b');
    expect(r.options[r.answer[1]]).toBe('d');
  });

  it('保证顺序确实变化：rng 产生恒等排列时仍交换前两项', () => {
    // rng=0.999 → Fisher–Yates 不交换任何项（恒等），触发 ensure-different 兜底交换
    const r = shuffleChoiceOptions(['a', 'b', 'c'], [0], () => 0.999);
    expect(r.options).not.toEqual(['a', 'b', 'c']);
    expect(r.options).toEqual(['b', 'a', 'c']);
    expect(r.options[r.answer[0]]).toBe('a');
  });

  it('选项数量与 canonical 一致（一一对应，不改变题量）', () => {
    const r = shuffleChoiceOptions(['a', 'b', 'c', 'd'], [2], () => 0);
    expect(r.options).toHaveLength(4);
  });
});

describe('ensureDifferentOrder', () => {
  it('与原顺序相同则交换前两项', () => {
    expect(ensureDifferentOrder(['a', 'b', 'c'], ['a', 'b', 'c'])).toEqual(['b', 'a', 'c']);
  });

  it('与原顺序不同则保持', () => {
    expect(ensureDifferentOrder(['a', 'b', 'c'], ['c', 'a', 'b'])).toEqual(['c', 'a', 'b']);
  });

  it('长度 < 2 直接返回', () => {
    expect(ensureDifferentOrder(['a'], ['a'])).toEqual(['a']);
  });
});

describe('normalizeAnswer / normalizeOptionText', () => {
  it('normalizeAnswer 升序', () => {
    expect(normalizeAnswer([3, 1, 2])).toEqual([1, 2, 3]);
  });

  it('normalizeOptionText 折叠空白', () => {
    expect(normalizeOptionText('  使用  KV   Cache  ')).toBe('使用 KV Cache');
  });
});
