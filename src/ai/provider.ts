// AI 适配层：应用只依赖 LLMProvider 接口（见 types.ts）。这里是工厂、配置校验、
// 多引擎降级链编排与具体实现。
// 只有两种底层实现：ChromeAIProvider（浏览器内置，ADR-021）与 PiAIProvider（pi-ai one-shot，
// 覆盖云端与本地 OpenAI 兼容服务，后者由 buildModels 路由到自定义 provider，ADR-022）。
// 多引擎同时启用时按配置顺序组成降级链：前一个失败自动尝试下一个（ADR-023）。

import type { GeneratedVariant, LLMProvider } from '../types';
import type { AIConfig, ProviderEntry } from '../schemas/ai-config';
import type { EvaluationResult } from '../schemas/evaluation';
import type { OpenFormat, Question } from '../schemas/question';
import type { ScoringRubric } from '../schemas/interview';
import { generateVariant } from './variant';
import { evaluateOpenAnswer as evalOpen } from './evaluate';
import { callLLM } from './pi';
import { chromeComplete } from './chrome';
import { requiredPointsFor } from '../domain/knowledge';
import { challengeQuestion, type QuestionChallenge } from './questionChallenger';

/** 单个引擎通道的校验按 id 区分：
 *  - chrome：浏览器内置模型，无需 apiKey/model；
 *  - local：OpenAI 兼容本地服务，需要 model id，apiKey 可选（baseUrl 空则用默认地址）；
 *  - cloudflare-workers-ai：API Token + Account ID + model 三者必填；
 *  - 其余云端（deepseek/openrouter/google）：必须有 apiKey 与 model。 */
export function isEntryValid(e: ProviderEntry): boolean {
  if (!e || !e.id) return false;
  if (e.id === 'chrome') return true;
  if (e.id === 'local') return Boolean(e.model && e.model.trim().length > 0);
  if (e.id === 'cloudflare-workers-ai') {
    return Boolean(
      e.apiKey && e.apiKey.trim().length > 0 && e.model && e.accountId && e.accountId.trim().length > 0,
    );
  }
  return Boolean(e.apiKey && e.apiKey.trim().length > 0 && e.model);
}

/** 配置有效 = 至少存在一个启用且字段合法的引擎。 */
export function isConfigValid(c?: AIConfig): boolean {
  return Boolean(c?.providers?.some((p) => p.enabled && isEntryValid(p)));
}

/**
 * 装配评分参数（纯函数，便于测试）：
 * - `rubric`：四维权重，**统一使用全局 `InterviewDefinition.scoringRubric`**。
 *   原先支持题目级 `rubric.dimensions` 覆盖，但该字段已随 ADR-044 删除——
 *   权重定制只覆盖 29.6% 的题、共 21 种组合，维护成本高于收益。
 * - `requiredPoints`：必须覆盖的要点，来自知识点节点的 `required`（ADR-029，单一来源）。
 *   题目级的评分依据由 `Question.explanation` 直接注入评分提示提供。
 */
export function mergeQuestionRubric(
  q: Question,
  globalRubric: ScoringRubric,
): { rubric: ScoringRubric; requiredPoints?: string[] } {
  return {
    rubric: { ...globalRubric },
    requiredPoints: requiredPointsFor(q),
  };
}

/**
 * pi-ai（云端 / 本地 OpenAI 兼容）的具体实现，构造时绑定一个引擎通道。
 * - 变体：one-shot 重写题干（options/answer 不归 LLM 管，见 domain/variant.ts）。
 * - 开放/编程题评分：one-shot 四维评分，综合分由 domain 聚合（LLM 不拥有分数）。
 */
export class PiAIProvider implements LLMProvider {
  readonly name: string;

  constructor(private readonly entry: ProviderEntry, private readonly prompts?: AIConfig['prompts']) {
    this.name = `pi-ai(${entry.id})`;
  }

  async generateVariant(q: Question): Promise<GeneratedVariant> {
    return generateVariant(q, (system, user) => callLLM(this.entry, system, user), this.prompts?.variantSystem?.trim() || undefined);
  }

  async evaluateOpenAnswer(
    q: Question,
    open: OpenFormat,
    userAnswer: string,
    rubric: ScoringRubric,
    extraCriteria?: string,
  ): Promise<EvaluationResult> {
    const { rubric: effectiveRubric, requiredPoints } = mergeQuestionRubric(q, rubric);
    return evalOpen(q, open, userAnswer, (system, user) => callLLM(this.entry, system, user), effectiveRubric, extraCriteria, requiredPoints, this.prompts?.evaluationSystem?.trim() || undefined);
  }

  async challengeQuestion(q: Question): Promise<QuestionChallenge> {
    return challengeQuestion(q, (system, user) => callLLM(this.entry, system, user));
  }
}

/** Chrome Built-in AI（本地 Prompt API）实现：同一套 prompt/解析逻辑，仅底层不同。 */
export class ChromeAIProvider implements LLMProvider {
  readonly name = 'chrome';

  constructor(private readonly prompts?: AIConfig['prompts']) {}

  async generateVariant(q: Question): Promise<GeneratedVariant> {
    return generateVariant(q, chromeComplete, this.prompts?.variantSystem?.trim() || undefined);
  }

  async evaluateOpenAnswer(
    q: Question,
    open: OpenFormat,
    userAnswer: string,
    rubric: ScoringRubric,
    extraCriteria?: string,
  ): Promise<EvaluationResult> {
    const { rubric: effectiveRubric, requiredPoints } = mergeQuestionRubric(q, rubric);
    return evalOpen(q, open, userAnswer, chromeComplete, effectiveRubric, extraCriteria, requiredPoints, this.prompts?.evaluationSystem?.trim() || undefined);
  }

  async challengeQuestion(q: Question): Promise<QuestionChallenge> {
    return challengeQuestion(q, chromeComplete);
  }
}

/** 单个引擎不可用/调用失败时自动切换到链中下一个引擎；全部失败才向外抛错。 */
export class FallbackProvider implements LLMProvider {
  readonly name: string;

  constructor(private readonly chain: LLMProvider[]) {
    this.name = chain.map((p) => p.name).join(' → ');
  }

  private async run<T>(op: (p: LLMProvider) => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (const p of this.chain) {
      try {
        return await op(p);
      } catch (err) {
        console.warn(`[${p.name}] 调用失败，降级到下一引擎：`, err);
        lastErr = err;
      }
    }
    throw lastErr ?? new Error('所有已启用的 AI 引擎均不可用');
  }

  generateVariant(q: Question): Promise<GeneratedVariant> {
    return this.run((p) => p.generateVariant(q));
  }

  evaluateOpenAnswer(
    q: Question,
    open: OpenFormat,
    userAnswer: string,
    rubric: ScoringRubric,
    extraCriteria?: string,
  ): Promise<EvaluationResult> {
    return this.run((p) => p.evaluateOpenAnswer(q, open, userAnswer, rubric, extraCriteria));
  }

  challengeQuestion(q: Question): Promise<QuestionChallenge> {
    return this.run((p) => p.challengeQuestion(q));
  }
}

function buildEntryProvider(entry: ProviderEntry, prompts?: AIConfig['prompts']): LLMProvider {
  return entry.id === 'chrome' ? new ChromeAIProvider(prompts) : new PiAIProvider(entry, prompts);
}

/** 由配置构造 LLMProvider：把所有启用且合法的引擎按顺序串成降级链；
 *  链为空返回 null（上层据此退化为原题/不评分），单引擎直接返回该实现。 */
export function createLLMProvider(config?: AIConfig): LLMProvider | null {
  if (!config || !isConfigValid(config)) return null;
  const chain = config.providers
    .filter((p) => p.enabled && isEntryValid(p))
    .map((entry) => buildEntryProvider(entry, config.prompts));
  if (chain.length === 0) return null;
  return chain.length === 1 ? chain[0] : new FallbackProvider(chain);
}
