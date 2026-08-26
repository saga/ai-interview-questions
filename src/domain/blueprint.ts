// 纯逻辑：题目蓝图构建、变体候选检索与成题校验。慢速生产管线（ADR-032）的中间层——
// 把覆盖缺口格翻译成受约束的考察目标，作者（人或 LLM）只负责按蓝图写题；
// 成题后 validateAgainstBlueprint 把关一致性。不依赖 React / LLM / 数据单例，
// 题目与知识点由调用方注入，浏览器与 CLI 共用同一实现。

import type {
  ConceptRef,
  Difficulty,
  FormatId,
  KnowledgeNode,
  Question,
  QuestionAngle,
  QuestionBlueprint,
  QuestionTest,
} from '../types';
import { ANGLE_ORDER, ANGLE_SUGGESTIONS, conceptFaceOf, conceptPriority, type CoverageSuggestion } from './coverage.ts';
import { allowedAnglesFor } from '../data/taxonomy.ts';

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

// ── 概念优先蓝图（Concept-coverage 生成管线，PR5）──
// 把生成管线从「直接生成题」前移为「concepts → blueprint → question → tests」：
// 先锁定要验证的概念，再据其生成受约束的蓝图，作者/LLM 只按蓝图写题，成题后映射回 tests。

/**
 * 由单个概念构建题目蓝图。概念作为独立覆盖坐标：
 * - expectedConcepts 以该概念为主（primary），并吸收同节点其它概念作为支撑（supporting），总数 ≤3；
 * - purpose 用概念名套角度模板，保证「为何生成此题」可审查。
 */
export function blueprintFromConcept(
  concept: ConceptRef,
  node: KnowledgeNode,
  opts: { angle?: QuestionAngle; difficulty?: Difficulty; format?: FormatId } = {},
): QuestionBlueprint {
  const angle = opts.angle ?? 'definition';
  const difficulty = opts.difficulty ?? ANGLE_SUGGESTIONS[angle].difficulty;
  const format = opts.format ?? ANGLE_SUGGESTIONS[angle].format;
  const supporting = conceptFaceOf(node)
    .map((c) => c.id)
    .filter((id) => id !== concept.id)
    .slice(0, 2);
  return {
    topic: node.id,
    angle,
    difficulty,
    format,
    purpose: ANGLE_PURPOSE_TEMPLATES[angle](concept.title),
    expectedConcepts: [concept.id, ...supporting],
  };
}

/** 探测未覆盖概念时优先采用的考察角度（由易到难，先建立概念认知再深入）。 */
const PROBE_ANGLE_PREFERENCE: QuestionAngle[] = [
  'definition',
  'fundamental',
  'mechanism',
  'calculation',
  'comparison',
  'tradeoff',
  'scenario',
  'debugging',
];

/**
 * 由概念面 + 覆盖缺口生成「均衡」的概念蓝图清单（PR5 生成管线前移）。
 * - 仅针对 uncovered 概念（getCoverageGaps 的结果），按 conceptPriority 降序（importance 高的先补）；
 * - 每个概念最多 maxPerConcept 张蓝图（默认 1），从源头消灭「5 题全问同一概念」；
 * - 若 gap 数 < count，返回全部 gap 对应的蓝图（不重复造概念）。
 * 返回 { blueprint, concept, node }，供人工审查「为何生成此题」或交由 LLM 据此出题。
 */
export function conceptBlueprintsFromGaps(
  face: ConceptRef[],
  gaps: ConceptRef[],
  nodes: KnowledgeNode[],
  opts: { count?: number; format?: FormatId; maxPerConcept?: number } = {},
): { blueprint: QuestionBlueprint; concept: ConceptRef; node: KnowledgeNode }[] {
  const count = opts.count ?? gaps.length;
  const maxPerConcept = opts.maxPerConcept ?? 1;
  // 概念 id → 所属知识节点（取首个挂载该概念的节点）
  const conceptNode = new Map<string, KnowledgeNode>();
  for (const n of nodes) {
    for (const c of conceptFaceOf(n)) {
      if (!conceptNode.has(c.id)) conceptNode.set(c.id, n);
    }
  }
  // 仅保留有节点归属的 gap（orphan concept 无法生成蓝图），按优先级降序
  const ranked = [...gaps]
    .filter((g) => conceptNode.has(g.id))
    .sort((a, b) => conceptPriority(b) - conceptPriority(a));

  const perConcept: Record<string, number> = {};
  const out: { blueprint: QuestionBlueprint; concept: ConceptRef; node: KnowledgeNode }[] = [];
  for (const g of ranked) {
    if (out.length >= count) break;
    if ((perConcept[g.id] ?? 0) >= maxPerConcept) continue;
    const node = conceptNode.get(g.id)!;
    const allowed = node.angles.length ? node.angles : allowedAnglesFor(node.topic);
    const angle = PROBE_ANGLE_PREFERENCE.find((a) => allowed.includes(a)) ?? allowed[0];
    const blueprint = blueprintFromConcept(g, node, { angle, format: opts.format });
    out.push({ blueprint, concept: g, node });
    perConcept[g.id] = (perConcept[g.id] ?? 0) + 1;
  }
  return out;
}

/**
 * 把生成的题映射回 tests[]：以 blueprint 的 expectedConcepts[0] 为 primary，
 * 其余为 supporting（≤2）。满足「1 primary + ≤2 supporting」红线。
 */
export function testsFromBlueprint(bp: QuestionBlueprint): QuestionTest[] {
  const [primary, ...rest] = bp.expectedConcepts;
  if (!primary) return [];
  return [
    { concept: primary, role: 'primary' },
    ...rest.slice(0, 2).map((c) => ({ concept: c, role: 'supporting' as const })),
  ];
}

/**
 * 由 LLM 生成的题（GeneratedQuestion）+ 蓝图 组装为正式 Question。
 * 当生成结果未带 tests 时回退到 testsFromBlueprint(bp)；transient 选项用于标记探针临时题。
 * 纯函数、不触 LLM、不依赖 React —— 浏览器（PR6 探针）与 CLI（PR5 生成）共用。
 */
export function buildQuestionFromGeneration(
  gen: { question: string; angle?: QuestionAngle; difficulty: Difficulty; formats: Question['formats']; explanation: string; tests?: QuestionTest[] },
  bp: QuestionBlueprint,
  id: string,
  opts: { transient?: boolean } = {},
): Question {
  const tests = gen.tests && gen.tests.length > 0 ? gen.tests : testsFromBlueprint(bp);
  return {
    id,
    category: bp.topic,
    topic: bp.topic,
    tags: [bp.expectedConcepts[0] ?? bp.topic],
    difficulty: gen.difficulty,
    angle: gen.angle ?? bp.angle,
    question: gen.question,
    explanation: gen.explanation,
    aiGenerated: true,
    ...(opts.transient ? { transient: true } : {}),
    tests,
    formats: gen.formats,
  };
}
