// 纯逻辑：题库覆盖矩阵（topic × angle）与补题建议。不依赖 React / LLM / 数据单例——
// 题目与知识点均由调用方注入，浏览器与 CLI（scripts/question-coverage.ts）共用同一实现。
// 两速分离（ADR-032）：本模块是"慢速题库生产"管线的度量端，运行时选题不感知它。

import type { Difficulty, FormatId, KnowledgeArea, KnowledgePriority, QuestionAngle } from '../schemas/common';
import type { KnowledgeNode } from '../schemas/knowledge';
import type { Question } from '../schemas/question';
import { DOMAINS, DOMAIN_LABELS, allowedAnglesFor } from '../data/taxonomy.ts';

/** 角度固定排序（难度梯度序），报告与建议都按此序展示。 */
export const ANGLE_ORDER: QuestionAngle[] = [
  'definition',
  'fundamental',
  'mechanism',
  'comparison',
  'calculation',
  'tradeoff',
  'scenario',
  'debugging',
  'system-design',
  'design',
];

/**
 * 生成阶段的形态/难度起点提示。
 *
 * **这是 heuristic，不是约束。** 它只回答「这个角度通常从什么难度、什么形态起手写最顺」，
 * 不构成「这个角度必须是这个难度/形态」的论断——`scenario` 完全可以是 medium 单选题，
 * `definition` 也可以是 open 题。命名里的 HINT 就是为了防止下游把它当规格读。
 *
 * 使用者请把它当作待人工/模型复核的起点，而不是可断言的事实。
 */
export const ANGLE_GENERATION_HINTS: Record<QuestionAngle, { difficulty: Difficulty; format: FormatId }> = {
  definition: { difficulty: 'easy', format: 'choice' },
  fundamental: { difficulty: 'easy', format: 'choice' },
  mechanism: { difficulty: 'medium', format: 'choice' },
  comparison: { difficulty: 'hard', format: 'open' },
  calculation: { difficulty: 'medium', format: 'choice' },
  tradeoff: { difficulty: 'hard', format: 'open' },
  scenario: { difficulty: 'hard', format: 'open' },
  debugging: { difficulty: 'hard', format: 'open' },
  'system-design': { difficulty: 'hard', format: 'open' },
  design: { difficulty: 'hard', format: 'open' },
};

const PRIORITY_ORDER: KnowledgePriority[] = ['P0', 'P1', 'P2'];

export interface TopicCoverage {
  nodeId: string;
  name: string;
  /** 所属能力域（6 大域之一，ADR-038） */
  domain: KnowledgeArea;
  /** 所属主题（域下的二级分类，如 Inference / RAG） */
  topic: string;
  priority: KnowledgePriority;
  /** 节点声明的期望考察角度 */
  expected: QuestionAngle[];
  /** 实际计数：angle → 题数（angle 必填，每题必落一格） */
  counts: Partial<Record<QuestionAngle, number>>;
  /** 期望角度中计数值为 0 的 = 覆盖缺口 */
  gaps: QuestionAngle[];
}

export interface CoverageMatrix {
  topics: TopicCoverage[];
  /** 题目 topic 找不到对应知识节点 = 数据问题（应修复或立项新知识点），单独计数 */
  unmappedQuestions: number;
}

export interface CoverageSuggestion {
  nodeId: string;
  name: string;
  priority: KnowledgePriority;
  angle: QuestionAngle;
  difficulty: Difficulty;
  format: FormatId;
}

/**
 * 覆盖矩阵：把题目按 topic 归到知识节点，再按主考察角度（q.angle）计数。
 *
 * angle 在 schema 层必填，所以每题必定落进某个格子；此前存在的 `untagged` 计数
 * 是「schema 说可选」历史遗留，随着 angle 收敛为 required 一并移除（ADR-043）。
 */
export function questionCoverageMatrix(questions: Question[], nodes: KnowledgeNode[]): CoverageMatrix {
  const topics = new Map<string, TopicCoverage>(
    nodes.map((n) => [
      n.id,
      {
        nodeId: n.id,
        name: n.name,
        domain: n.area,
        topic: n.topic,
        priority: n.priority,
        // 节点显式声明 angles 时优先用它；否则回退到所属 topic 的角度白名单（ADR-038 延伸）。
        expected: n.angles.length ? [...n.angles] : allowedAnglesFor(n.topic),
        counts: {},
        gaps: [],
      },
    ]),
  );

  let unmappedQuestions = 0;
  for (const q of questions) {
    const t = topics.get(q.topic);
    if (!t) {
      unmappedQuestions++;
      continue;
    }
    t.counts[q.angle] = (t.counts[q.angle] ?? 0) + 1;
  }

  for (const t of topics.values()) {
    t.gaps = t.expected.filter((a) => !t.counts[a]);
  }

  return {
    topics: [...topics.values()].sort(
      (a, b) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority) || a.nodeId.localeCompare(b.nodeId),
    ),
    unmappedQuestions,
  };
}

/**
 * 补题建议：每个缺口格产出一条，按 P0 → nodeId → 角度梯度序排列；
 * 难度/形态来自 ANGLE_GENERATION_HINTS 生成提示（启发式，非约束），供 Blueprint 与人工评审起点用。
 */
export function coverageSuggestions(matrix: CoverageMatrix): CoverageSuggestion[] {
  const suggestions: CoverageSuggestion[] = [];
  for (const t of matrix.topics) {
    const ordered = ANGLE_ORDER.filter((a) => t.gaps.includes(a));
    for (const angle of ordered) {
      suggestions.push({
        nodeId: t.nodeId,
        name: t.name,
        priority: t.priority,
        angle,
        ...ANGLE_GENERATION_HINTS[angle],
      });
    }
  }
  return suggestions;
}

/** 文本报告（CLI 输出与测试快照共用同一格式化，保证两端一致）。 */
export function formatCoverageReport(matrix: CoverageMatrix, suggestions: CoverageSuggestion[]): string {
  const lines: string[] = ['题库覆盖矩阵（topic × angle）· ✓ 已覆盖 / ! 缺口'];

  for (const t of matrix.topics) {
    const cells = ANGLE_ORDER.filter((a) => t.expected.includes(a)).map((a) => {
      const c = t.counts[a] ?? 0;
      return `${a} ${c > 0 ? `${c}✓` : '!'}`;
    });
    lines.push('');
    lines.push(`[${t.nodeId}] ${t.name} · ${t.priority}`);
    lines.push(`  ${cells.join(' · ')}`);
  }

  // ── 按能力域汇总（ADR-038：以域组织而非技术名词平铺） ──
  const byDomain = new Map<string, { topics: number; p0: number; p0Covered: number; gaps: number }>();
  for (const t of matrix.topics) {
    const g = byDomain.get(t.domain) ?? { topics: 0, p0: 0, p0Covered: 0, gaps: 0 };
    g.topics++;
    if (t.priority === 'P0') {
      g.p0++;
      if (t.gaps.length === 0) g.p0Covered++;
    }
    g.gaps += t.gaps.length;
    byDomain.set(t.domain, g);
  }
  lines.push('');
  lines.push('按能力域汇总（域 → 概念数 / P0覆盖 / 缺口数）：');
  for (const d of DOMAINS) {
    const g = byDomain.get(d);
    if (!g) continue;
    lines.push(`  ${DOMAIN_LABELS[d]} · ${g.topics} 概念 · P0 ${g.p0Covered}/${g.p0} · 缺口 ${g.gaps}`);
  }

  lines.push('');
  lines.push(`建议补题（共 ${suggestions.length} 条，P0 优先）：`);
  suggestions.forEach((s, i) => {
    lines.push(`  ${i + 1}. [${s.priority}] ${s.nodeId} · ${s.angle} · ${s.difficulty} · ${s.format}`);
  });

  const expectedCells = matrix.topics.reduce((sum, t) => sum + t.expected.length, 0);
  const gapCells = matrix.topics.reduce((sum, t) => sum + t.gaps.length, 0);
  lines.push('');
  lines.push(
    `汇总：${matrix.topics.length} 知识点 · 期望格 ${expectedCells} · 缺口 ${gapCells}` +
      (matrix.unmappedQuestions > 0 ? ` · 未挂靠知识点的题 ${matrix.unmappedQuestions}` : ''),
  );
  return lines.join('\n');
}
