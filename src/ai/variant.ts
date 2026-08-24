// 题目变体生成（one-shot 结构化生成，不需要 Agent）。
// 安全模型（ADR-036）：LLM 可重构所有 Presentation（题干/场景/选项/解析），但必须保持 Knowledge Contract 不变量，输出为 VariantCandidate，需经 domain 校验。

import type { CompleteFn, GeneratedVariant, Question } from '../types';
import { requiredPointsFor } from '../domain/knowledge';
import { extractJSON } from './pi';

const VARIANT_SYSTEM = `你是一位资深 AI 技术面试官。

你的任务不是简单改写原题，而是基于同一个知识考察契约，生成一道真正不同的面试题变体。

【必须保持不变】
- 核心知识点（topic/tags 所锚定的知识）
- 必考知识概念（requiredConcepts）
- 正确答案所表达的语义
- 题目的核心考察意图
- 难度等级
- 题型（单选 / 多选 / 开放）
- 不得引入原题没有依据的技术结论

【允许变化】
- 题干措辞与问题组织方式
- 场景和应用背景与技术上下文
- 示例、名称与非关键数值
- 选项的表达与错误选项（distractors）
- 解析的表达方式与切入角度

你应该尽量生成与原题在表达和场景上明显不同的题目，而不是只替换几个词。
如果原题是选择题，可以重新设计所有选项，包括错误选项，但正确选项必须与知识契约中的正确结论保持语义一致。

题目必须 self-contained：考生不阅读原文章或原题，也能够仅凭变体题干和选项理解问题并作答。
不要使用“上述方法”“原题中”“本文提到”“该方案”等依赖原始题目的指代。

只输出 JSON，不要任何额外文字。`;

interface RawVariant {
  question?: string;
  options?: string[];
  answer?: number[];
  explanation?: string;
}

/** 生成变体候选；输出包含题干/选项/答案/解析（后三者仅选择题需要）。 */
export async function generateVariant(q: Question, complete: CompleteFn): Promise<GeneratedVariant> {
  const contract = {
    topic: q.topic,
    tags: q.tags,
    requiredConcepts: requiredPointsFor(q) ?? [],
    difficulty: q.difficulty,
    format: q.formats.choice ? (q.formats.choice.type === 'single' ? 'single' : 'multiple') : 'open',
  };

  const original = {
    question: q.question,
    options: q.formats.choice?.options,
    answer: q.formats.choice?.answer,
    explanation: q.explanation,
    referenceAnswer: q.formats.open?.referenceAnswer,
  };

  const user = `【知识契约】
${JSON.stringify(contract, null, 2)}

【原题】
${JSON.stringify(original, null, 2)}

请生成一道真正不同的变体题。

要求：
1. 保持知识契约不变
2. 不要只是改写题干，可重构场景/选项/解析
3. 选项需自包含且互斥，distractors 需合理但错误
4. 正确答案必须与知识契约一致
5. 不要引入无依据的新知识作为正确答案
6. 难度保持在 ${q.difficulty} 档位

输出 JSON 字段：
- question: 新题干（必选）
- options: 选项数组（选择题必选，开放题可省略）
- answer: 正确选项索引数组（选择题必选）
- explanation: 解析
示例：{"question":"...","options":["...","...","...","..."],"answer":[1],"explanation":"..."}`;

  const out = extractJSON<RawVariant>(await complete(VARIANT_SYSTEM, user));
  return {
    question: out.question ?? q.question,
    options: out.options,
    answer: out.answer,
    explanation: out.explanation,
  };
}
