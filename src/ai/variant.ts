// 题目变体生成（one-shot 结构化生成，不需要 Agent）。
// 安全模型（ADR-036）：LLM 可重构所有 Presentation（题干/场景/选项/解析），但必须保持 Knowledge Contract 不变量，输出为 VariantCandidate，需经 domain 校验。

import type { CompleteFn, GeneratedVariant } from '../types';
import type { Question } from '../schemas/question';
import { requiredPointsFor } from '../domain/knowledge';
import { detectOptionLengthBias } from '../domain/bias';
import { extractJSON } from './pi';

export const VARIANT_SYSTEM = `你是一位资深 AI 技术面试官。

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

【选项设计约束】
- 各选项在篇幅长度与工程细节丰富度上必须保持均衡：干扰项（错误选项）须具备与正确选项同等的描述细致度。
- 禁止通过“某选项明显更长 / 更详细 / 更啰嗦”来暗示或泄露正确答案；正确项不应系统性地比干扰项更长。
- 生成后请自检：最长选项是否恰好是正确项、平均正确项长度是否显著高于干扰项，若是则重排或压缩正确项的表达。

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

interface RawVariant {
  question?: string;
  options?: string[];
  answer?: number[];
  explanation?: string;
}

function buildUser(q: Question): string {
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

  return `【知识契约】
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
}

function toGeneratedVariant(q: Question, out: RawVariant): GeneratedVariant {
  return {
    question: out.question ?? q.question,
    options: out.options,
    answer: out.answer,
    explanation: out.explanation,
  };
}

/** 生成变体候选；输出包含题干/选项/答案/解析（后三者仅选择题需要）。 */
export async function generateVariant(q: Question, complete: CompleteFn, systemPrompt = VARIANT_SYSTEM): Promise<GeneratedVariant> {
  const user = buildUser(q);
  const out = extractJSON<RawVariant>(await complete(systemPrompt, user));

  // 抗暗示（anti-cueing）自愈：若 LLM 生成的选项存在长度泄题，一次性重试修正，
  // 避免把「正确项明显更长 / 干扰项过短」的偏差写进变体（traditional 启发式 + prompt 微调）。
  const biased =
    Array.isArray(out.options) &&
    Array.isArray(out.answer) &&
    detectOptionLengthBias(out.options, out.answer).biased;
  if (biased) {
    const retryUser =
      user +
      '\n\n【修正】上一版选项中存在长度泄题（正确项明显长于干扰项，或某干扰项过短），' +
      '请重新生成：确保各选项篇幅长度与工程细节丰富度均衡，不要通过长度暗示正确答案。';
    const fixed = extractJSON<RawVariant>(await complete(systemPrompt, retryUser));
    return toGeneratedVariant(q, fixed);
  }
  return toGeneratedVariant(q, out);
}
