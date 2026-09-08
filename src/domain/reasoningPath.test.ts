import { describe, expect, it } from 'vitest';
import {
  checkKindContentMatch,
  findNearIdenticalPaths,
  findReasoningPathDuplicates,
  hasExplicitReasoningSteps,
  isAssessmentIdentical,
  isGenericReasoningGoal,
  isNearIdenticalPath,
  isReasoningGoalWellFormed,
} from './reasoningPath';

const CANON = {
  target: '能判断「温度系数 T 增大时软目标分布更平滑」',
  reasoningGoal: '先确定温度系数与分布平滑度的关系；据此确认「T 增大分布更平滑」成立；并排除「T 只影响收敛速度」等不成立描述。',
};

describe('isAssessmentIdentical（阻断级：逐字相同）', () => {
  it('完全相同 → true', () => {
    expect(isAssessmentIdentical({ ...CANON }, { ...CANON })).toBe(true);
  });

  it('空白/大小写差异仍判相同', () => {
    expect(
      isAssessmentIdentical(
        { target: ' 能判断「X」 ', reasoningGoal: CANON.reasoningGoal },
        { target: '能判断「X」', reasoningGoal: CANON.reasoningGoal },
      ),
    ).toBe(true);
  });

  it('只换措辞 → false（逐字不同即放过，实质判定交Note审计）', () => {
    expect(
      isAssessmentIdentical(
        { target: CANON.target, reasoningGoal: '先确定温度与分布的关系；据此确认成立；并排除干扰描述。' },
        CANON,
      ),
    ).toBe(false);
  });

  it('未声明（继承）不算 identical', () => {
    expect(isAssessmentIdentical(undefined, CANON)).toBe(false);
    expect(isAssessmentIdentical(CANON, undefined)).toBe(false);
  });
});

describe('isNearIdenticalPath（审计级：双高相似）', () => {
  it('逐字相同必然 near-identical', () => {
    expect(isNearIdenticalPath({ ...CANON }, { ...CANON })).toBe(true);
  });

  it('模板化小改（同 target + 选项摘要不同）→ near-identical', () => {
    const sibling = {
      target: CANON.target,
      reasoningGoal:
        '先确定温度系数与分布平滑度的关系；据此确认「T 增大分布更平滑呀」成立；并排除「T 只影响收敛速度呢」等不成立描述。',
    };
    expect(isNearIdenticalPath(CANON, sibling)).toBe(true);
  });

  it('真正不同的推理链 → false', () => {
    const other = {
      target: '能在约束 T² 缩放下比较梯度量级并推导缩放因子的必要性',
      reasoningGoal: '先在联合损失中对齐软硬标签的梯度量级；再比较有无 T² 时的梯度比值；并排除「T² 只是经验技巧」等不成立描述。',
    };
    expect(isNearIdenticalPath(CANON, other)).toBe(false);
  });
});

describe('findReasoningPathDuplicates / findNearIdenticalPaths', () => {
  it('逐字重复的 sibling 被检出', () => {
    const out = findReasoningPathDuplicates([
      { id: 'a', path: { ...CANON } },
      { id: 'b', path: { ...CANON } },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ a: 'a', b: 'b' });
  });

  it('措辞不同的 sibling 不进阻断名单', () => {
    const out = findReasoningPathDuplicates([
      { id: 'a', path: { ...CANON } },
      { id: 'b', path: { target: CANON.target, reasoningGoal: '先看温度；再确认；并排除干扰。' } },
    ]);
    expect(out).toHaveLength(0);
  });
});

describe('hasExplicitReasoningSteps（离线生成规范）', () => {
  it('先→再→排除齐全 → true', () => {
    expect(hasExplicitReasoningSteps(CANON.reasoningGoal)).toBe(true);
  });

  it('缺排除环节 → false', () => {
    expect(hasExplicitReasoningSteps('先确定温度与分布的关系，再确认结论成立。')).toBe(false);
  });

  it('泛化描述 → false', () => {
    expect(hasExplicitReasoningSteps('考察考生对知识蒸馏的理解程度。')).toBe(false);
    expect(isGenericReasoningGoal('考察考生对知识蒸馏的理解程度。')).toBe(true);
  });

  it('isReasoningGoalWellFormed = 显式步骤 + 非泛化', () => {
    expect(isReasoningGoalWellFormed(CANON.reasoningGoal)).toBe(true);
    expect(isReasoningGoalWellFormed('考察理解')).toBe(false);
  });
});

describe('checkKindContentMatch', () => {
  it('context 类挂名（题干照抄）→ 不匹配', () => {
    const r = checkKindContentMatch('context-options', '原题题干一字不动', '原题题干一字不动');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('kind-content-mismatch');
  });

  it('context 类真实重写 → 通过', () => {
    const r = checkKindContentMatch(
      'context-options',
      '某团队在蒸馏移动端小模型时发现高温下性能反而下降，以下哪项是核心原因？',
      '在研究知识蒸馏的高温极限数学性质时，假设 Teacher 与 Student 的 Logits 分别为 v_i 与 z_i。',
    );
    expect(r.ok).toBe(true);
  });

  it('surface 膨胀成场景 → 判为标错 kind', () => {
    const r = checkKindContentMatch(
      'surface',
      '某团队在某业务的线上生产环境中遇到故障，经过三轮排查后发现配置中心下发延迟叠加缓存雪崩，请问以下哪项是根因？',
      '以下哪项是根因？',
    );
    expect(r.ok).toBe(false);
  });

  it('正常 surface 改写 → 通过', () => {
    const r = checkKindContentMatch('surface-options', '关于复用条件，以下哪项正确？', '关于 KV cache 的复用条件，以下哪项正确？');
    expect(r.ok).toBe(true);
  });
});

describe('findNearIdenticalPaths', () => {
  it('空列表 → 空', () => {
    expect(findNearIdenticalPaths([])).toEqual([]);
  });
});
