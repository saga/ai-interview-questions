// textSimilarity.ts 的纯函数测试：锁定 CJK 感知字符级 Dice 的行为，
// 这是「根治单题双变体选项雷同」的度量基础（见 domain/variant.ts 门禁）。

import { describe, it, expect } from 'vitest';
import { cjkTokenize, tokenMultisetDice, cjkDice } from './textSimilarity';

describe('cjkTokenize', () => {
  it('中文按单字切分', () => {
    expect(cjkTokenize('使用缓存')).toEqual(['使', '用', '缓', '存']);
  });

  it('拉丁/数字按连续词切分，kebab-case 拆词', () => {
    expect(cjkTokenize('multi-agent KV Cache 123')).toEqual(['multi', 'agent', 'kv', 'cache', '123']);
  });

  it('小写化、忽略标点空白', () => {
    expect(cjkTokenize('KV-Cache，与 Prefill。')).toEqual(['kv', 'cache', '与', 'prefill']);
  });
});

describe('tokenMultisetDice', () => {
  it('空对空 = 100，空对非空 = 0', () => {
    expect(tokenMultisetDice([], [])).toBe(100);
    expect(tokenMultisetDice([], ['a'])).toBe(0);
    expect(tokenMultisetDice(['a'], [])).toBe(0);
  });

  it('完全相同 = 100，完全无交 = 0', () => {
    expect(tokenMultisetDice(['使', '用'], ['使', '用'])).toBe(100);
    expect(tokenMultisetDice(['使', '用'], ['不', '同'])).toBe(0);
  });

  it('多重集：重复 token 只计交集次数', () => {
    // a=[1,1,2], b=[1,2,2]：交集 1(1次)+2(1次)=2；|a|+|b|=6 → 200*2/6≈66.67
    expect(tokenMultisetDice(['1', '1', '2'], ['1', '2', '2'])).toBeCloseTo(66.67, 1);
  });
});

describe('cjkDice（选项相似度的度量面）', () => {
  it('合法同义改写 → 较高（≥44），偷换结论/真假属性 → 很低（<35）', () => {
    const paraphrase = cjkDice('使用 KV Cache 降低 prefill 重复计算', '采用 KV 缓存减少 prefill 重复计算');
    const swap = cjkDice('使用 KV Cache 降低 prefill 重复计算', '增大 batch size 提升吞吐');
    expect(paraphrase).toBeGreaterThanOrEqual(44);
    expect(swap).toBeLessThan(35);
  });

  it('长选项（4 选项拼接，即门禁实际比对面）：逐字相同=100，轻改≈91，重述≈54', () => {
    const join = (xs: string[]) => xs.join(' | ');
    const orig = [
      '聚焦最终回答的语言流畅度与格式规范度做评估，中间轨迹与工具调用过程不必纳入考察，因为终端用户只感知最终输出',
      '先做一轮小样本人工抽测，若全部通过即可认定系统可靠，无需再建评测集做回归，偶发长尾问题可由线上监控兜底',
      '循环卡死与上下文溢出属于运维故障而非可靠性问题，不应纳入评估范围，这类故障由基础设施与超时配置负责',
      '从任务成功率、轨迹有效性与工具调用准确率等维度构建评测集做统计化评估，并针对规划偏差、工具误用等失败模式配套缓解手段',
    ];
    const light = [
      '只评估最终回答的流畅度与格式规范度，中间轨迹与工具调用过程不用纳入，终端用户只感知最终输出',
      '做一轮小样本人工抽测，全部通过就认定系统可靠，无需再建评测集回归，长尾问题交给线上监控兜底',
      '循环卡死与上下文溢出属于运维故障而非可靠性问题，不应纳入评估范围，由基础设施与超时配置负责',
      '从任务成功率、轨迹有效性与工具调用准确率等维度建评测集做统计化评估，并针对规划偏差、工具误用配套缓解手段',
    ];
    const heavy = [
      '评估只看最终输出的通顺与排版，推理链路和工具调用都不算分，用户只看到答案本身',
      '少量人工抽查全过就当系统稳了，不必做回归评测集，零星长尾靠线上监控接住',
      '死循环和爆上下文是运维层面的事故，不算可靠性范畴，交给基建和超时配置去管',
      '用任务成功率、链路有效性、工具准确率搭评测集做统计，并为规划偏差和工具误用准备兜底',
    ];
    expect(cjkDice(join(orig), join(orig))).toBe(100);
    expect(cjkDice(join(orig), join(light))).toBeGreaterThanOrEqual(88); // 轻改不足，仍判近重
    expect(cjkDice(join(orig), join(heavy))).toBeLessThan(88); // 重述改写，放行
  });
});
