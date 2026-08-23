// AI 适配层：应用只依赖 LLMProvider 接口（见 types.ts）。这里是工厂、配置校验与具体实现。
// 分层（ADR-019）：Quiz 域的 LLM 能力全部走 pi-ai one-shot（variant / evaluate）；
// pi-agent-core 仅在未来"对话式模拟面试"回归时引入（当前已移除）。

import type {
  EvaluationResult,
  GeneratedVariant,
  LLMProvider,
  OpenQuestion,
  PiConfig,
  Question,
  ScoringRubric,
} from '../types';
import { generateVariant } from './variant';
import { evaluateOpenAnswer as evalOpen } from './evaluate';

export function isConfigValid(c: PiConfig): boolean {
  return Boolean(c && c.apiKey && c.apiKey.trim().length > 0 && c.model && c.provider);
}

/**
 * pi-ai 的具体实现。
 * - 变体：one-shot 重写题干（options/answer 不归 LLM 管，见 domain/variant.ts）。
 * - 开放/编程题评分：one-shot 四维评分，综合分由 domain 聚合（LLM 不拥有分数）。
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
    return evalOpen(q, userAnswer, config, effectiveRubric, extraCriteria);
  }
}

/** 由配置构造一个 LLMProvider；无有效密钥时返回 null（上层据此退化为原题/不评分）。 */
export function createLLMProvider(config?: PiConfig): LLMProvider | null {
  if (!config || !isConfigValid(config)) return null;
  return new PiAIProvider();
}
