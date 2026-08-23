// 题目变体生成（one-shot 结构化生成，不需要 Agent）。保持知识点与正确答案不变，
// 仅重措辞、打乱选项、重算答案索引；校验与落地在 domain/variant.ts 完成。
// 若将来替换底层库，只需改这里的 callLLM 调用，上层（engine）无需变动。

import type { GeneratedVariant, OpenQuestion, PiConfig, Question } from '../types';
import { callLLM, extractJSON } from './models';

const VARIANT_SYSTEM =
  '你是一位资深的 AI 技术面试官。请基于给定的原始面试题生成一道"变体题"：在保持考察知识点和正确答案完全一致的前提下，重新组织题干措辞、调整选项顺序（如有）、并给出新讲解，难度与原题一致。只输出 JSON，不要任何额外文字。';

interface RawVariant {
  question?: string;
  options?: string[];
  answer?: number[];
  explanation?: string;
}

/** 生成变体；返回结构含 sourceQuestionId / generatedBy 便于调试与审计。 */
export async function generateVariant(q: Question, config: PiConfig): Promise<GeneratedVariant> {
  const raw = await generateRaw(q, config);
  return {
    question: raw.question ?? q.question,
    options: raw.options,
    answer: Array.isArray(raw.answer) ? raw.answer : [],
    explanation: raw.explanation,
    sourceQuestionId: q.id,
    generatedBy: { provider: config.provider, model: config.model },
  };
}

async function generateRaw(q: Question, config: PiConfig): Promise<RawVariant> {
  const isOpen = q.type === 'essay' || q.type === 'coding';
  const kind = q.type === 'coding' ? '编程题' : q.type === 'essay' ? '问答题' : '选择题';

  let user: string;
  if (isOpen) {
    const oq = q as OpenQuestion;
    user = `原始${kind}：
${JSON.stringify({ question: oq.question, explanation: oq.explanation }, null, 2)}

请输出 JSON，字段：
- question: 重新措辞后的题干（保持考察点不变）
- explanation: 解析
注意：仅改题干与解析的措辞，不要改变参考答案所指的知识点。示例：{"question":"...","explanation":"..."}`;
  } else {
    const cq = q as { question: string; options: string[]; answer: number[]; explanation: string };
    user = `原始选择题：
${JSON.stringify(
  { question: cq.question, options: cq.options, answer: cq.answer, explanation: cq.explanation },
  null,
  2,
)}

请输出 JSON，字段：
- question: 重新措辞后的题干
- options: 字符串数组（重新组织选项措辞并打乱顺序，长度须与原题一致）
- answer: 正确选项索引数组（必须对应"新的 options"顺序，且与原 answer 指向同一知识点）
- explanation: 解析
注意：answer 必须基于打乱后的新 options 重新计算索引。示例：{"question":"...","options":["..."],"answer":[1],"explanation":"..."}`;
  }

  const out = extractJSON<RawVariant>(await callLLM(config, VARIANT_SYSTEM, user));
  if (isOpen) {
    // 开放题无答案 key，answer 留空；referenceAnswer 永远来自原题（applyVariant 保证）。
    return { question: out.question, explanation: out.explanation, answer: [] };
  }
  return out;
}
