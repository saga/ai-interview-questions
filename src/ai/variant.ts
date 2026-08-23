// 题目变体生成（one-shot 结构化生成，不需要 Agent）。
// 安全模型（ADR-019）：LLM 只重写题干与解析——options/answer/referenceAnswer
// 不进入提示词输出契约，从源头杜绝答案错位；校验与落地在 domain/variant.ts。

import type { CompleteFn, GeneratedVariant, Question } from '../types';
import { extractJSON } from './pi';

const VARIANT_SYSTEM =
  '你是一位资深的 AI 技术面试官。请基于给定的原始面试题生成一道"变体题"：在保持考察知识点完全一致的前提下，重新组织题干措辞，难度与原题一致。只输出 JSON，不要任何额外文字。';

interface RawVariant {
  question?: string;
  explanation?: string;
}

/** 生成变体；只输出重写后的题干与解析（答案数据不进入 LLM 输出契约）。
 *  complete 由 provider 注入（pi-ai / Chrome Prompt API），本文件不感知底层。 */
export async function generateVariant(q: Question, complete: CompleteFn): Promise<GeneratedVariant> {
  const kind = q.type === 'coding' ? '编程题' : q.type === 'essay' ? '问答题' : '选择题';
  const user = `原始${kind}：
${JSON.stringify({ question: q.question, explanation: q.explanation }, null, 2)}

请输出 JSON，字段：
- question: 重新措辞后的题干（保持考察点不变）
- explanation: 解析
注意：仅改题干与解析的措辞。示例：{"question":"...","explanation":"..."}`;

  const out = extractJSON<RawVariant>(await complete(VARIANT_SYSTEM, user));
  return {
    question: out.question ?? q.question,
    explanation: out.explanation,
  };
}
