// 纯逻辑测试：LLM 变体候选校验与落地（ADR-036）。
// 安全模型：LLM 可重构 Presentation，但需通过 Knowledge Contract 校验。

import { describe, it, expect } from 'vitest';
import { applyVariant, validateVariant } from './variant';
import type { GeneratedVariant } from '../types';
import type { Question } from '../schemas/question';

const cq: Question = {
  id: 'x',
  category: 'machine-learning',
  topic: 'regularization',
  tags: [],
  difficulty: 'medium',
  question: 'q',
  explanation: 'e',
  formats: { choice: { type: 'single', options: ['a', 'b', 'c'], answer: [0] } },
};

const oq: Question = {
  id: 'y',
  category: 'agentic-ai',
  topic: 'memory',
  tags: [],
  difficulty: 'medium',
  question: 'q',
  explanation: 'e',
  formats: { open: { referenceAnswer: 'REF-ANSWER' } },
};

function variant(partial: Partial<GeneratedVariant> = {}): GeneratedVariant {
  // 默认题干需包含 canonical topic 与 requiredConcepts 的证据，避免保守 concept 检查误伤
  // （regularization 节点的 2 条 required：L1/L2 平滑收缩权重、weight decay 等价）
  return {
    question: 'L2 正则化通过对权重施加平方惩罚来平滑收缩权重，与 weight decay 在标准 SGD 下等价',
    ...partial,
  };
}

describe('validateVariant', () => {
  it('题干非空 → 通过', () => {
    expect(validateVariant(cq, variant()).ok).toBe(true);
  });

  it('题干为空 → 拒绝', () => {
    expect(validateVariant(cq, variant({ question: '   ' })).ok).toBe(false);
  });

  it('选择题：提供合法 options/answer → 通过', () => {
    expect(validateVariant(cq, variant({ options: ['x', 'y', 'z'], answer: [1] })).ok).toBe(true);
  });

  it('选择题：options 重复 → 拒绝', () => {
    expect(validateVariant(cq, variant({ options: ['a', 'a', 'b'], answer: [0] })).ok).toBe(false);
  });

  it('选择题：answer 越界 → 拒绝', () => {
    expect(validateVariant(cq, variant({ options: ['a', 'b'], answer: [5] })).ok).toBe(false);
  });

  it('选择题：单选题 answer 必须 1 项', () => {
    expect(validateVariant(cq, variant({ options: ['a', 'b'], answer: [0, 1] })).ok).toBe(false);
  });

  it('含依赖原题指代 → 拒绝', () => {
    expect(validateVariant(cq, variant({ question: '原题中的方案如何？' })).ok).toBe(false);
  });

  it('含新增 forbidden 指代（题目中/题干中/前文/下文）→ 拒绝', () => {
    expect(validateVariant(cq, variant({ question: '题目中提到的方案如何？' })).ok).toBe(false);
    expect(validateVariant(cq, variant({ question: '前文中提到的方案' })).ok).toBe(false);
    expect(validateVariant(cq, variant({ question: '下文所述方案' })).ok).toBe(false);
    expect(validateVariant(cq, variant({ question: '题干中的条件' })).ok).toBe(false);
  });

  it('完全丢失 topic/tags/required 证据 → 拒绝（保守漂移检查）', () => {
    // cq topic regularization，required 含 L1/L2，使用完全无关的 CNN/BatchNorm 文本
    expect(
      validateVariant(cq, variant({ question: '在 CNN 训练中 batch size 很小时，BatchNorm 为什么不稳定？', options: undefined, answer: undefined })).ok,
    ).toBe(false);
  });

  it('required 概念命中即通过（L2 命中 L1/L2 必考点）', () => {
    // 包含 L2 即命中 regularization 节点的 required 概念，覆盖率达标 → 通过
    expect(validateVariant(cq, variant({ question: 'L2 正则化在什么场景下优于 L1？' })).ok).toBe(true);
  });

  it('仅 topic 命中但 required 覆盖率不足 → 拒绝（P0-2：不能「任一命中即通过」）', () => {
    // 题干只含 topic 词，未覆盖任何 required 概念（regularization 节点 2 条 required，need=1）
    expect(validateVariant(cq, variant({ question: 'regularization 的本质是什么？' })).ok).toBe(false);
  });

  it('P0-2：解析(explanation)提及 required 但题干/选项未考察 → 仍拒绝', () => {
    // 题干完全漂移（CNN/BatchNorm），即便 explanation 里写满 required 概念也不计（explanation 不计入证据）
    expect(
      validateVariant(
        cq,
        variant({ question: '在 CNN 训练中 BatchNorm 为什么不稳定？', explanation: 'L2 平滑收缩权重，weight decay 与 L2 等价' }),
      ).ok,
    ).toBe(false);
  });

  it('P0-2：required 覆盖率 1/3（realtime-interaction 节点 3 条）→ 拒绝', () => {
    // realtime-interaction 节点含 3 条 required，need = max(1, round(3*2/3)) = 2；只覆盖 1 条 → 拒绝
    const rtq: Question = {
      id: 'rt',
      category: 'system-design',
      topic: 'realtime-interaction',
      tags: [],
      difficulty: 'medium',
      question: 'q',
      explanation: 'e',
      formats: { choice: { type: 'single', options: ['a', 'b', 'c'], answer: [0] } },
    };
    // 仅覆盖第 1 条必考概念（管道架构的声学限制与感知冻结及Bitter Lesson演进）
    const onlyOne = '管道架构的声学限制与感知冻结及Bitter Lesson演进';
    expect(validateVariant(rtq, variant({ question: onlyOne })).ok).toBe(false);
  });

  it('P0-2：required 覆盖率 2/3（realtime-interaction 节点 3 条）→ 通过', () => {
    const rtq: Question = {
      id: 'rt2',
      category: 'system-design',
      topic: 'realtime-interaction',
      tags: [],
      difficulty: 'medium',
      question: 'q',
      explanation: 'e',
      formats: { choice: { type: 'single', options: ['a', 'b', 'c'], answer: [0] } },
    };
    // 覆盖第 1、3 条必考概念（管道架构… / 原生多模态权衡…），缺第 2 条（微轮次时间片并发…）→ 2/3 达标
    const twoOfThree =
      '管道架构的声学限制与感知冻结及Bitter Lesson演进；原生多模态权衡与动态评测、Context/网络/延迟瓶颈——覆盖第 1、3 条必考概念。';
    expect(validateVariant(rtq, variant({ question: twoOfThree })).ok).toBe(true);
  });

  it('fuzzball 兜底：拼写/形态差异仍视为证据（regularisation ↔ regularization）', () => {
    const cqEn: Question = { ...cq, topic: 'regularisation', tags: [] };
    // 精确 token 不命中（regularisation ≠ regularization），但 fuzz token_set 93 ≥75
    expect(validateVariant(cqEn, variant({ question: 'regularization 的本质是什么？' })).ok).toBe(true);
    // 完全漂移仍应拒绝
    expect(validateVariant(cqEn, variant({ question: 'CNN 卷积核大小如何选择？' })).ok).toBe(false);
  });

  it('fuzzball 兜底：短语级 token_set 对长文本有效（batch statistics ↔ statistics across batch）', () => {
    const q: Question = {
      id: 't',
      category: 'tmp',
      topic: 'layer-normalization',
      tags: ['batch statistics'],
      difficulty: 'medium',
      question: 'q',
      explanation: 'e',
      formats: { choice: { type: 'single', options: ['a', 'b', 'c'], answer: [0] } },
    };
    // 包含 token_set 100 的短语
    expect(validateVariant(q, variant({ question: 'LayerNorm does not rely on statistics computed across the batch' })).ok).toBe(true);
  });
});

describe('applyVariant', () => {
  it('选择题：无 options 时保留原选项与答案', () => {
    const r = applyVariant(cq, variant({ question: 'regularization 变体', explanation: 'new-e' }));
    expect(r.question).toBe('regularization 变体');
    expect(r.formats.choice?.options).toEqual(['a', 'b', 'c']);
    expect(r.formats.choice?.answer).toEqual([0]);
    expect(r.explanation).toBe('new-e');
    expect(r.aiGenerated).toBe(true);
  });

  it('选择题：提供 options/answer 时替换', () => {
    const r = applyVariant(cq, variant({ question: 'regularization 变体', options: ['x', 'y', 'z', 'w'], answer: [2] }));
    expect(r.formats.choice?.options).toEqual(['x', 'y', 'z', 'w']);
    expect(r.formats.choice?.answer).toEqual([2]);
  });

  it('开放题：referenceAnswer 永远保留原题的值（LLM 不改写答案）', () => {
    const r = applyVariant(oq, variant({ question: 'memory 相关变体' }));
    expect(r.formats.open?.referenceAnswer).toBe('REF-ANSWER');
    expect(r.question).toBe('memory 相关变体');
    expect(r.aiGenerated).toBe(true);
  });

  it('未提供解析时沿用原解析', () => {
    const r = applyVariant(cq, variant());
    expect(r.explanation).toBe('e');
  });
});

describe('applyVariant / validateVariant 形态对齐（P0-1）', () => {
  // 用 regularization 主题：default variant() 题干已含 required 证据（L2 正则化 / weight decay），
  // 既能满足语义 gate，又便于隔离验证「形态（choice/open）」逻辑本身。
  const dq: Question = {
    id: 'd',
    category: 'machine-learning',
    topic: 'regularization',
    tags: [],
    difficulty: 'medium',
    question: 'q',
    explanation: 'e',
    formats: { choice: { type: 'single', options: ['a', 'b', 'c'], answer: [0] }, open: { referenceAnswer: 'REF' } },
  };
  const oq: Question = {
    id: 'y2',
    category: 'machine-learning',
    topic: 'regularization',
    tags: [],
    difficulty: 'medium',
    question: 'q',
    explanation: 'e',
    formats: { open: { referenceAnswer: 'REF-OPEN' } },
  };

  it('format=open：只替换题干/解析，保留 choice 与 open.referenceAnswer', () => {
    const v = variant();
    const r = applyVariant(dq, v, 'open');
    expect(r.question).toBe(v.question);
    expect(r.explanation).toBe(v.explanation ?? 'e');
    expect(r.formats.open?.referenceAnswer).toBe('REF');
    expect(r.formats.choice?.options).toEqual(['a', 'b', 'c']);
    expect(r.formats.choice?.answer).toEqual([0]);
    expect(r.aiGenerated).toBe(true);
  });

  it('format=choice：替换 options/answer', () => {
    const r = applyVariant(dq, variant({ options: ['x', 'y', 'z', 'w'], answer: [2] }), 'choice');
    expect(r.formats.choice?.options).toEqual(['x', 'y', 'z', 'w']);
    expect(r.formats.choice?.answer).toEqual([2]);
  });

  it('format=open：不要求 options，即使提供非法 options 也不拒绝', () => {
    expect(validateVariant(dq, variant({ options: ['x'], answer: [0] }), 'open').ok).toBe(true);
  });

  it('format=choice：必须 options≥2，非法 options 仍拒绝', () => {
    expect(validateVariant(dq, variant({ options: ['x'], answer: [0] }), 'choice').ok).toBe(false);
  });

  it('不传 format 时回退到 canonical 是否含 choice', () => {
    // dq 含 choice → 不传 format 视为 choice；variant() 仅改题干（不提供 options）仍通过语义校验
    expect(validateVariant(dq, variant()).ok).toBe(true);
    // oq 仅 open → 不传 format 视为 open
    expect(validateVariant(oq, variant()).ok).toBe(true);
  });
});
