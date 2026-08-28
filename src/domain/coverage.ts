// 纯逻辑：题库覆盖矩阵（topic × angle）与补题建议。不依赖 React / LLM / 数据单例——
// 题目与知识点均由调用方注入，浏览器与 CLI（scripts/question-coverage.ts）共用同一实现。
// 两速分离（ADR-032）：本模块是"慢速题库生产"管线的度量端，运行时选题不感知它。

import type {
  Difficulty,
  FormatId,
  KnowledgeArea,
  KnowledgeNode,
  KnowledgePriority,
  Question,
  QuestionAngle,
} from '../types';
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

/** 各角度的建议补题形态（启发式：定义/机制/计算适合选择，权衡/情境/系统设计适合开放）。 */
export const ANGLE_SUGGESTIONS: Record<QuestionAngle, { difficulty: Difficulty; format: FormatId }> = {
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
  /** 实际计数：angle → 已标注题数（未标注题不计入） */
  counts: Partial<Record<QuestionAngle, number>>;
  /** 该 topic 下未标注 angle 的题数 */
  untagged: number;
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
 * 未标注 angle 的题进 untagged，不计入任何格子——"没打标"与"真缺口"必须分开看。
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
        untagged: 0,
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
    if (!q.angle) {
      t.untagged++;
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
 * 难度/形态来自 ANGLE_SUGGESTIONS 启发式，供 Blueprint 与人工评审起点用。
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
        ...ANGLE_SUGGESTIONS[angle],
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
    if (t.untagged > 0) lines.push(`  ⚠ ${t.untagged} 题未标注 angle，未计入矩阵`);
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
  const untagged = matrix.topics.reduce((sum, t) => sum + t.untagged, 0);
  lines.push('');
  lines.push(
    `汇总：${matrix.topics.length} 知识点 · 期望格 ${expectedCells} · 缺口 ${gapCells} · 未标注题 ${untagged}` +
      (matrix.unmappedQuestions > 0 ? ` · 未挂靠知识点的题 ${matrix.unmappedQuestions}` : ''),
  );
  return lines.join('\n');
}
