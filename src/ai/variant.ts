// 题目变体生成（one-shot 结构化生成，不需要 Agent）。
// 轻量变体边界（ADR-036）：LLM 只改写题干与选项表达（presentation），
// 不得重新决定 answer / explanation / 选项数量 / 选项顺序 / 选项真假属性。
//
// 职责边界（2026-09-02 第五轮）：本模块**只做 LLM 适配 + 解析**，不做任何校验。
// 唯一的校验入口是 `application/sessionEvaluator.finalizeQuestion` 里的 `validateVariant`
// （validate + apply + fallback 三件事集中在一处），避免同一候选被校验两次。

import type { CompleteFn, GeneratedVariant } from '../types';
import type { FormatId } from '../schemas/common';
import type { Question } from '../schemas/question';
import { requiredPointsFor } from '../domain/knowledge/nodes';
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

/**
 * 生成轻量变体候选：**一次 LLM 调用 + 解析**，不做校验。
 * 返回未经验证的 `GeneratedVariant`——结构/语义校验由调用方（finalizeQuestion）统一执行，
 * 校验失败时回退原题。本函数只在 LLM 调用本身抛错时才抛出（网络/鉴权/解析失败等）。
 */
export async function generateVariant(
  q: Question,
  complete: CompleteFn,
  format?: FormatId,
  systemPrompt = VARIANT_SYSTEM,
): Promise<GeneratedVariant> {
  const user = buildUser(q, format);
  const out = extractJSON<RawVariant>(await complete(systemPrompt, user));
  return toGeneratedVariant(q, out);
}
