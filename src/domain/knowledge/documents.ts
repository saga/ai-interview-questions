// 投影层：把结构化的 KnowledgeNode / Question 投影成统一的 KnowledgeDocument（ADR-063 §2）。
//
// 为什么不能直接把 JSON 当 RAG chunk：KnowledgeNode 是"知识单元"而不是文本片段，
// Question 又带真值。投影层负责两件事：
//   1. 把结构化字段摊平成可检索文本（同时保留 metadata 供精确过滤）
//   2. 把"真值"（explanation / 正确选项 / 参考答案）隔离到 sensitiveText，
//      使 hint / quiz 模式可以在检索层——而不是 prompt 层——保证不泄露。
//
// 纯函数，不依赖 React / LLM。

import type { KnowledgeNode } from '../../schemas/knowledge';
import type { Question } from '../../schemas/question';
import type { KnowledgeDocument, KnowledgeDocumentMetadata, RetrievalMode } from './types';

export interface BuildDocumentsOptions {
  /** 是否为每个 knowledge 节点的误解单独建 doc（hint 模式的主要证据来源）。 */
  includeMisconceptions?: boolean;
  /** 是否为 required 概念建锚点 doc（保证"概念名"可被直接命中）。 */
  includeConcepts?: boolean;
  /** 是否纳入题目（quiz / 讲考点需要；纯概念讲解可关掉）。 */
  includeQuestions?: boolean;
}

const OPTION_LABELS = 'ABCDEF';

function optionLabel(index: number): string {
  return OPTION_LABELS[index] ?? String(index + 1);
}

function choiceTypeLabel(type: 'single' | 'multiple'): string {
  return type === 'single' ? '单选' : '多选';
}

// ── KnowledgeNode → knowledge doc ────────────────────────────

export function knowledgeDocument(node: KnowledgeNode): KnowledgeDocument {
  const lines = [
    `知识点：${node.name}（${node.id}）`,
    `领域：${node.area}｜主题：${node.topic}｜优先级：${node.priority}`,
    `摘要：${node.summary}`,
  ];
  if (node.required.length > 0) {
    lines.push(`前置/必答要点：\n${node.required.map((r) => `- ${r}`).join('\n')}`);
  }
  if (node.misconceptions.length > 0) {
    lines.push(`常见误解：\n${node.misconceptions.map((m) => `- ${m}`).join('\n')}`);
  }
  if (node.angles.length > 0) {
    lines.push(`考察角度：${node.angles.join('、')}`);
  }
  return {
    id: `knowledge:${node.id}`,
    kind: 'knowledge',
    title: node.name,
    text: lines.join('\n'),
    metadata: {
      area: node.area,
      knowledgeId: node.id,
      topic: node.topic,
      priority: node.priority,
    },
    sensitive: false,
  };
}

// ── Question → question doc ──────────────────────────────────

export function questionText(q: Question): string {
  const stem = q.formats.choice?.question ?? q.question;
  const lines = [
    `题目（${q.topic}${q.angle ? ` / ${q.angle}` : ''} / ${q.difficulty}）：${stem}`,
  ];
  const choice = q.formats.choice;
  if (choice) {
    lines.push(`题型：${choiceTypeLabel(choice.type as 'single')}`);
    lines.push(choice.options.map((o, i) => `${optionLabel(i)}. ${o}`).join('\n'));
  }
  const open = q.formats.open;
  if (open) {
    lines.push(`题型：开放题${open.language ? `（${open.language}）` : ''}`);
  }
  if (q.misconceptions && q.misconceptions.length > 0) {
    lines.push(`常见误解：${q.misconceptions.join('；')}`);
  }
  if (q.tags.length > 0) {
    lines.push(`标签：${q.tags.join('、')}`);
  }
  return lines.join('\n');
}

/** 真值片段：只有 answer 模式允许进入 prompt。 */
export function questionSensitiveText(q: Question): string {
  const parts = [`解析：${q.explanation}`];
  const choice = q.formats.choice;
  if (choice) {
    const correct = choice.answer
      .map((i) => `${optionLabel(i)}. ${choice.options[i] ?? ''}`)
      .join(' / ');
    parts.push(`正确选项：${correct}`);
  }
  const open = q.formats.open;
  if (open) parts.push(`参考答案：${open.referenceAnswer}`);
  return parts.join('\n');
}

export function questionDocument(q: Question): KnowledgeDocument {
  const metadata: KnowledgeDocumentMetadata = {
    knowledgeId: q.topic,
    questionId: q.id,
    difficulty: q.difficulty,
    tags: q.tags,
  };
  if (q.angle) metadata.angle = q.angle;
  return {
    id: `question:${q.id}`,
    kind: 'question',
    title: (q.formats.choice?.question ?? q.question).slice(0, 80),
    text: questionText(q),
    sensitiveText: questionSensitiveText(q),
    metadata,
    sensitive: true,
  };
}

// ── misconceptions / concepts ────────────────────────────────

export function misconceptionDocuments(node: KnowledgeNode): KnowledgeDocument[] {
  return node.misconceptions
    .map((m) => m.trim())
    .filter((m) => m.length > 0)
    .map((m, index) => ({
      id: `misconception:${node.id}:${index}`,
      kind: 'misconception' as const,
      title: `误解：${m.slice(0, 60)}`,
      text: `常见误解（${node.name} / ${node.id}）：${m}`,
      metadata: {
        area: node.area,
        knowledgeId: node.id,
        topic: node.topic,
        priority: node.priority,
      },
      sensitive: false as const,
    }));
}

/**
 * 概念锚点文档（concept anchor，不是完整知识文档）。
 *
 * 它只承载「X 出现在某知识节点的前置要点（required）中」这一事实，本身不含知识内容——
 * 真正知识在 `knowledge` 文档里。它存在的唯一目的是让「概念名」可被直接命中并桥接到
 * 所属 knowledge 节点的 graph 邻域。检索去重时按 id（而非 title）去重，但 concept 锚点
 * 因正文近似、只作检索跳板，仍按 title 去重以免同类概念刷屏（见 retrieve.ts dedup 注释）。
 */
export function conceptAnchorDocuments(node: KnowledgeNode): KnowledgeDocument[] {
  return node.required
    .map((concept) => concept.trim())
    .filter((concept) => concept.length > 0)
    .map((concept, index) => ({
      id: `concept:${node.id}:${index}`,
      kind: 'concept' as const,
      title: concept.slice(0, 60),
      text: `概念：${concept}\n出现在「${node.name}（${node.id}）」的前置要点中（概念锚点，非完整知识文档）。`,
      metadata: {
        area: node.area,
        knowledgeId: node.id,
        topic: node.topic,
        priority: node.priority,
      },
      sensitive: false as const,
    }));
}

// ── 统一入口 ─────────────────────────────────────────────────

export function buildKnowledgeDocuments(
  nodes: KnowledgeNode[],
  questions: Question[] = [],
  options: BuildDocumentsOptions = {},
): KnowledgeDocument[] {
  const { includeMisconceptions = true, includeConcepts = true, includeQuestions = true } = options;
  const docs: KnowledgeDocument[] = nodes.map(knowledgeDocument);
  if (includeMisconceptions) {
    for (const node of nodes) docs.push(...misconceptionDocuments(node));
  }
  if (includeConcepts) {
    for (const node of nodes) docs.push(...conceptAnchorDocuments(node));
  }
  if (includeQuestions) {
    for (const q of questions) docs.push(questionDocument(q));
  }
  return docs;
}

// ── 答案安全模式（ADR-063 §7）────────────────────────────────

/**
 * 按 mode 渲染文档正文。
 * hint / quiz：剥离 sensitiveText（referenceAnswer / choice.answer / 完整 explanation）。
 * 这是硬裁剪——被裁剪的内容根本不会进入 prompt，而不是请求模型"不要说"。
 */
export function renderDocument(doc: KnowledgeDocument, mode: RetrievalMode): string {
  if (mode === 'answer' || mode === 'explain') {
    // answer / explain 都允许暴露真值（正确选项 + 解析 + 参考答案）。
    // explain 与 answer 在检索层无差异——区别在 prompt 的 modeNote（"讲解" vs "给答案"），
    // 但两者都禁止模型篡改 assessment truth（prompt 硬约束，见 copilotPrompt.ts）。
    return doc.sensitiveText ? `${doc.text}\n${doc.sensitiveText}` : doc.text;
  }
  if (mode === 'quiz') {
    // quiz：只保留题干与考点，连选项都不要（选项本身会缩小答案空间）。
    return firstBlock(doc.text);
  }
  return doc.text;
}

/** 取正文的第一段（题干行），用于 quiz 模式。 */
function firstBlock(text: string): string {
  const [first = ''] = text.split('\n');
  return first;
}
