// 蓝图层测试：缺口→蓝图转换、变体候选排序、成题校验各分支。
// 纯函数测试，注入合成节点/题目，不读真实数据文件。

import { describe, expect, it } from 'vitest';
import type { KnowledgeNode, Question, QuestionBlueprint } from '../types';
import type { CoverageSuggestion } from './coverage';
import { ANGLE_PURPOSE_TEMPLATES, blueprintFromSuggestion, validateAgainstBlueprint, variantCandidates } from './blueprint';

const nodes: KnowledgeNode[] = [
  {
    id: 'load-balancing',
    name: '负载均衡',
    area: 'moe',
    priority: 'P0',
    summary: '',
    required: ['router 机制', 'expert capacity', 'auxiliary loss'],
    misconceptions: ['MoE ≠ 更小的模型'],
    angles: ['definition', 'mechanism', 'tradeoff'],
  },
];

function suggestion(angle: CoverageSuggestion['angle'], nodeId = 'load-balancing'): CoverageSuggestion {
  return { nodeId, name: nodeId, priority: 'P0', angle, difficulty: 'hard', format: 'open' };
}

describe('blueprintFromSuggestion', () => {
  it('purpose 来自角度模板 + 知识点名，expectedConcepts 取节点 required', () => {
    const bp = blueprintFromSuggestion(suggestion('mechanism'), nodes)!;
    expect(bp).toEqual({
      topic: 'load-balancing',
      angle: 'mechanism',
      difficulty: 'hard',
      format: 'open',
      purpose: '检验学习者是否理解负载均衡的内在机制与成因',
      expectedConcepts: ['router 机制', 'expert capacity', 'auxiliary loss'],
    });
    expect(bp.expectedConcepts).not.toBe(nodes[0].required); // 拷贝而非引用
  });

  it('每个角度都有 purpose 模板（穷尽性）', () => {
    for (const a of Object.keys(ANGLE_PURPOSE_TEMPLATES)) {
      const bp = blueprintFromSuggestion(suggestion(a as never), nodes)!;
      expect(bp.purpose).toContain('负载均衡');
    }
  });

  it('topic 无知识节点时返回 null（游离题不进生产管线）', () => {
    expect(blueprintFromSuggestion(suggestion('definition', 'ghost-topic'), nodes)).toBeNull();
  });
});

function q(id: string, topic: string, angle?: Question['angle']): Question {
  return {
    id,
    category: 'moe',
    topic,
    tags: [],
    difficulty: 'medium',
    question: 'q',
    explanation: '',
    angle,
    formats: {
      choice: { type: 'single', options: ['a', 'b'], answer: [0] },
      open: { referenceAnswer: 'ref' },
    },
  };
}

describe('variantCandidates', () => {
  const bank = [
    q('near-1', 'load-balancing', 'definition'), // 距 tradeoff=3
    q('near-2', 'load-balancing', 'mechanism'), // 距 tradeoff=2
    q('other-topic', 'kv-cache', 'tradeoff'), // 不同 topic，排除
    q('untagged', 'load-balancing'), // 无标注排最后
    q('far-1', 'load-balancing', 'tradeoff'), // 距离 0
  ];
  const bp: QuestionBlueprint = {
    topic: 'load-balancing',
    angle: 'tradeoff',
    difficulty: 'hard',
    format: 'open',
    purpose: 'p',
    expectedConcepts: [],
  };

  it('只取同 topic 题，按角度梯度距离升序，无标注排最后；同距按 id 稳定排序', () => {
    const ids = variantCandidates(bank, bp).map((x) => x.id);
    expect(ids).toEqual(['far-1', 'near-2', 'near-1', 'untagged']);
  });

  it('空题库 / 无同主题题 → 空数组', () => {
    expect(variantCandidates([], bp)).toEqual([]);
    expect(variantCandidates([q('x', 'kv-cache', 'definition')], bp)).toEqual([]);
  });
});

describe('validateAgainstBlueprint', () => {
  const bp: QuestionBlueprint = {
    topic: 'load-balancing',
    angle: 'scenario',
    difficulty: 'hard',
    format: 'open',
    purpose: 'p',
    expectedConcepts: [],
  };

  it('全部一致且具备目标形态时通过', () => {
    const good: Question = { ...q('new-1', 'load-balancing', 'scenario'), difficulty: 'hard' };
    expect(validateAgainstBlueprint(good, bp)).toEqual({ ok: true });
  });

  it.each([
    ['topic 不一致：期望 load-balancing，实际 kv-cache', { ...q('n', 'load-balancing', 'scenario'), difficulty: 'hard' as const, topic: 'kv-cache' }],
    ['angle 不一致：期望 scenario，实际 mechanism', { ...q('n', 'load-balancing', 'scenario'), difficulty: 'hard' as const, angle: 'mechanism' as const }],
    ['difficulty 不一致：期望 hard，实际 easy', { ...q('n', 'load-balancing', 'scenario'), difficulty: 'easy' as const }],
    ['缺少目标形态 open', { ...q('n', 'load-balancing', 'scenario'), difficulty: 'hard' as const, formats: {} }],
  ])('%s', (reason, question) => {
    expect(validateAgainstBlueprint(question as Question, bp)).toEqual({ ok: false, reason });
  });
});
