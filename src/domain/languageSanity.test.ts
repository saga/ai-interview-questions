import { describe, expect, it } from 'vitest';
import { checkLanguageSanity } from './languageSanity';

describe('checkLanguageSanity 选项对齐', () => {
  it('选项顺序被打乱时按内容匹配，不误判为从句倒装', () => {
    const canonical = {
      stem: '关于缓存更新，正确的是？',
      options: [
        '因为缓存未命中，查询先回源，再填充本地，最后返回结果。',
        '查询先回源，再填充本地，因为缓存突然未命中，最后返回结果。',
      ],
    };
    const variant = { stem: canonical.stem, options: [canonical.options[1], canonical.options[0]] };

    const result = checkLanguageSanity(variant, canonical);
    expect(result.blockCodes).not.toContain('clause-inversion');
    expect(result.ok).toBe(true);
  });

  it('真正的从句倒装仍然阻断', () => {
    const canonical = {
      stem: '关于缓存更新，正确的是？',
      options: ['查询先回源，再填充本地，最后返回结果。'],
    };
    const variant = { stem: canonical.stem, options: ['最后返回结果，再填充本地，查询先回源。'] };

    const result = checkLanguageSanity(variant, canonical);
    expect(result.blockCodes).toContain('clause-inversion');
    expect(result.ok).toBe(false);
  });
});
