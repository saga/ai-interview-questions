// 纯逻辑：选择题选项「长度泄题」启发式检测（traditional algorithm，无 LLM）。
// 不阻断流程，仅返回信号，供变体生成自检与题库 lint 使用。
//
// 设计取舍：长度均衡是抗暗示（anti-cueing）的最低成本信号，但「正确项天然更长」
// 在真实题库里很普遍，单看「最长项=正确项」会把约半数合法题误报。因此本检测
// 只在高置信度的【组合泄题】形态下报警：
//   - strong：正确项是全局最长，且同时存在明显偏短的干扰项（最短项=干扰项，且 maxCorrect/minDistractor ≥ 1.8）
//   - soft：平均正确项长度显著高于平均干扰项（≥ 1.8×），作为较弱信号
// 阈值偏保守，避免误伤合法变体（遵循 ADR-036「无兜底」下的软信号定位）。

export interface OptionBiasReport {
  biased: boolean;
  /** 'strong' = 最长正确 + 最短干扰的高置信组合；'soft' = 均值失衡 */
  severity: 'none' | 'soft' | 'strong';
  detail: string;
  lengths: number[];
  maxCorrect: number;
  maxDistractor: number;
  meanCorrect: number;
  meanDistractor: number;
}

export function detectOptionLengthBias(options: string[], answer: number[]): OptionBiasReport {
  const lengths = options.map((o) => o.trim().length);
  const ans = new Set(answer);
  const correctLens = lengths.filter((_, i) => ans.has(i));
  const distractorLens = lengths.filter((_, i) => !ans.has(i));

  const base: Omit<OptionBiasReport, 'biased' | 'severity' | 'detail'> = {
    lengths,
    maxCorrect: correctLens.length ? Math.max(...correctLens) : 0,
    maxDistractor: distractorLens.length ? Math.max(...distractorLens) : 0,
    meanCorrect: correctLens.length ? correctLens.reduce((a, b) => a + b, 0) / correctLens.length : 0,
    meanDistractor: distractorLens.length ? distractorLens.reduce((a, b) => a + b, 0) / distractorLens.length : 0,
  };

  if (distractorLens.length === 0) {
    return { ...base, biased: false, severity: 'none', detail: '无干扰项，跳过长度检测' };
  }

  const longestIdx = lengths.indexOf(Math.max(...lengths));
  const shortestIdx = lengths.indexOf(Math.min(...lengths));
  const longestIsCorrect = ans.has(longestIdx);
  const shortestIsDistractor = !ans.has(shortestIdx);
  const minDistractor = Math.min(...distractorLens);
  const gapRatio = minDistractor > 0 ? base.maxCorrect / minDistractor : Infinity;
  const meanRatio = base.meanDistractor > 0 ? base.meanCorrect / base.meanDistractor : Infinity;

  // 高置信：正确项既是最长，又存在明显过短的干扰项（最短=干扰项，且差距 ≥1.8×）
  if (longestIsCorrect && shortestIsDistractor && gapRatio >= 1.8) {
    return {
      ...base,
      biased: true,
      severity: 'strong',
      detail: `正确项为全局最长（${base.maxCorrect} 字符）且存在明显过短干扰项（最短 ${minDistractor} 字符，差距 ${gapRatio.toFixed(1)}×），存在长度泄题`,
    };
  }
  if (meanRatio >= 1.8) {
    return {
      ...base,
      biased: true,
      severity: 'soft',
      detail: `平均正确项长度（${base.meanCorrect.toFixed(0)}）≥1.8× 平均干扰项（${base.meanDistractor.toFixed(0)}），选项长度失衡`,
    };
  }
  return { ...base, biased: false, severity: 'none', detail: '选项长度均衡' };
}

export interface OptionLengthRatioReport {
  /** 最长选项长度 / 最短选项长度 */
  ratio: number;
  /** ratio > threshold（默认 1.8）即视为存在长度泄题 */
  biased: boolean;
  maxLen: number;
  minLen: number;
  maxIdx: number;
  minIdx: number;
}

/**
 * 纯长度比检测：最长选项 / 最短选项 > threshold（默认 1.8）即告警。
 * 与 detectOptionLengthBias 的区别：它只看「组合泄题」（最长项是否 = 正确项且最短=干扰项），
 * 本函数只看长度比本身，是最直接的抗暗示（anti-cueing）信号，用于 CI 门禁（AGENTS.md §4.2）。
 */
export function detectOptionLengthRatio(options: string[], threshold = 1.8): OptionLengthRatioReport {
  const lengths = options.map((o) => String(o).trim().length);
  if (lengths.length < 2) {
    return { ratio: 1, biased: false, maxLen: lengths[0] ?? 0, minLen: lengths[0] ?? 0, maxIdx: 0, minIdx: 0 };
  }
  const maxLen = Math.max(...lengths);
  const minLen = Math.min(...lengths);
  const maxIdx = lengths.indexOf(maxLen);
  const minIdx = lengths.indexOf(minLen);
  const ratio = minLen > 0 ? maxLen / minLen : Infinity;
  return { ratio, biased: ratio > threshold, maxLen, minLen, maxIdx, minIdx };
}
