// 应用层知识检索能力（ADR-063 §6/§7）：决定"查什么 / 查多少 / 允许暴露什么"。
//
// 与 domain/knowledge 的分工：
//   domain      → 哪些 evidence 相关（lexical + metadata + graph）
//   application → 该用哪个 scope、哪个答案安全模式、以及怎么拼进 prompt
//
// query planner 刻意保持确定性（正则 + 上下文），不额外消耗一次 LLM 调用：
// 检索范围与答案可见性属于安全边界，不能交给模型"自己判断"。

import {
  searchKnowledge,
  formatCitations,
  type SearchOptions,
} from '../../domain/knowledge/retrieve';
import type {
  KnowledgeEvidence,
  RetrievalMode,
  RetrievalScope,
} from '../../domain/knowledge/types';
import type { Question } from '../../schemas/question';

/** 用户明确在谈"当前/上一道题"。 */
const CURRENT_QUESTION_PATTERN = /这[道个]?题|当前题|刚才|上一题|我答的|为什么错|错在哪|我的答案|这题/;
/** 明确要答案（覆盖"有当前题即 hint"的默认保护）。 */
const ANSWER_PATTERN = /答案|正确选项|选哪[个一]|为什么选|解析一下|正确答案|标准答案/;
/** 只要思路、不要答案。 */
const HINT_PATTERN = /提示|思路|别给答案|不要答案|不要直接|怎么想|从哪入手|引导我|怎么入手/;
/** 要被考 / 要练习题。刻意不写宽松的"…题"通配，避免把"给我这道题的答案"判成 quiz。 */
const QUIZ_PATTERN = /考考我|测[一]?测|练习一下|再来[一]?[道个]|[出给来要][\s一二三两几个0-9]{0,2}[道个]?题/;
/** 概念层讲解：优先给知识节点，而不是塞 10 道题。 */
const CONCEPT_PATTERN = /是什么|什么是|解释|讲一[下讲]|讲讲|聊聊|介绍|原理|区别|对比|差异|优缺点|权衡|总结|系统讲|梳理/;

export interface KnowledgeRetrievalInput {
  query: string;
  /** 当前正在作答/讨论的题目（Chat 面板或训练页）。 */
  activeQuestion?: Question | null;
  /** 已解析出的主题 slug（来自 Intent.topic 或 UI 选择）。 */
  topic?: string;
  /** 显式指定答案安全模式，优先级最高。 */
  mode?: RetrievalMode;
  /** 显式指定检索范围，优先级最高。 */
  scope?: RetrievalScope;
  limit?: number;
  /** 需要排除的题目（例如正在作答的那道，避免直接把自身证据喂回去）。 */
  excludeIds?: string[];
  /**
   * 检索用 query（ADR-065 P1-1）：follow-up 拼接上一轮用户消息后的查询，只用于 lexical 检索，
   * 不参与模式/范围规划（规划用原始 `query`，避免命令词把追问误判成 quiz）。缺省回退到 `query`。
   */
  retrieveQuery?: string;
  /** Learner Memory 弱项信号（ADR-065 P1-2），透传给检索排序做小幅提权。 */
  learnerContext?: { weakTopics?: string[]; weakAngles?: string[] };
}

/**
 * 轻量 query planner（ADR-063 §6）：
 *   当前题解释      → current_question
 *   概念解释        → topic（能解析出主题）/ knowledge（解析不出）
 *   普通聊天/对比   → global
 */
export function planRetrievalScope(input: KnowledgeRetrievalInput): RetrievalScope {
  if (input.scope) return input.scope;
  const text = input.query ?? '';
  if (input.activeQuestion && CURRENT_QUESTION_PATTERN.test(text)) return 'current_question';
  const resolvedTopic = input.topic ?? input.activeQuestion?.topic;
  if (resolvedTopic) return 'topic';
  if (CONCEPT_PATTERN.test(text)) return 'knowledge';
  return 'global';
}

/**
 * 答案安全模式（ADR-063 §7）。默认保守：只要存在当前题目，就不主动暴露真值。
 */
export function planRetrievalMode(input: KnowledgeRetrievalInput): RetrievalMode {
  if (input.mode) return input.mode;
  const text = input.query ?? '';
  if (QUIZ_PATTERN.test(text)) return 'quiz';
  if (HINT_PATTERN.test(text)) return 'hint';
  if (ANSWER_PATTERN.test(text)) return 'answer';
  // P0-1 修复（ADR-065）：有当前题默认给"详细解读"（explain），可解释正确选项，
  // 但不改 assessment truth（prompt 硬约束）。之前的 `return 'hint'` 会把"这道题我不会，
  // 给我详细解读"误限成提示，用户拿不到想要的正解讲解。明确要思路/提示的已在前两行命中 hint。
  if (input.activeQuestion) return 'explain';
  return 'answer';
}

/**
 * 把 follow-up 查询与上一轮用户消息绑定（ADR-065 P1-1）：不消耗 LLM 做 query rewriting，
 * 仅在当前消息看起来是短追问时拼上上一轮用户消息，给 lexical 检索提供上下文。
 * - 当前消息已含明确主题锚点（已知 topic 或较长查询）→ 直接返回，避免污染检索
 * - 当前消息与上一轮完全相同 → 直接返回
 * - 否则（短追问如"为什么""那多选呢"）→ 拼接上一轮用户消息
 */
export function combineFollowUp(current: string, lastUserTurn?: string, topic?: string): string {
  const cur = current.trim();
  if (!lastUserTurn || lastUserTurn.trim() === cur) return current;
  // 已含主题锚点时不拼接：规划仍用原始 query，避免噪声改变范围/模式
  if (topic || cur.length >= 16) return current;
  return `${lastUserTurn} ${cur}`;
}

/** Copilot 主入口：一次调用拿到可直接拼进 prompt 的 evidence。 */
export function retrieveForCopilot(
  input: KnowledgeRetrievalInput,
  options: SearchOptions = {},
): KnowledgeEvidence {
  const scope = planRetrievalScope(input);
  const mode = planRetrievalMode(input);
  return searchKnowledge(
    {
      query: input.retrieveQuery ?? input.query ?? '',
      scope,
      mode,
      topic: input.topic,
      knowledgeId: input.activeQuestion?.topic,
      questionId: input.activeQuestion?.id,
      limit: input.limit,
      excludeIds: input.excludeIds,
      learnerContext: input.learnerContext,
    },
    options,
  );
}

/** 单条 evidence 正文上限，避免少数长文档挤爆上下文窗口。 */
const EVIDENCE_CHAR_LIMIT = 700;

/**
 * 把 evidence 渲染成 system prompt 片段（ADR-063 §5/§8）。
 * 非 answer 模式会显式写入禁止项——检索层已经裁剪过，这里是双保险。
 */
export function buildKnowledgePromptSection(evidence: KnowledgeEvidence | null): string {
  if (!evidence || evidence.hits.length === 0) return '';
  const header = `【知识库检索依据】范围=${evidence.scope} 模式=${evidence.mode} 共 ${evidence.hits.length} 条${
    evidence.seeds.length > 0 ? `（种子：${evidence.seeds.join('、')}）` : ''
  }`;
  // answer / explain 都暴露真值（正确选项 + 解析）：只要求按引用标记作答，不禁止解释正解。
  // hint / quiz 才硬性禁止泄露答案（检索层已裁剪，这里是双保险）。
  const guard =
    evidence.mode === 'answer' || evidence.mode === 'explain'
      ? '回答时如需引用，请使用下方引用标记（如 [K] KV Cache），不要编造未列出的依据。'
      : '以下依据已剔除正确选项、参考答案与完整解析。严禁直接给出或变相暗示正确答案，只能讲知识、给思路、提示常见误区。';
  const body = evidence.hits
    .map((hit, index) => {
      const content = hit.content.slice(0, EVIDENCE_CHAR_LIMIT);
      return `${index + 1}. [${hit.source.kind === 'question' ? 'Q' : hit.source.kind === 'concept' ? 'C' : 'K'}] ${hit.title}\n${content}`;
    })
    .join('\n\n');
  return `${header}\n${guard}\n\n${body}`;
}

/** 供 UI / 回答尾部展示的引用列表。 */
export function knowledgeCitations(evidence: KnowledgeEvidence | null): string[] {
  if (!evidence) return [];
  return formatCitations(evidence.hits);
}
