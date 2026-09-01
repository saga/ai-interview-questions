// 题目变体生成（one-shot 结构化生成，不需要 Agent）。
// 轻量变体边界（ADR-036）：LLM 只改写题干与选项表达（presentation），
// 不得重新决定 answer / explanation / 选项数量 / 选项顺序 / 选项真假属性。
// 一次 LLM 调用；校验失败或长度泄题直接抛错，由 finalizeQuestion 回退原题。

import type { CompleteFn, GeneratedVariant } from '../types';
import type { FormatId } from '../schemas/common';
import type { Question } from '../schemas/question';
import { requiredPointsFor } from '../domain/knowledge/nodes';
import { detectOptionLengthBias } from '../domain/bias';
import { validateVariant } from '../domain/variant';
import { extractJSON } from './pi';

// 稳定前缀（KV-Cache 友好）：轻量变体改写约束。同一场面试为不同题生成变体时可复用同一前缀。
// 边界（ADR-036 轻量变体收缩）：LLM 只做「语义变换」（题干 + 选项文本逐项改写），
// 选项顺序与答案由程序在 applyVariant 中重排与重映射，本 prompt 不要求也不允许模型决定顺序 / 答案。
export const VARIANT_SYSTEM = `[PROMPT-VERSION v3]

对已有面试题做轻量语义变换。

任务：
1. 改写题干，使其表达方式与原题不同。
2. 对每个选项做自然的措辞改写（逐项改写现有文本，不要重新设计选项）。
3. 保持每个选项原本表达的技术含义不变。
4. 不新增信息，不删除关键条件。
5. 不改变任何选项的正确 / 错误属性。
6. 不改变选项数量。
7. 不创造新的 distractor。
8. 不交换选项顺序（顺序由程序在后续步骤统一处理）。
9. 不生成答案。
10. 不生成解析。

题干可以：
- 改变措辞和句式
- 改变提问方式
- 加入简短工程背景
- 调整表达视角

选项只能做：
- 同义改写
- 句式调整
- 表达简化或自然化
- 保持原有技术结论不变

选项一一对应（重要）：
- 输出的第 N 个选项必须是输入第 N 个选项的改写
- 只允许改变表达，不允许改变因果关系、适用条件、范围、数量或真假属性
- 不要给某个选项补充解释、理由或额外结论（例如把「增大 batch size」写成
  「增大 batch size 可以显著减少单请求的 prefill 计算」——这已经改变了原选项的语义）

不要进行深度重新设计。不要改变知识点或难度。

只输出 JSON：

选择题：
{
  "question": "改写后的题干",
  "options": ["改写后的选项1", "改写后的选项2", "改写后的选项3", "改写后的选项4"]
}

开放题：
{
  "question": "改写后的题干"
}`;

// 轻量变体契约：模型只允许产出 question / options。
// answer / explanation 不在此类型中——即便模型回吐这两个字段，解析后也无法进入产物。
interface RawVariant {
  question?: string;
  options?: string[];
}

function buildUser(q: Question, format?: FormatId): string {
  // 轻量变体：只向模型暴露「主题 + 必考概念 + 原题题干 + 原题选项」，
  // 不暴露 answer / explanation / referenceAnswer / angle / difficulty，
  // 从源头切断「LLM 重新决定答案」的路径。
  const isChoice = format === 'choice';
  const payload = {
    topic: q.topic,
    requiredConcepts: requiredPointsFor(q) ?? [],
    question: q.question,
    ...(isChoice ? { options: q.formats.choice?.options } : {}),
  };
  return JSON.stringify(payload);
}

function toGeneratedVariant(_q: Question, out: RawVariant): GeneratedVariant {
  // 只接受题干与选项；即使模型输出 answer / explanation 也直接丢弃。
  // 安全边界：LLM 可以改 presentation，但不能重新决定答案。
  return {
    question: out.question ?? '',
    options: out.options,
  };
}

/** 变体被拒的机器可读原因码（供 variant 遥测统计 fallback 率）。 */
export const VARIANT_REJECT_REASON = {
  /** 变体选项存在明显长度泄题（正确项过长）。 */
  OPTION_LENGTH_BIAS: 'option-length-bias',
} as const;

/** 构造带机器可读原因码的拒绝错误（Error 本身仍保留人话 message 供日志使用）。 */
function rejectVariant(reason: string, message: string): Error {
  const err = new Error(message) as Error & { reason?: string };
  err.reason = reason;
  return err;
}

/** 生成轻量变体候选：一次 LLM 调用，校验失败或长度泄题直接抛错（由 finalizeQuestion 回退原题）。 */
export async function generateVariant(
  q: Question,
  complete: CompleteFn,
  format?: FormatId,
  systemPrompt = VARIANT_SYSTEM,
): Promise<GeneratedVariant> {
  const user = buildUser(q, format);
  const out = extractJSON<RawVariant>(await complete(systemPrompt, user));
  const candidate = toGeneratedVariant(q, out);
  const check = validateVariant(q, candidate, format);
  if (!check.ok) {
    throw new Error(check.reason ?? '变体校验未通过');
  }
  // 抗暗示：长度泄题为硬失败，不再重新请求 LLM。
  // 只对选择题执行——open 形态没有选项，语义上不适用（validateVariant 已保证 choice 时 options 必存在）。
  const isChoice = format ? format === 'choice' : !!q.formats.choice;
  if (isChoice) {
    const bias = detectOptionLengthBias(candidate.options!, q.formats.choice!.answer);
    if (bias.biased) {
      console.warn(`variant option bias: ${bias.detail}`);
      throw rejectVariant(VARIANT_REJECT_REASON.OPTION_LENGTH_BIAS, '变体选项存在明显长度泄题');
    }
  }
  return candidate;
}
