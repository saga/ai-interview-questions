import { z } from 'zod';
import { aiConfigSchema } from './ai-config';
import { evaluationResultSchema } from './evaluation';

/**
 * Zod → JSON Schema（draft-7）派生，复用同一份契约：
 * - Monaco JSON 编辑器的自动补全 / 校验 / hover
 * - 未来 LLM structured output 的 response_format
 * 不维护第二套手写 JSON Schema。
 */

export function getAIConfigJsonSchema() {
  return z.toJSONSchema(aiConfigSchema, { target: 'draft-7' });
}

export function getEvaluationResultJsonSchema() {
  return z.toJSONSchema(evaluationResultSchema, { target: 'draft-7' });
}
