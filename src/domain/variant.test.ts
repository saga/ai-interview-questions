// 纯逻辑测试：LLM 变体候选校验与落地（ADR-036 轻量变体）。
// 契约：LLM 只产出 { question, options }；answer / explanation 恒取 canonical，选项顺序由程序重排。

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

/** 多选题（两个正确项）：验证多正确项在程序重排后的索引重映射。 */
const cqm: Question = {
  ...cq,
  id: 'xm',
  formats: { choice: { type: 'multiple', options: ['a', 'b', 'c', 'd'], answer: [1, 3] } },
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
  // 默认题干含 canonical 锚点（regularization 节点的 required 含 L2 / weight decay），
  // 默认选项与 cq 的 3 个选项一一对应（选择题变体必须提供等长 options）。
  return {
    question: 'L2 正则化通过对权重施加平方惩罚来平滑收缩权重，与 weight decay 在标准 SGD 下等价',
    options: ['x', 'y', 'z'],
    ...partial,
  };
}

describe('validateVariant（结构不变量）', () => {
  it('题干非空 + options 齐全 → 通过', () => {
    expect(validateVariant(cq, variant()).ok).toBe(true);
  });

  it('题干为空 → 拒绝', () => {
    expect(validateVariant(cq, variant({ question: '   ' })).ok).toBe(false);
  });

  it('选择题缺少 options → 拒绝（P0：只改题干不动选项的候选不接受）', () => {
    expect(validateVariant(cq, variant({ options: undefined })).ok).toBe(false);
  });

  it('options 数量与 canonical 不同 → 拒绝（选项须一一对应）', () => {
    expect(validateVariant(cq, variant({ options: ['a', 'b'] })).ok).toBe(false);
    expect(validateVariant(cq, variant({ options: ['a', 'b', 'c', 'd'] })).ok).toBe(false);
  });

  it('options 含空字符串 → 拒绝', () => {
    expect(validateVariant(cq, variant({ options: ['a', '  ', 'c'] })).ok).toBe(false);
  });

  it('options 重复 → 拒绝', () => {
    expect(validateVariant(cq, variant({ options: ['a', 'a', 'b'] })).ok).toBe(false);
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
});

describe('validateVariant（语义锚定）', () => {
  it('完全丢失 topic/tags/required 证据 → 拒绝', () => {
    expect(validateVariant(cq, variant({ question: '在 CNN 训练中 BatchNorm 为什么不稳定？' })).ok).toBe(false);
  });

  it('必考概念只出现在选项里、题干已漂移 → 拒绝（证据面只看题干）', () => {
    // 选项里塞满 required 概念也没用：证据面只看题干，概念出现在选项 ≠ 题干在考察它。
    expect(
      validateVariant(
        cq,
        variant({
          question: '在 CNN 训练中 batch size 很小时，BatchNorm 为什么不稳定？',
          options: ['L2 正则化平滑收缩权重', '与 weight decay 在标准 SGD 下等价', '两者都对'],
        }),
      ).ok,
    ).toBe(false);
  });

  it('锚点命中即通过（不再强制 requiredConcepts 2/3 字面覆盖）', () => {
    // 只含 topic 词、未覆盖 required 字面概念的变体现在应放行：
    // 2/3 字面覆盖门槛会误杀「换场景不换知识点」的合法变体，已于第四轮删除。
    expect(validateVariant(cq, variant({ question: 'regularization 的本质是什么？' })).ok).toBe(true);
  });

  it('GeneratedVariant 契约只含 question/options（无靠解析蒙混的入口）', () => {
    const v = variant({ question: '在 CNN 训练中 BatchNorm 为什么不稳定？' });
    expect(Object.keys(v).sort()).toEqual(['options', 'question']);
    expect(validateVariant(cq, v).ok).toBe(false);
  });

  it('已知局限：换场景但题干完全不出现 topic/required 字面词的变体仍会被拒（走 fallback 原题）', () => {
    // 「为什么 KV Cache 能降低 prefill 成本？」→「某服务前缀高度重复却仍重复前向计算，如何降低开销？」
    // 是合法的好变体，但题干无锚点可命中，锚定闸门会拒。这是刻意保留的保守行为：
    // 失败只回退原题（不影响正确性），且现在可通过 variant 遥测的 fallbackReason 观测真实比例。
    expect(
      validateVariant(cq, variant({ question: '某在线服务发现输入前缀高度重复却仍重复相同计算，如何降低开销？' })).ok,
    ).toBe(false);
  });

  it('fuzzball 兜底：拼写/形态差异仍视为证据（regularisation ↔ regularization）', () => {
    const cqEn: Question = { ...cq, topic: 'regularisation', tags: [] };
    expect(validateVariant(cqEn, variant({ question: 'regularization 的本质是什么？' })).ok).toBe(true);
    expect(validateVariant(cqEn, variant({ question: 'CNN 卷积核大小如何选择？' })).ok).toBe(false);
  });

  it('fuzzball 兜底：短语级 token_set 对长文本有效（batch statistics ↔ statistics across batch）', () => {
    const q: Question = { ...cq, id: 't', topic: 'layer-normalization', tags: ['batch statistics'] };
    expect(
      validateVariant(
        q,
        variant({
          question: 'LayerNorm does not rely on statistics computed across the batch',
          options: ['x', 'y', 'z'],
        }),
      ).ok,
    ).toBe(true);
  });
});

describe('applyVariant（程序结构变换）', () => {
  it('选择题：程序重排后，正确答案文本经索引重映射仍正确（顺序无关）', () => {
    // variant options 与原题按位置一一对应：'a'→'x'、'b'→'y'、'c'→'z'（canonical 正确项 = 'a'）
    const r = applyVariant(cq, variant({ question: 'regularization 变体' }));
    expect(r.question).toBe('regularization 变体');
    expect(new Set(r.formats.choice?.options)).toEqual(new Set(['x', 'y', 'z']));
    expect(r.formats.choice?.options[r.formats.choice.answer[0]]).toBe('x');
  });

  it('多选题：多个正确项全部正确重映射且升序', () => {
    const r = applyVariant(cqm, variant({ options: ['w', 'x', 'y', 'z'] }));
    const answer = r.formats.choice!.answer;
    expect(answer).toEqual([...answer].sort((a, b) => a - b));
    // canonical 正确项 = 索引 1('x') 与 3('z')
    expect(answer.map((i) => r.formats.choice!.options[i]).sort()).toEqual(['x', 'z']);
  });

  it('注入确定性 rng 时重排结果可复现', () => {
    const a = applyVariant(cq, variant({ options: ['x', 'y', 'z'] }), 'choice', () => 0);
    const b = applyVariant(cq, variant({ options: ['x', 'y', 'z'] }), 'choice', () => 0);
    expect(a.formats.choice?.options).toEqual(b.formats.choice?.options);
    expect(a.formats.choice?.answer).toEqual(b.formats.choice?.answer);
  });

  it('解析永远来自 canonical（LLM 不生成解析）', () => {
    expect(applyVariant(cq, variant({ options: ['x', 'y', 'z'] })).explanation).toBe('e');
  });

  it('开放题：仅替换题干，referenceAnswer 永远保留原题的值', () => {
    const r = applyVariant(oq, variant({ question: 'memory 相关变体' }));
    expect(r.question).toBe('memory 相关变体');
    expect(r.formats.open?.referenceAnswer).toBe('REF-ANSWER');
    expect(r.explanation).toBe('e');
    expect(r.aiGenerated).toBe(true);
  });
});

describe('applyVariant / validateVariant 形态对齐（P0-1）', () => {
  // 双形态题：按本次会话实际形态决定变体结构，而不是永远当选择题。
  const dq: Question = {
    ...cq,
    id: 'd',
    formats: { choice: { type: 'single', options: ['a', 'b', 'c'], answer: [0] }, open: { referenceAnswer: 'REF' } },
  };
  // 仅开放形态、且主题与 variant() 默认题干一致（regularization），用于隔离验证「不传 format」的回退
  const oq2: Question = {
    ...cq,
    id: 'y2',
    formats: { open: { referenceAnswer: 'REF-OPEN' } },
  };

  it('format=open：不要求 options，只替换题干', () => {
    expect(validateVariant(dq, variant({ options: undefined }), 'open').ok).toBe(true);
    const r = applyVariant(dq, variant(), 'open');
    expect(r.formats.open?.referenceAnswer).toBe('REF');
    expect(r.formats.choice?.options).toEqual(['a', 'b', 'c']);
    expect(r.formats.choice?.answer).toEqual([0]);
    expect(r.aiGenerated).toBe(true);
  });

  it('format=choice：缺 options 或数量不符 → 拒绝', () => {
    expect(validateVariant(dq, variant({ options: undefined }), 'choice').ok).toBe(false);
    expect(validateVariant(dq, variant({ options: ['x', 'y'] }), 'choice').ok).toBe(false);
  });

  it('format=choice：改写 options 并程序重排，正确文本经重映射仍正确', () => {
    const r = applyVariant(dq, variant({ options: ['x', 'y', 'z'] }), 'choice');
    expect(new Set(r.formats.choice?.options)).toEqual(new Set(['x', 'y', 'z']));
    expect(r.formats.choice?.options[r.formats.choice.answer[0]]).toBe('x');
  });

  it('不传 format 时回退到 canonical 是否含 choice', () => {
    // dq 含 choice → 视为选择题，缺 options 即拒
    expect(validateVariant(dq, variant({ options: undefined })).ok).toBe(false);
    // oq2 仅 open → 视为开放题，缺 options 无妨
    expect(validateVariant(oq2, variant({ options: undefined })).ok).toBe(true);
  });
});
