import { describe, expect, it } from 'vitest';
import { DEFAULT_MIN_CONFIDENCE, inferAssessment } from './assessmentInference';
import type { AssessmentInferenceInput } from './assessmentInference';

const base: AssessmentInferenceInput = {
  question: '关于该机制，以下哪项描述是正确的？',
  explanation: '该机制通过把确定性控制流放在代码侧来提升可预测性。这是它的核心动机。',
  angle: 'tradeoff',
  cognitiveTask: 'evaluate',
  correctOptions: ['把确定性控制流放在代码侧以提升可预测性'],
  distractors: ['把控制流全部交给模型自主决定', '所有工具调用都必须人工审批'],
};

describe('inferAssessment', () => {
  it('从解析抽出核心断言句作为 target，并给出带选项内容的推理链', () => {
    const r = inferAssessment(base);
    expect(r).not.toBeNull();
    expect(r!.target).toContain('该机制通过把确定性控制流放在代码侧来提升可预测性');
    expect(r!.reasoningGoal).toContain('先明确取舍发生在哪两个维度之间');
    // 推理链要落到本题的具体选项上，而不是只写起手动作
    expect(r!.reasoningGoal).toContain('把确定性控制流放在代码侧');
    expect(r!.reasoningGoal).toContain('把控制流全部交给模型自主决定');
  });

  it('多选与单选的 target 措辞不同', () => {
    const multi = inferAssessment({ ...base, correctOptions: [base.correctOptions[0], '另一条也成立的描述'] });
    expect(multi!.target.startsWith('能逐项判断')).toBe(true);
    expect(inferAssessment(base)!.target.startsWith('能判断「')).toBe(true);
  });

  it('跳过以选项字母起头的逐项判错句', () => {
    const r = inferAssessment({
      ...base,
      explanation: 'A 项错误：该说法夸大了模型的作用。真正的动机是让 Agent 行为可预测。',
    });
    expect(r!.target).toContain('真正的动机是让 Agent 行为可预测');
    expect(r!.target).not.toContain('A 项错误');
  });

  it('跳过元信息行（本题考查… / 答案：C）', () => {
    const r = inferAssessment({
      ...base,
      explanation: '本题考查该机制。答案：C。该机制通过把确定性控制流放在代码侧来提升可预测性。',
    });
    expect(r!.target).not.toContain('本题考查');
    expect(r!.target).not.toContain('答案');
  });

  it('不拿干扰项复述当测量目标', () => {
    const r = inferAssessment({
      ...base,
      explanation: '把控制流全部交给模型自主决定确实更灵活，但这不是该机制的动机。真正动机是让行为可预测可测试。',
    });
    expect(r!.target).not.toContain('把控制流全部交给模型自主决定');
    expect(r!.target).toContain('真正动机是让行为可预测可测试');
  });

  it('抽不到断言句时返回 null（不用模板文本灌满）', () => {
    expect(inferAssessment({ ...base, explanation: '短句。' })).toBeNull();
    expect(inferAssessment({ ...base, explanation: undefined })).toBeNull();
  });

  it('无谓语信号的名词罗列不通过（长度不足 30）', () => {
    expect(inferAssessment({ ...base, explanation: '滑动窗口加边界回退。真正的动机是提升可预测性。' })).not.toBeNull();
    expect(inferAssessment({ ...base, explanation: '滑动窗口 + 边界回退。' })).toBeNull();
  });

  it('置信度：完整信号达到默认写入阈值，缺正确项时低于阈值', () => {
    expect(inferAssessment(base)!.confidence).toBeGreaterThanOrEqual(DEFAULT_MIN_CONFIDENCE);
    const noOptions = inferAssessment({ ...base, correctOptions: [], distractors: [] });
    expect(noOptions!.confidence).toBeLessThan(DEFAULT_MIN_CONFIDENCE);
  });

  it('起手动作优先取 angle，其次 cognitiveTask，都没有时给中性兜底', () => {
    expect(inferAssessment({ ...base, angle: 'debugging', cognitiveTask: undefined })!.reasoningGoal).toContain(
      '先定位现象的直接诱因',
    );
    expect(inferAssessment({ ...base, angle: undefined, cognitiveTask: 'predict' })!.reasoningGoal).toContain(
      '先推断该条件下会发生的后果',
    );
    expect(inferAssessment({ ...base, angle: undefined, cognitiveTask: undefined })!.reasoningGoal).toContain(
      '先确定判断所依赖的依据',
    );
  });

  it('signals 记录来源，供审计侧车追责', () => {
    const r = inferAssessment(base);
    expect(r!.signals).toContain('claim:explanation');
    expect(r!.signals).toContain('angle');
    expect(r!.signals).toContain('correct:1');
    expect(r!.signals).toContain('distractors:2');
  });
});
