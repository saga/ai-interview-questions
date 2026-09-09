// 纯逻辑：canonical 内容身份判定（P1-1；plan0903_3 / ADR-077 补入 cognitiveTask）。
//
// ⚠️ 范围澄清（v7.1）：本模块的 AssessmentContract 只用于**canonical 原地改写的突变检测**——
// 即「这道已存在的题，它的 measurement surface（topic×angle×difficulty×cognitiveTask）有没有被
// 悄悄改掉」；检测到变化意味着沿用原 ID 的隐性身份污染。
//
// 它**不回答**「外部新稿应该判 Variant 还是 fork」：
//   - pool Variant（ADR-077 Assessment Variant）= 同 Knowledge + 同 propositions + 原 options 可
//     作答的新 observation entry，**可自声明不同 angle / cognitiveTask**，仍归因同一 canonical；
//   - fork / derived canonical = 新 Knowledge / 新 Boundary / 必须替换原 options propositions，
//     即**内容身份**变了（此时才谈得上"新 canonical ID + derivedFrom"）。
// 两者是不同概念：前者不触 contract，后者是新 canonical 的起点，别混为同一条 identity rule。
//
// 背景：Learner Memory 以 `questionId` 为历史证据键。若补覆盖缺口时原地改写
// 已有题的 `angle / difficulty / 认知任务` 却沿用原 ID，旧分数在语义上立即失效，
// 而系统仍能正常运行——隐性数据污染。因此 contract 变化必须让调用方意识到：
//
//   variant            = 同一 Knowledge 的不同 reasoning path 测量（可改 angle / cognitiveTask，
//                        见 ADR-077；答案逻辑不变，仍归因同一 canonical evidence 键）
//   derived canonical  = 同一知识血缘、不同 assessment identity（必须新 ID + derivedFrom）
//
// 不依赖 React / LLM。

import type { Question } from '../schemas/question';

/**
 * assessment contract：canonical **原地改写突变检测**的最小字段集合（D2：cognitiveTask 入约）。
 * ⚠️ 只用于「检测既有 canonical 是否被偷改身份」，不是外部新稿 fork 与否的判据
 * （fork 判据是内容身份：Knowledge / Boundary / propositions 是否变化，见文件头注释）。
 */
export interface AssessmentContract {
  topic: string;
  angle: string;
  difficulty: string;
  /** 缺省（存量题无该字段）按 undefined 比较：两者皆无视为相同，有无之间视为变化。 */
  cognitiveTask?: string;
}

export function assessmentContractOf(
  q: Pick<Question, 'topic' | 'angle' | 'difficulty' | 'cognitiveTask'>,
): AssessmentContract {
  return { topic: q.topic, angle: q.angle, difficulty: q.difficulty, cognitiveTask: q.cognitiveTask };
}

/** contract 是否发生变化：任一字段不同即视为不同 assessment identity。 */
export function isAssessmentChange(a: AssessmentContract, b: AssessmentContract): boolean {
  return (
    a.topic !== b.topic ||
    a.angle !== b.angle ||
    a.difficulty !== b.difficulty ||
    a.cognitiveTask !== b.cognitiveTask
  );
}

/**
 * 由原题派生新 canonical ID：`<topic>-<angle>-<NN>`，NN 在同 topic×angle 下自增。
 * 调用方传入该格已有 ID 集合；返回首个未被占用的候选。
 */
export function deriveCanonicalId(topic: string, angle: string, taken: Set<string> | string[]): string {
  const used = taken instanceof Set ? taken : new Set(taken);
  for (let n = 1; n < 1000; n++) {
    const id = `${topic}-${angle}-${String(n).padStart(2, '0')}`;
    if (!used.has(id)) return id;
  }
  throw new Error(`无法为 ${topic}×${angle} 分配新 canonical ID（已满）`);
}
