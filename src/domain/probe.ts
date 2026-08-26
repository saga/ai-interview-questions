// Dynamic Probe（PR6）：当概念优先抽题选中一个「无对应题库题」的 uncovered 概念时，
// 由 LLM 生成一道临时题（transient，不经 QuestionSource 持久化）来探测它；
// 作答后该概念被计入会话历史，概念统计自动回写（见 interviewEngine.buildConceptContext）。
// 本模块为纯逻辑：仅做「探针频率统计」与「晋升阈值判定」与「探针蓝图构建」，
// 不触 LLM、不依赖 React —— LLM 生成由 application 层（interviewEngine）调用 provider.generateQuestion。

import type { ConceptRef, KnowledgeNode, Question, QuestionBlueprint } from '../types';
import { blueprintFromConcept } from './blueprint.ts';

/** 同一概念被探针反复探测达到此次数 → 触发「晋升为正式题」建议（题库自演化，PR6）。 */
export const PROBE_PROMOTION_THRESHOLD = 3;

/** 统计某概念在本次会话中已被探针探测的次数（transient 且 primary 命中该概念）。 */
export function probeFrequency(conceptId: string, asked: Question[]): number {
  return asked.filter(
    (q) => q.transient && (q.tests ?? []).some((t) => t.concept === conceptId && t.role === 'primary'),
  ).length;
}

/** 是否达到晋升阈值：某概念被探针反复探测，说明它是真实、值得补成正式题的缺口。 */
export function shouldPromoteProbe(
  conceptId: string,
  asked: Question[],
  threshold = PROBE_PROMOTION_THRESHOLD,
): boolean {
  return probeFrequency(conceptId, asked) >= threshold;
}

/** 由概念构建探针蓝图：首次探测 unseen 概念用易定义题建立认知（可由上层改角度）。 */
export function buildProbeBlueprint(concept: ConceptRef, node: KnowledgeNode): QuestionBlueprint {
  return blueprintFromConcept(concept, node, { angle: 'definition', difficulty: 'easy', format: 'choice' });
}
