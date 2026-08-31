// 命令检测器（ADR-064）：只回答一个问题 ——「用户是不是要改变训练状态？」
//
// 与旧 router.ts 的区别：
//   1. 不再有 LLM 意图分类。命令只有 5 个确定性动作，正则足够；旧实现每条消息都要
//      classifyIntent 先打一次 LLM、真正回答再打一次，现在省掉前一次往返。
//   2. 不再有 general_chat / explain_topic / answer_current_question 这些「伪意图」。
//      解释、提示、比较、追问、知识问答一律走 Copilot 通道（./copilot.ts）。
//   3. 不再有「意图不确定 → 请说命令」的阻断。不确定就是 Copilot。把 Copilot 降级成
//      命令行是产品定位错误：UI 明明写着「解释考点、拆解思路、给出提示」。
//
// 注意顺序：求助信号（isHelpSeeking）优先于 answer 通道，这让
// 「这道题我不会，给我一些详细的解读」不会被当成一次作答去评分。

import type { Difficulty, FormatId } from '../../schemas/common';
import type { ConversationContext } from '../../schemas/conversation';
import type { Question } from '../../schemas/question';

export type CommandKind =
  | 'start_interview'
  | 'ask_question'
  | 'continue_interview'
  | 'end_interview'
  | 're_evaluate';

export interface Command {
  kind: CommandKind;
  topic?: string;
  difficulty?: Difficulty;
  format?: FormatId;
}

/** 用户消息的三条去向：改状态 / 交答案 / 问知识。 */
export type ConversationChannel =
  | { kind: 'command'; command: Command }
  | { kind: 'answer' }
  | { kind: 'copilot' };

const TOPIC_ALIASES: Record<string, string> = {
  rag: 'rag',
  agent: 'agent-fundamentals',
  agents: 'agent-fundamentals',
  'agent 基础': 'agent-fundamentals',
  '上下文工程': 'context-engineering',
  'context engineering': 'context-engineering',
  训练: 'training',
  推理: 'inference',
  'system design': 'system-design',
  'system-design': 'system-design',
  系统设计: 'system-design',
  transformer: 'transformer',
  'tool calling': 'tool-calling',
  'tool-calling': 'tool-calling',
  evaluation: 'evaluation',
  评估: 'evaluation',
  'multi-agent': 'multi-agent',
  mcp: 'mcp',
  观测: 'observability',
  observability: 'observability',
};

// ── 命令正则 ────────────────────────────────────────────────────

const END_PATTERN = /^(结束|停止|先到这里|结束面试|结束训练|不练了)/u;
const RE_EVALUATE_PATTERN = /^(重新.*(评价|评分)|再.*(评价|评分)一次|评价一下刚才)/u;
/** 换一道/跳过/不想答 也算「继续」：跳过当前题、交付下一道。 */
const CONTINUE_PATTERN =
  /^(继续|下一题|再来一道|下一道|继续考|再出一题|下一个|再来一个|继续面试|追问|针对.*(继续|追问)|再难一点|难一点|简单一点|换一道|换一题|换题|换一个题|跳过|不想答|不答了)/u;
const START_PATTERN = /(开始|启动).*(面试|模拟)/u;
const ASK_PATTERN =
  /(出|来|给我).*(道|个|一).*(题|问题)|考考?我|来个.*(题|的)|问.*(题|一道)/u;
const HARD_PATTERN = /难一点|更难|困难|hard/u;
const EASY_PATTERN = /简单一点|简单|容易|easy/u;

/**
 * 求助/咨询信号（ADR-064 §3/§6）：这类输入不是作答，而是「我想知道什么」。
 *
 * 刻意不收录裸「答案」——「答案是 A」是作答；要答案的问法用「答案是什么/给我答案/正确答案」。
 * 也不收录裸「详细」「展开」——开放题作答里很常见，会被误判成求助。
 */
const HELP_SEEKING_PATTERN =
  /不会|不懂|不明白|不清楚|不知道|没思路|没头绪|卡住|提示|解释|解读|讲解|讲讲|讲一下|讲一讲|说说|聊聊|梳理|总结|思路|入手|考点|为什么|怎么|什么是|是什么|举个例子|举例说明|详细讲|详细说|再详细|展开讲|展开说|展开一下|区别|对比|差异|优缺点|权衡|分析一下|帮我|教我|答案是什么|答案是啥|给我答案|告诉我答案|正确答案|正确选项|该选哪|选哪[个一]|hint|explain|\bwhy\b|\bhow\b|\bwhat\b/iu;

function normalizeTopic(topic?: string): string | undefined {
  if (!topic) return undefined;
  const value = topic.trim().toLowerCase();
  return TOPIC_ALIASES[value] ?? TOPIC_ALIASES[topic.trim()] ?? topic.trim();
}

function matchTopic(text: string): string | undefined {
  return normalizeTopic(Object.keys(TOPIC_ALIASES).find((key) => text.includes(key)));
}

function matchDifficulty(text: string): Difficulty | undefined {
  if (HARD_PATTERN.test(text)) return 'hard';
  if (EASY_PATTERN.test(text)) return 'easy';
  return undefined;
}

/** 用户在求助/咨询，不是在作答。 */
export function isHelpSeeking(input: string): boolean {
  const text = input.trim();
  if (!text) return false;
  // 疑问句一律当提问（开放题作答极少以问号收尾）。
  if (/[?？]\s*$/.test(text)) return true;
  return HELP_SEEKING_PATTERN.test(text);
}

/**
 * 识别训练控制命令；识别不出返回 null（调用方应转 Copilot，而不是报错）。
 *
 * @param context 用于唯一一处上下文纠正：上一场已结束时的「下一题」应开新一轮，
 *                而不是续接到一个已清空的 session。
 */
export function detectCommand(input: string, context?: ConversationContext): Command | null {
  const text = input.trim();
  if (!text) return null;
  const lower = text.toLowerCase();

  if (END_PATTERN.test(text)) return { kind: 'end_interview' };
  if (RE_EVALUATE_PATTERN.test(text)) return { kind: 're_evaluate' };
  if (CONTINUE_PATTERN.test(text)) {
    if (context?.endedAt) return { kind: 'ask_question', topic: matchTopic(lower) };
    return { kind: 'continue_interview', topic: matchTopic(lower), difficulty: matchDifficulty(lower) };
  }
  if (START_PATTERN.test(text)) return { kind: 'start_interview', topic: matchTopic(lower) };
  // ask 的正则最宽松（"给我…题"），带上求助词时让位给 Copilot：
  // 「给我详细解读这道题」不是要新题。
  if (ASK_PATTERN.test(text) && !isHelpSeeking(text)) {
    return { kind: 'ask_question', topic: matchTopic(lower), difficulty: matchDifficulty(lower) };
  }
  return null;
}

/**
 * 解析用户对某道题的作答：选择题抽出选项下标，开放题原样返回文本。
 * 抽不出合法选项时回退为原文（交给评分层判定无效作答）。
 */
export function parseChatAnswer(question: Question, input: string): string | number[] {
  if (!question.formats.choice) return input;
  return optionIndexes(input, question.formats.choice.options.length) ?? input;
}

/** 文本中的选项字母 → 去重后的下标；无合法选项返回 null。 */
function optionIndexes(input: string, optionCount: number): number[] | null {
  const indexes = [...input.toUpperCase().matchAll(/(?:^|[^A-Z])([A-F])(?=$|[^A-Z])/g)].map(
    (m) => m[1].charCodeAt(0) - 65,
  );
  const valid = [...new Set(indexes)].filter((i) => i >= 0 && i < optionCount);
  return valid.length ? valid : null;
}

function shouldSubmitAsAnswer(
  input: string,
  context: ConversationContext,
  question: Question | null | undefined,
): boolean {
  // 只有「当前确实有待作答的题目」才存在答案通道。
  if (!question || context.pendingAction !== 'answer' || !context.currentQuestionId) return false;
  const text = input.trim();
  if (!text) return false;
  // 选择题必须能解析出合法选项；其余输入视为在咨询而不是作答。
  if (question.formats.choice) return optionIndexes(text, question.formats.choice.options.length) !== null;
  return true;
}

/**
 * 唯一的通道决策点（ADR-064 §5）：
 *
 *   command → 训练动作（改状态）
 *   求助     → Copilot（问知识）
 *   待作答   → 提交答案
 *   其余     → Copilot
 *
 * 命令优先于求助：「下一题」「结束」永远不会被当成一次求助。
 * 求助优先于答案：这是「这道题我不会，给我详细解读」不再被误判成作答的关键。
 */
export function routeUserMessage(
  input: string,
  context: ConversationContext,
  activeQuestion?: Question | null,
): ConversationChannel {
  const command = detectCommand(input, context);
  if (command) return { kind: 'command', command };
  if (isHelpSeeking(input)) return { kind: 'copilot' };
  if (shouldSubmitAsAnswer(input, context, activeQuestion)) return { kind: 'answer' };
  return { kind: 'copilot' };
}
