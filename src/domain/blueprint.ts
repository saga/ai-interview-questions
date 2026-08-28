// 纯逻辑：题目蓝图构建、变体候选检索与成题校验。慢速生产管线（ADR-032）的中间层——
// 把覆盖缺口格翻译成受约束的考察目标，作者（人或 LLM）只负责按蓝图写题；
// 成题后 validateAgainstBlueprint 把关一致性。不依赖 React / LLM / 数据单例，
// 题目与知识点由调用方注入，浏览器与 CLI 共用同一实现。

import type { KnowledgeNode, Question, QuestionAngle, QuestionBlueprint } from '../types';
import { ANGLE_ORDER, type CoverageSuggestion } from './coverage.ts';

/** 缺口格 → 考察目的的默认措辞。模板只是起点：人工可在蓝图上改写 purpose。 */
export const ANGLE_PURPOSE_TEMPLATES: Record<QuestionAngle, (name: string) => string> = {
  definition: (name) => `检验学习者能否准确解释${name}的核心概念与适用边界`,
  fundamental: (name) => `检验学习者是否掌握${name}的基本原理与基础概念`,
  mechanism: (name) => `检验学习者是否理解${name}的内在机制与成因`,
  comparison: (name) => `检验学习者能否对比${name}与其他方案的异同与取舍`,
  calculation: (name) => `检验学习者能否围绕${name}完成定量计算与数值推理`,
  tradeoff: (name) => `检验学习者能否权衡${name}相关方案的代价、收益与适用条件`,
  scenario: (name) => `检验学习者能否在工程情境中运用${name}定位并解决问题`,
  debugging: (name) => `检验学习者能否诊断并定位${name}相关的故障与异常`,
  'system-design': (name) => `检验学习者能否以${name}为核心设计端到端系统方案`,
  design: (name) => `检验学习者能否基于${name}设计或改进具体系统/机制`,
};

/**
 * 由补题建议构建蓝图：purpose 来自角度模板 + 知识点名，
 * expectedConcepts 取知识节点 required（评分要点的权威来源，ADR-029）。
 * topic 无对应知识节点时返回 null（游离题不进生产管线）。
 */
export function blueprintFromSuggestion(
  s: CoverageSuggestion,
  nodes: KnowledgeNode[],
): QuestionBlueprint | null {
  const node = nodes.find((n) => n.id === s.nodeId);
  if (!node) return null;
  return {
    topic: s.nodeId,
    angle: s.angle,
    difficulty: s.difficulty,
    format: s.format,
    purpose: ANGLE_PURPOSE_TEMPLATES[s.angle](node.name),
    expectedConcepts: [...node.required],
  };
}

/** 角度在梯度序上的距离（越近越适合作为变体基底）；无标注题排最后。 */
function angleDistance(a: QuestionAngle, b: QuestionAngle): number {
  return Math.abs(ANGLE_ORDER.indexOf(a) - ANGLE_ORDER.indexOf(b));
}

/**
 * 变体候选（复用 > 变体 > 生成的"变体"步）：该格无题才需要补题，
 * 所以不存在可整体复用的题——退而求其次，找同 topic 的近角度题作变体基底
 * （改造题干角度/情境比从零生成稳定得多）。按角度梯度距离升序返回。
 */
export function variantCandidates(questions: Question[], bp: QuestionBlueprint): Question[] {
  return questions
    .filter((q) => q.topic === bp.topic)
    .sort(
      (a, b) =>
        (a.angle ? angleDistance(a.angle, bp.angle) : Number.POSITIVE_INFINITY) -
          (b.angle ? angleDistance(b.angle, bp.angle) : Number.POSITIVE_INFINITY) ||
        a.id.localeCompare(b.id),
    );
}

export type BlueprintCheck = { ok: true } | { ok: false; reason: string };

/**
 * 成题校验：题目必须落在蓝图约束内——topic / angle / difficulty 一致，
 * 且具备目标呈现形态。内容质量（题干是否真的考到 expectedConcepts）不在
 * 静态校验范围内，留给评审/LLM Validator（管线第 ⑥ 步）。
 */
export function validateAgainstBlueprint(q: Question, bp: QuestionBlueprint): BlueprintCheck {
  if (q.topic !== bp.topic) return { ok: false, reason: `topic 不一致：期望 ${bp.topic}，实际 ${q.topic}` };
  if (q.angle !== bp.angle) return { ok: false, reason: `angle 不一致：期望 ${bp.angle}，实际 ${String(q.angle)}` };
  if (q.difficulty !== bp.difficulty)
    return { ok: false, reason: `difficulty 不一致：期望 ${bp.difficulty}，实际 ${q.difficulty}` };
  if (!q.formats[bp.format]) return { ok: false, reason: `缺少目标形态 ${bp.format}` };
  return { ok: true };
}

