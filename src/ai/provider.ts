// AI 适配层：应用只依赖 LLMProvider 接口（见 types.ts）。这里是工厂、配置校验与具体实现。
// 未来要换掉 pi-ai / pi-agent-core，只需新增一个实现 LLMProvider 的类，上层（engine / UI）无需改动。

import type {
  EvaluationResult,
  GeneratedVariant,
  LLMProvider,
  OpenQuestion,
  PiConfig,
  Question,
  ScoringRubric,
} from '../types';
import { generateVariant } from './variantGenerator';
import { createInterviewAgent } from './interviewAgent';

export function isConfigValid(c: PiConfig): boolean {
  return Boolean(c && c.apiKey && c.apiKey.trim().length > 0 && c.model && c.provider);
}

/**
 * pi-ai 的具体实现。
 * - 变体：走 pi-ai one-shot（variantGenerator）。
 * - 开放/编程题评分：走 pi-agent-core 的 InterviewAgent（stateful / 可扩展追问）。
 * 两者边界清晰：Quiz Domain 与 Agent Runtime 解耦。
 */
export class PiAIProvider implements LLMProvider {
  readonly name = 'pi-ai';

  async generateVariant(q: Question, config: PiConfig): Promise<GeneratedVariant> {
    return generateVariant(q, config);
  }

  async evaluateOpenAnswer(
    q: OpenQuestion,
    userAnswer: string,
    config: PiConfig,
    rubric: ScoringRubric,
    extraCriteria?: string,
  ): Promise<EvaluationResult> {
    // 该题专属 rubric.dimensions 覆盖全局权重；required 要点作为 completeness 提示。
    const effectiveRubric: ScoringRubric = { ...rubric, ...(q.rubric?.dimensions ?? {}) };
    const agent = createInterviewAgent(config);
    return agent.evaluate(q, userAnswer, {
      rubric: effectiveRubric,
      requiredPoints: q.rubric?.required,
      extraCriteria,
    });
  }
}

/** 由配置构造一个 LLMProvider；无有效密钥时返回 null（上层据此退化为原题/不评分）。 */
export function createLLMProvider(config?: PiConfig): LLMProvider | null {
  if (!config || !isConfigValid(config)) return null;
  return new PiAIProvider();
}
