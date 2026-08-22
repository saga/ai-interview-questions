// Interview Agent 层：用 @earendil-works/pi-agent-core 的 Agent 封装开放/编程题评分。
// 关键点（见 ADR-012）：
// - 这是唯一直接依赖 pi-agent-core 的地方；Quiz Domain 不依赖它。
// - 浏览器 local-first：用 pi-ai 的 streamSimple 作为 Agent 的 streamFn（不依赖后端代理）。
// - Agent 状态化、带事件流，未来可自然扩展成"追问型面试 loop"，此处先用其一次性评分。
// - 纯逻辑（buildEvalUser / parseEvaluation）与 Agent 解耦，便于单元测试（mock streamFn）。

import { Agent } from '@earendil-works/pi-agent-core';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import type { Model } from '@earendil-works/pi-ai';
import { buildModels, extractJSON, getModel } from './models';
import { aggregateOverall } from '../domain/evaluation';
import type { EvaluationResult, OpenQuestion, PiConfig, ScoringRubric } from '../types';
import { EVAL_DIMENSIONS } from '../types';

const EVAL_SYSTEM = `你是一位严格的 AI 技术面试官，负责评估候选人的开放题/编程题回答。基于参考答案与评分量表给出多维评分与详细反馈。只输出 JSON，不要任何额外文字或 Markdown 代码块。`;

export interface EvalOptions {
  /** 四维权重（已与全局 rubric 合并）。 */
  rubric?: ScoringRubric;
  /** 必须覆盖的要点（命中情况计入 completeness）。 */
  requiredPoints?: string[];
  /** 额外评估要求（来自 InterviewDefinition.evaluationCriteria）。 */
  extraCriteria?: string;
  /** 流式文本回调（供 UI 实时展示模型输出）。 */
  onDelta?: (text: string) => void;
}

const DEFAULT_RUBRIC: ScoringRubric = {
  correctness: 0.4,
  completeness: 0.2,
  architecture: 0.2,
  communication: 0.2,
};

/** 构建发给 Agent 的用户消息（题目 + 参考答案 + 回答 + 评分量表）。纯函数，便于测试。 */
export function buildEvalUser(q: OpenQuestion, answer: string, opts: EvalOptions = {}): string {
  const noAnswer = !answer || !answer.trim();
  return `题目（类型：${q.type}${q.language ? '，语言：' + q.language : ''}）：
${q.question}
${q.reference?.concept ? '\n概念提示：\n' + q.reference.concept + '\n' : ''}
参考答案：
${q.referenceAnswer}

候选人回答：
${noAnswer ? '（未作答）' : answer}

请按以下四个维度各给 0-100 整数分：
- correctness：答案是否正确、是否命中核心要点
- completeness：是否覆盖应有要点、有无明显遗漏
- architecture：方案/代码结构是否合理、设计是否清晰（编程题看实现质量）
- communication：表达清晰度、条理与专业性

${opts.requiredPoints && opts.requiredPoints.length ? '必须覆盖的要点（命中情况计入 completeness）：\n' + opts.requiredPoints.map((p) => '- ' + p).join('\n') + '\n' : ''}
评分权重（仅供参考，综合分时按权重聚合四维）：
${JSON.stringify(opts.rubric ?? DEFAULT_RUBRIC)}

${opts.extraCriteria ? '额外评估要求：' + opts.extraCriteria : ''}

请输出 JSON，字段：
- correctness / completeness / architecture / communication：0-100 整数
- overall：0-100 整数（按上述权重综合四维；若未作答则整体为 0）
- feedback：总体反馈文字
- strengths：回答亮点（字符串数组）
- gaps：遗漏或错误的要点（字符串数组）`;
}

/** 从 Agent 文本输出解析出结构化评估结果。纯函数，便于测试。 */
export function parseEvaluation(raw: string, q: OpenQuestion, rubric: ScoringRubric): EvaluationResult {
  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
  const zero = EVAL_DIMENSIONS.reduce(
    (acc, d) => ({ ...acc, [d]: 0 }),
    {} as Record<(typeof EVAL_DIMENSIONS)[number], number>,
  );
  if (!raw || !raw.trim()) {
    return {
      overall: 0,
      dimensions: zero,
      strengths: [],
      gaps: [],
      feedback: '未作答。',
      referenceAnswer: q.referenceAnswer,
    };
  }
  const out = extractJSON<{
    correctness?: number;
    completeness?: number;
    architecture?: number;
    communication?: number;
    overall?: number;
    feedback?: string;
    strengths?: string[];
    gaps?: string[];
  }>(raw);

  const dimensions = {
    correctness: clamp(out.correctness ?? 0),
    completeness: clamp(out.completeness ?? 0),
    architecture: clamp(out.architecture ?? 0),
    communication: clamp(out.communication ?? 0),
  };
  const overall =
    typeof out.overall === 'number' && !Number.isNaN(out.overall)
      ? clamp(out.overall)
      : aggregateOverall(dimensions, rubric);

  return {
    overall,
    dimensions,
    strengths: Array.isArray(out.strengths) ? out.strengths : [],
    gaps: Array.isArray(out.gaps) ? out.gaps : [],
    feedback: out.feedback ?? '',
    referenceAnswer: q.referenceAnswer,
  };
}

/**
 * 面试评价 Agent。构造时注入 model 与 streamFn（依赖注入，便于测试 mock）。
 * 用法：await new InterviewAgent(model, streamFn).evaluate(question, answer)。
 */
export class InterviewAgent {
  constructor(
    private readonly model: Model<any>,
    private readonly streamFn: StreamFn,
  ) {}

  async evaluate(q: OpenQuestion, answer: string, opts: EvalOptions = {}): Promise<EvaluationResult> {
    if (!answer || !answer.trim()) {
      return parseEvaluation('', q, opts.rubric ?? DEFAULT_RUBRIC);
    }

    const agent = new Agent({
      initialState: { systemPrompt: EVAL_SYSTEM, model: this.model },
      streamFn: this.streamFn,
    });

    let buf = '';
    const unsubscribe = agent.subscribe((event) => {
      if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
        const delta = event.assistantMessageEvent.delta;
        buf += delta;
        opts.onDelta?.(delta);
      }
    });

    try {
      await agent.prompt(buildEvalUser(q, answer, opts));
      await agent.waitForIdle();
    } finally {
      unsubscribe();
    }

    return parseEvaluation(buf, q, opts.rubric ?? DEFAULT_RUBRIC);
  }
}

/** 由浏览器配置构造一个 InterviewAgent（pi-ai 提供 streamFn）。 */
export function createInterviewAgent(config: PiConfig): InterviewAgent {
  const models = buildModels(config);
  const model = getModel(models, config.provider, config.model);
  if (!model) {
    throw new Error(`在 provider "${config.provider}" 中未找到模型 "${config.model}"`);
  }
  return new InterviewAgent(model, models.streamSimple.bind(models) as unknown as StreamFn);
}
