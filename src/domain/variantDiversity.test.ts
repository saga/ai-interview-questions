import { describe, expect, it } from 'vitest';
import {
  checkOfflineDifficultyDrivers,
  findSemanticDuplicateVariants,
  reasoningPathKeyOf,
  selectDiverseTopN,
  type DiverseCandidate,
} from './variant';
import type { Question } from '../schemas/question';

const canon = (over: Partial<Question> = {}): Question => ({
  id: 'dq-01',
  category: 'inference',
  topic: 'kv-cache',
  tags: [],
  difficulty: 'medium',
  angle: 'mechanism',
  question: '只有在前缀完全命中时才能复用已有 KV，请问以下哪项正确？',
  explanation: '前缀命中是复用的必要条件。',
  formats: {
    choice: {
      type: 'single',
      options: ['只有命中前缀才能复用 KV cache 以减少计算', '任意位置都能复用 KV cache', '复用与前缀无关', 'KV cache 只用于训练'],
      answer: [0],
    },
  },
  ...over,
});

describe('findSemanticDuplicateVariants（语义级重复）', () => {
  const base = {
    id: 'v1',
    kind: 'surface-options' as const,
    question: '在推理服务中，什么情况下能够复用先前计算好的 KV？',
    options: ['当请求前缀与已缓存前缀完全命中时可以复用', '只要显存充足就能在任意位置复用', '复用与否完全取决于 batch size', '一旦写入即可被任意后续请求复用'],
  };

  it('文本不同但声明了逐字相同的 reasoning path → 重复', () => {
    const path = { target: '能判断复用条件', reasoningGoal: '先看前缀；再确认；并排除干扰。' };
    const out = findSemanticDuplicateVariants([
      { ...base, assessment: { ...path } },
      {
        ...base,
        id: 'v2',
        question: '线上服务前缀重复度很高但仍在重复计算，如何降低这部分开销？',
        options: ['命中已缓存前缀时复用从而省去重复前向', '显存够大即可随意复用中间结果', '复用效果只和批量大小设定有关', '写入缓存后所有请求都能直接命中'],
        assessment: { ...path },
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].basis).toBe('reasoning-path');
  });

  it('都未声明（presentation）→ 不按路径判罪', () => {
    const out = findSemanticDuplicateVariants([
      { ...base },
      { ...base, id: 'v2', question: '在推理服务中，什么情况下能够复用先前算好的 KV？' },
    ]);
    expect(out.filter((p) => p.basis === 'reasoning-path')).toHaveLength(0);
  });

  it('一方声明一方继承 → 不按路径判罪', () => {
    const out = findSemanticDuplicateVariants([
      { ...base, assessment: { target: 't', reasoningGoal: '先看；再确认；并排除。' } },
      { ...base, id: 'v2' },
    ]);
    expect(out.filter((p) => p.basis === 'reasoning-path')).toHaveLength(0);
  });

  it('同 kind 题干照抄 → stem 重复', () => {
    const out = findSemanticDuplicateVariants([
      { ...base, options: ['选项一改写 A', '选项二改写 A', '选项三改写 A', '选项四改写 A'] },
      {
        id: 'v2',
        kind: 'surface-options',
        question: base.question,
        options: ['选项一改写 B（完全不同）', '选项二改写 B（完全不同）', '选项三改写 B（完全不同）', '选项四改写 B（完全不同）'],
      },
    ]);
    expect(out.some((p) => p.basis === 'stem')).toBe(true);
  });

  it('不同 kind 且选项不同 → 不重复', () => {
    const out = findSemanticDuplicateVariants([
      { ...base },
      {
        ...base,
        id: 'v2',
        kind: 'context-options',
        question: '线上服务前缀重复度很高但仍在重复计算，如何降低开销？',
        options: ['命中已缓存前缀时复用从而省去重复前向', '显存够大即可随意复用中间结果', '复用效果只和 batch size 有关', '写入缓存后所有请求都能直接命中'],
      },
    ]);
    // 选项差异大（重述级改写）→ 无重复
    expect(out).toHaveLength(0);
  });
});

describe('checkOfflineDifficultyDrivers（难度驱动项）', () => {
  it('限定词「只有」被删 → dropped-qualifier', () => {
    const r = checkOfflineDifficultyDrivers(canon(), { question: '前缀命中时能复用 KV，以下哪项正确？' });
    expect(r.ok).toBe(false);
    expect(r.flags.some((f) => f.flag === 'dropped-qualifier')).toBe(true);
  });

  it('保留限定词 → 通过', () => {
    const r = checkOfflineDifficultyDrivers(canon(), {
      question: '只有当请求前缀完全命中缓存时，才能复用已有 KV，以下哪项说法成立？',
    });
    expect(r.flags.some((f) => f.flag === 'dropped-qualifier')).toBe(false);
  });

  it('数字条件丢失 → dropped-numeric-condition', () => {
    const q = canon({ question: '当 prefix length ≥ 512 tokens 且只有前缀命中时才能复用，以下哪项正确？' });
    const r = checkOfflineDifficultyDrivers(q, { question: '只有前缀命中时才能复用，以下哪项正确？' });
    expect(r.flags.some((f) => f.flag === 'dropped-numeric-condition')).toBe(true);
  });

  it('引入 ≥3 个新拉丁技术词 → new-prerequisite', () => {
    const r = checkOfflineDifficultyDrivers(canon(), {
      question: '只有前缀命中时才能复用，在 paged attention 的 block table 与 prefix caching 协同下，以下哪项正确？',
    });
    expect(r.flags.some((f) => f.flag === 'new-prerequisite')).toBe(true);
  });

  it('题干泄入正确项独有词 → extra-hint', () => {
    const q = canon({
      question: '关于 KV cache 的复用，以下哪项正确？',
      formats: {
        choice: {
          type: 'single',
          options: ['只有命中前缀才能复用 pagedattention 以减少计算', '任意位置都能复用', '复用与前缀无关', '只用于训练'],
          answer: [0],
        },
      },
    });
    const r = checkOfflineDifficultyDrivers(q, {
      question: '关于 pagedattention 的复用机制，以下哪项正确？',
      options: ['只有命中前缀才能复用 pagedattention 以减少计算', '任意位置都能复用', '复用与前缀无关', '只用于训练'],
    });
    expect(r.flags.some((f) => f.flag === 'extra-hint')).toBe(true);
  });
});

describe('reasoningPathKeyOf', () => {
  it('未声明 → null', () => {
    expect(reasoningPathKeyOf(undefined)).toBeNull();
  });

  it('空白差异归一', () => {
    expect(reasoningPathKeyOf({ target: 'A B', reasoningGoal: '先 X' })).toBe(
      reasoningPathKeyOf({ target: 'AB', reasoningGoal: '先X' }),
    );
  });
});

describe('selectDiverseTopN（MMR 多样性选择）', () => {
  const mk = (key: string, kind: DiverseCandidate['kind'], score: number, optionText: string, pathKey: string | null): DiverseCandidate => ({
    key,
    kind,
    score,
    optionText,
    stemText: `题干${key}`,
    pathKey,
  });

  it('同分时优先选 kind 不同、路径不同的候选', () => {
    const cands = [
      mk('a', 'surface-options', 1, '选项文本甲乙丙丁', 'path-1'),
      mk('b', 'surface-options', 1, '选项文本甲乙丙丁戊', 'path-1'), // 与 a 高度相似且同路径
      mk('c', 'context-options', 1, '完全不同的另一套选项描述', 'path-2'),
    ];
    const picked = selectDiverseTopN(cands, 2);
    expect(picked.map((p) => p.key)).toEqual(['a', 'c']);
  });

  it('高分候选仍优先（分数打底）', () => {
    const cands = [mk('a', 'surface-options', 0.2, '甲', null), mk('b', 'context-options', 1, '乙', null)];
    const picked = selectDiverseTopN(cands, 1);
    expect(picked[0].key).toBe('b');
  });

  it('want 大于候选数 → 全取', () => {
    const cands = [mk('a', 'surface-options', 1, '甲', null)];
    expect(selectDiverseTopN(cands, 5)).toHaveLength(1);
  });

  it('同声明路径的第二个候选被重罚', () => {
    const cands = [
      mk('a', 'surface-options', 1, '甲乙丙丁戊己庚', 'same-path'),
      mk('b', 'context-options', 1, '完全不同的选项文本一二三四', 'same-path'),
      mk('c', 'context-options', 1, '另一套完全不同的选项文本', null),
    ];
    const picked = selectDiverseTopN(cands, 2);
    // b 与 a 同路径（罚 0.6）vs c 无路径（只罚 wording/kind）→ c 入选
    expect(picked.map((p) => p.key)).toEqual(['a', 'c']);
  });
});
