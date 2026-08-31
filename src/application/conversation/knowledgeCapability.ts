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
import { knowledgeNodes } from '../../data/knowledgeMap';

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
  /** Learner Memory 弱项信号（ADR-065 P1-2 / ADR-066 P1）：weakTopics/weakAngles 为真实弱项，focusTopic 为当前查询焦点（只作锚点，不参与提权）。 */
  learnerContext?: { weakTopics?: string[]; weakAngles?: string[]; focusTopic?: string };
  /** 上一轮解析出的知识锚点（ADR-066 P1）：接成 graph 种子，让确定性 follow-up 也吃到上一轮知识点邻域，而非只靠字符串拼接。 */
  priorKnowledgeIds?: string[];
}

/**
 * query 命中的知识节点 id（ADR-065 P0-2）：用于把"用户想问的知识点"与"当前题 topic"解耦。
 * 只匹配节点 id（长度≥3）与 name，避免把通用词误判成节点。命中返回该节点 id，否则 undefined。
 */
let topicTermIndex: { id: string; terms: string[] }[] | null = null;
function knowledgeTopicTerms(): { id: string; terms: string[] }[] {
  if (!topicTermIndex) {
    topicTermIndex = knowledgeNodes.map((n) => ({
      id: n.id,
      terms: [n.id, n.name].map((t) => t.toLowerCase()).filter((t) => t.length >= 2),
    }));
  }
  return topicTermIndex;
}

/**
 * 判定 query 是否指向某个知识节点（P0-2）。未命中返回 undefined。
 *
 * **最长匹配优先**：收集全部命中后取 term 最长的那个，而不是"数组里第一个命中的"。
 * 旧写法首次命中即返回，锚点由 knowledgeNodes 的数组顺序决定——query「模型推理优化」
 * 会先撞见靠前的泛化节点「模型」就停下，再也不会考虑更具体的「推理优化」。
 * 中文尤其吃这个亏：短词（量化 / 规划 / 幻觉）天然是长词的子串，顺序即偏见。
 *
 * 匹配方式仍是子串包含（nodes 的 id 最短为 3 字符，name 最短 2 字，均已在索引里过滤）：
 * 若对短 term 要求整句相等，"讲讲量化" 这类自然语言提问会几乎全部失配，召回损失远大于误伤。
 */
export function detectQueryTopic(query: string): string | undefined {
  const lower = (query ?? '').toLowerCase();
  if (!lower.trim()) return undefined;
  let bestId: string | undefined;
  let bestLength = 0;
  for (const { id, terms } of knowledgeTopicTerms()) {
    for (const term of terms) {
      if (term.length > bestLength && lower.includes(term)) {
        bestId = id;
        bestLength = term.length;
      }
    }
  }
  return bestId;
}

/**
 * query 是否是对"当前题"的求助（ADR-065 P0-2）：要思路/提示/答案，但没指向其它知识主题。
 * 用于把"求助当前题"与"问另一个知识点"区分开——后者不应被当前题 topic 限制。
 */
function isAboutActiveQuestion(text: string): boolean {
  return HINT_PATTERN.test(text) || ANSWER_PATTERN.test(text);
}

/**
 * 轻量 query planner（ADR-063 §6 / ADR-065 P0-2）：
 *   当前题解释（这题/我的答案/为什么错） → current_question
 *   显式主题 / query 命中其它知识节点    → topic（该节点，不限制到当前题 topic）
 *   关于当前题的求助（提示/答案）         → current_question
 *   概念讲解（什么是 RAG / 讲讲 transformer）→ knowledge
 *   普通 follow-up / 闲聊                 → global
 *
 * 关键修正（P0-2）：activeQuestion 不再天然决定 scope。旧写法
 * `resolvedTopic = topic ?? activeQuestion.topic` 会把"用户在已有题时问另一知识点"
 * 错误限制在 current question 的 topic 内。现在"当前题上下文"与"用户想问的知识主题"
 * 彻底解耦：只有 query 明确指向当前题、或明显是对当前题的求助时，才锚定当前题。
 */
export function planRetrievalScope(input: KnowledgeRetrievalInput): RetrievalScope {
  if (input.scope) return input.scope;
  const text = input.query ?? '';
  // 1) 用户明显在问"当前/上一道题"
  if (input.activeQuestion && CURRENT_QUESTION_PATTERN.test(text)) return 'current_question';
  // 2) 显式主题（来自 Intent.topic 或 UI 选择）
  if (input.topic) return 'topic';
  // 3) query 命中另一个知识节点 → 锚定该节点，不被当前题 topic 限制
  const anchor = detectQueryTopic(text);
  if (anchor) return 'topic';
  // 4) 有当前题且是对当前题的求助（要提示/要答案，无其它主题指向）→ 锚定当前题
  if (input.activeQuestion && isAboutActiveQuestion(text)) return 'current_question';
  // 5) 概念层讲解 → 全局知识节点，不塞 10 道题
  if (CONCEPT_PATTERN.test(text)) return 'knowledge';
  // 6) 其余（普通 follow-up / 闲聊）→ 全局
  return 'global';
}

/**
 * 答案安全模式（ADR-063 §7）。
 *
 * 核心不变量（P0-B）：**`explain` 只允许在 `current_question` 范围出现**。
 * `explain` 在检索层与 `answer` 完全等价——都会把 `sensitiveText`（正确选项 / 参考答案 /
 * 完整解析）喂给模型。旧实现写 `if (input.activeQuestion) return 'explain'`，于是只要页面上
 * 恰好有一道题，任何提问都开着真值闸门：用户问「讲讲 GQA 和 MQA 的区别」（scope 已正确切成
 * topic(gqa)），GQA 题库的 assessment truth 仍被一并送进 prompt——用户只是想聊知识。
 *
 * 现在把「回答风格」与「真值可见性」解耦：真值只在**用户明确在谈那道题**时开启，
 * 其余一切知识问答走安全模式（`hint`）：知识节点 / 误解 / 概念锚点完整可见，
 * 题库真值在检索层就被 `renderDocument` 裁掉，模型根本看不到。
 */
export function planRetrievalMode(input: KnowledgeRetrievalInput): RetrievalMode {
  if (input.mode) return input.mode;
  const text = input.query ?? '';
  if (QUIZ_PATTERN.test(text)) return 'quiz';
  if (HINT_PATTERN.test(text)) return 'hint';
  if (ANSWER_PATTERN.test(text)) return 'answer';
  // 明确锚定当前题（"这道题/我刚才那道/我的答案" 或对它求提示/求答案）→ 允许讲这道题的真值。
  if (planRetrievalScope(input) === 'current_question') return 'explain';
  // 其余（其它知识点、概念讲解、普通追问）→ 安全模式，不暴露题库真值。
  return 'hint';
}

/**
 * 把 follow-up 查询与上一轮用户消息绑定（ADR-065 P1-1）：不消耗 LLM 做 query rewriting，
 * 仅在当前消息看起来是短追问时拼上上一轮用户消息，给 lexical 检索提供上下文。
 * - 当前消息已含明确主题锚点（已知 topic 或较长查询）→ 直接返回，避免污染检索
 * - 当前消息与上一轮完全相同 → 直接返回
 * - 否则（短追问如"为什么""那多选呢"）→ 拼接上一轮用户消息
 */
/**
 * 把 follow-up 查询与上一轮用户消息绑定（ADR-065 P1-1）：不消耗 LLM 做 query rewriting，
 * 仅在当前消息看起来是短追问时拼上上一轮用户消息，给 lexical 检索提供上下文。
 * - 当前消息已含明确主题锚点（已知 topic 或较长查询）→ 直接返回，避免污染检索
 * - 当前消息与上一轮完全相同 → 直接返回
 * - 上一轮是 command / answer（不是 Copilot 知识问题）→ 不参与拼接（P1-4），避免
 *   "给我出一道题 为什么" 这类噪声污染 lexical 检索
 * - 否则（短追问如"为什么""那多选呢"）→ 拼接上一轮 Copilot 用户消息
 */
export function combineFollowUp(
  current: string,
  lastUserTurn?: string,
  topic?: string,
  lastTurnChannel: 'command' | 'answer' | 'copilot' = 'copilot',
): string {
  const cur = current.trim();
  if (!lastUserTurn || lastUserTurn.trim() === cur) return current;
  // 已含主题锚点时不拼接：规划仍用原始 query，避免噪声改变范围/模式
  if (topic || cur.length >= 16) return current;
  // P1-4：上一轮是命令/作答而非 Copilot 知识问题 → 不污染 lexical 检索
  if (lastTurnChannel !== 'copilot') return current;
  return `${lastUserTurn} ${cur}`;
}

/** Copilot 主入口：一次调用拿到可直接拼进 prompt 的 evidence。 */
export function retrieveForCopilot(
  input: KnowledgeRetrievalInput,
  options: SearchOptions = {},
): KnowledgeEvidence {
  const scope = planRetrievalScope(input);
  const mode = planRetrievalMode(input);
  // P0-2：knowledgeId 按 scope 解析，不再恒等于 activeQuestion.topic。
  // - current_question：用当前题自身知识点，并透传 questionId 锁定"这道题"
  // - 显式 topic / query 命中其它节点：用该节点，避免被当前题 topic 限制
  // - 其它（global/knowledge）：不传 knowledgeId，由 query 词面 + graph 决定
  let knowledgeId: string | undefined;
  if (scope === 'current_question') knowledgeId = input.activeQuestion?.topic ?? undefined;
  else if (input.topic) knowledgeId = input.topic;
  else knowledgeId = detectQueryTopic(input.query ?? '') ?? undefined;
  const questionId = scope === 'current_question' ? input.activeQuestion?.id ?? undefined : undefined;
  // ADR-066 P1：把"当前解析出的锚点（topic / 命中节点）+ 上一轮知识锚点"合并为 graph 种子，
  // 让确定性 follow-up 也能吃到上一轮知识点邻域，而不只靠 combineFollowUp 的字符串拼接。
  const seeds = [
    ...(input.topic ? [input.topic] : []),
    ...(knowledgeId ? [knowledgeId] : []),
    ...(input.priorKnowledgeIds ?? []),
  ];
  return searchKnowledge(
    {
      query: input.retrieveQuery ?? input.query ?? '',
      scope,
      mode,
      topic: input.topic,
      knowledgeId,
      questionId,
      ...(seeds.length ? { seeds: [...new Set(seeds)] } : {}),
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
      ? '可基于上方依据作答；不得编造库里不存在的事实，上下文不足时可用通用知识补充并说明。'
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
