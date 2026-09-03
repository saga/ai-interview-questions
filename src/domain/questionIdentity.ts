// 纯逻辑：canonical assessment 身份判定（P1-1；plan0903_3 / ADR-077 补入 cognitiveTask）。
//
// 背景：Learner Memory 以 `questionId` 为历史证据键。若补覆盖缺口时原地改写
// 已有题的 `angle / difficulty / 认知任务` 却沿用原 ID，旧分数在语义上立即失效，
// 而系统仍能正常运行——隐性数据污染。因此：
//
//   variant            = 同一 Knowledge 的不同 reasoning path 测量（可改 angle / cognitiveTask，
//                        见 ADR-077；答案逻辑不变，仍归因同一 canonical evidence 键）
//   derived canonical  = 同一知识血缘、不同 assessment identity（必须新 ID + derivedFrom）
//
// 不依赖 React / LLM。

import type { Question } from '../schemas/question';

/** assessment contract：决定"这道题测什么"的最小字段集合（D2：cognitiveTask 入约）。 */
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
