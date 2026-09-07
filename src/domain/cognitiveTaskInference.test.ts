import { describe, expect, it } from 'vitest';
import { inferCognitiveTask } from './cognitiveTaskInference.ts';

const ask = (question: string, angle?: Parameters<typeof inferCognitiveTask>[0]['angle']) =>
  inferCognitiveTask({ question, angle });

describe('inferCognitiveTask · 题面显式提问方式（优先于 angle）', () => {
  it('数值求解 → infer，即便 angle 不是 calculation', () => {
    expect(ask('某模型 60B 参数从 BF16 转 MXFP4，节省比例约为多少？', 'mechanism')).toMatchObject({
      task: 'infer',
      rule: 'numeric-ask',
    });
  });

  it('追问根因 → diagnose，覆盖 angle=mechanism 的 explain 先验', () => {
    expect(ask('关于该优化机制的诊断与因果关系分析，接受率衰减最可能的原因是什么？', 'mechanism')).toMatchObject({
      task: 'diagnose',
      rule: 'root-cause-ask',
    });
  });

  it('要求比较差异 → compare', () => {
    expect(ask('Vector Search 和 Keyword Search（如 BM25）有什么区别？', 'fundamental')).toMatchObject({
      task: 'compare',
    });
  });

  it('要求权衡取舍 → evaluate', () => {
    expect(ask('Agent A 成功率 80% 但调用 12 次，Agent B 76% 只用 4 次，你会选哪个？', 'scenario')).toMatchObject({
      task: 'evaluate',
    });
  });

  it('要求预测后果 → predict', () => {
    expect(ask('若把全部企业文档塞进 Prompt 彻底淘汰 RAG，系统会发生什么？', 'scenario')).toMatchObject({
      task: 'predict',
    });
  });
});

describe('inferCognitiveTask · angle 先验（对着 43 条人工标注校准）', () => {
  it('calculation → infer', () => {
    expect(ask('该流水线的气泡时间占比是多少？', 'calculation')?.task).toBe('infer');
  });
  it('debugging → diagnose', () => {
    expect(ask('某 Kernel 展开后周期数反而增加 40%，最可能出在哪里？', 'debugging')?.task).toBe('diagnose');
  });
  it('comparison → compare', () => {
    expect(ask('Encoder-Decoder 与 Decoder-Only 在翻译场景下的架构差异', 'comparison')?.task).toBe('compare');
  });
  it('tradeoff → evaluate', () => {
    expect(ask('需要在召回延迟与表征质量之间做权衡', 'tradeoff')?.task).toBe('evaluate');
  });
  it('design → design', () => {
    expect(ask('请给出完整的级联路由架构设计', 'design')?.task).toBe('design');
  });
  it('mechanism → explain', () => {
    expect(ask('关于扩散模型的工作机制，下列哪些说法是正确的？', 'mechanism')?.task).toBe('explain');
  });
  it('definition → identify', () => {
    expect(ask('什么是 Human-in-the-loop？', 'definition')?.task).toBe('identify');
  });
});

describe('inferCognitiveTask · system-design / scenario 二次分流', () => {
  it('出现设计动词 → design', () => {
    expect(ask('你会如何设计 HITL 策略，使高风险操作需要人工审批？', 'system-design')).toMatchObject({
      task: 'design',
      rule: 'design-ask',
    });
  });

  it('陈述辨析（下列哪些说法正确）→ identify', () => {
    expect(ask('关于 Agent 的 System Prompt 在运行时构造，以下哪些说法是正确的？', 'scenario')).toMatchObject({
      task: 'identify',
      rule: 'statement-pick',
    });
  });

  it('既无设计动词也不是陈述辨析 → null（交人工，不猜）', () => {
    expect(ask('在一个日活亿级的图推荐系统中，离线与近实时两条链路应如何配合？', 'scenario')).toBeNull();
  });
});

describe('inferCognitiveTask · 推断不出就返回 null', () => {
  it('fundamental 一律留空：seed 里 explain / identify 各半，规则分不开', () => {
    expect(ask('关于图卷积的谱域视角与空域视角，下列哪些说法是正确的？', 'fundamental')).toBeNull();
  });

  it('未知 angle 留空', () => {
    expect(ask('随便一个题干', undefined)).toBeNull();
  });
});
