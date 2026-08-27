// Agent 运行时编排（Phase 2）：构建 pi-agent-core Agent 作为面试决策中心。
// 职责边界（对齐 AGENTS.md 与计划）：
// - Agent 只做「不确定的决策」；确定性的选题/评分/读画像全部通过工具（见 tools.ts）；
// - 评分委托现有逻辑，Agent 不自己打分；
// - 持久化不在本层：UI 在 finishInterview 后调用 updateLearner + sessionFromQuiz 落库；
// - 停止条件：finishInterview 被调用，或已评题数达上限。

import { Agent } from '@earendil-works/pi-agent-core';
import type {
  AgentEvent,
  BeforeToolCallContext,
  BeforeToolCallResult,
  ShouldStopAfterTurnContext,
  StreamFn,
} from '@earendil-works/pi-agent-core';
import type { AssistantMessage, Model, UserMessage } from '@earendil-works/pi-ai';
import { isEntryValid } from '../ai/provider';
import type { AnswerValue, FormatId, LLMProvider, LearnerProfile, ProviderEntry, Question, SessionQuestion } from '../types';
import { availableFormats } from '../domain/quiz';
import { pickNextAdaptive, type AnswerSignal } from '../domain/adaptive';
import { createAgentTools, evaluateSessionQuestion } from './tools';
import { INTERVIEW_AGENT_SYSTEM_PROMPT } from './prompt';
import { buildAgentRuntime } from './runtime';
import type { AgentHandlers, InterviewAgentSession } from './types';
import { countEvaluated } from './types';

/** 单轮 Agent 面试的题数上限（达到即优雅停止）。 */
export const MAX_AGENT_QUESTIONS = 10;

/**
 * 看门狗：若 Agent run 在 WATCHDOG_MS 内既未交付题目也未结束（如流式挂起），
 * 主动中止并触发确定性兜底出题，避免页面无限停在「面试官正在选题…」。
 */
const WATCHDOG_MS = 60_000;

/** 停止条件：本轮调用了 finishInterview，或已评题数达上限。导出便于单测。 */
export function shouldStopAfterTurn(
  session: InterviewAgentSession,
  ctx: ShouldStopAfterTurnContext,
): boolean {
  if (ctx.toolResults.some((tr) => tr.toolName === 'finishInterview')) return true;
  if (countEvaluated(session) >= MAX_AGENT_QUESTIONS) return true;
  return false;
}

/**
 * 工具调用守卫：开放题评估需要 LLM，若引擎配置无效（无 key / 未启用）则拦截，
 * 避免运行时在无 key 情况下崩溃；选择题确定性判分不受影响。
 */
export function beforeToolCall(
  entry: ProviderEntry,
  session: InterviewAgentSession,
  ctx: BeforeToolCallContext,
): BeforeToolCallResult | undefined {
  if (ctx.toolCall.name === 'evaluateAnswer') {
    const fmt = session.currentQuestion?.format;
    if (fmt === 'open' && !isEntryValid(entry)) {
      return { block: true, reason: '未配置有效的 API Key，无法评估开放题。可改用选择题或先在设置中配置引擎。' };
    }
  }
  return undefined;
}

export interface CreateInterviewAgentOptions {
  session: InterviewAgentSession;
  profile: LearnerProfile;
  entry: ProviderEntry;
  bank: Question[];
  provider: LLMProvider;
  handlers?: AgentHandlers;
  /** 对应 AIConfig.generateOpenQuestions 全局开关；默认 true（允许开放题）。 */
  generateOpenQuestions?: boolean;
  /** 测试注入：用 mock streamFn + 占位 model 替换真实 buildAgentRuntime（避免真实网络/模型查找）。 */
  runtimeOverride?: { streamFn: StreamFn; model: unknown };
}

export interface InterviewAgentHandle {
  agent: Agent;
  /** 开场：用指令启动首轮（选题/提问）。 */
  start: (instruction: string) => Promise<void>;
  /** 提交用户作答并推进下一轮（当前题的答案 + 继续）。 */
  submitAnswer: (answer: AnswerValue) => Promise<void>;
  /** 中止当前运行。 */
  abort: () => void;
  /** 取消事件订阅。 */
  dispose: () => void;
}

/**
 * 创建一个面试 Agent 运行时。Agent 在 observe → decide → tool → observe 循环中推进面试，
 * 工具把决策落到共享的 `session` 上（currentQuestion / answers / evaluations / log）。
 */
export function createInterviewAgent(opts: CreateInterviewAgentOptions): InterviewAgentHandle {
  const { session, profile, entry, bank, provider, handlers, generateOpenQuestions = true } = opts;
  const runtime = opts.runtimeOverride ?? buildAgentRuntime(entry);
  const tools = createAgentTools({ bank, profile, provider, session, generateOpenQuestions });
  const bankById = new Map(bank.map((q) => [q.id, q]));

  // 关闭开放题时，把开关状态注入系统提示，让 Agent 主动只选选择题（减少无效请求被拒）。
  const systemPrompt = generateOpenQuestions
    ? INTERVIEW_AGENT_SYSTEM_PROMPT
    : `${INTERVIEW_AGENT_SYSTEM_PROMPT}\n\n## 本轮配置\n「生成开放题」开关已关闭：请只选择并使用选择题（choice），不要请求开放题（open），否则会被系统拦截并要求换题。`;
  const agent = new Agent({
    streamFn: runtime.streamFn,
    initialState: { model: runtime.model as Model<any>, systemPrompt },
    shouldStopAfterTurn: (ctx) => shouldStopAfterTurn(session, ctx),
    beforeToolCall: (ctx) => Promise.resolve(beforeToolCall(entry, session, ctx)),
  });
  // Agent 构造不接受 tools 选项，工具须通过 state.tools 注入（AgentState 的 setter 会拷贝数组）。
  agent.state.tools = tools;

  // ── 自愈状态（修复 A/C/E：agent 路径 100% 依赖 LLM 调 getQuestion，一旦不调/写错 id/流式报错
  //    就静默 agent_end；以下逻辑保证「要么 LLM 出题，要么确定性兜底出题」，杜绝无限『选题中』）──
  let usingFallback = false; // 一旦兜底接管，后续整场由确定性引擎驱动
  let lastErrorMessage: string | undefined;
  let watchdog: ReturnType<typeof setTimeout> | null = null;

  function clearWatchdog() {
    if (watchdog) {
      clearTimeout(watchdog);
      watchdog = null;
    }
  }
  function armWatchdog() {
    clearWatchdog();
    watchdog = setTimeout(() => {
      // 已交付且用户尚未作答 → 正常等待，不动；已结束 → 不动
      if (session.status === 'finished') return;
      if (session.currentQuestion && !Object.prototype.hasOwnProperty.call(session.evaluations, session.currentQuestion.question.id)) return;
      agent.abort();
      void ensureQuestionDelivered();
    }, WATCHDOG_MS);
  }

  /** 用确定性自适应引擎挑出下一道未问题目（不依赖 LLM），写入 session 并通知 UI。返回是否成功交付。 */
  function fallbackNextQuestion(): boolean {
    const asked = new Set<string>([
      ...Object.keys(session.answers),
      ...Object.keys(session.evaluations),
      ...(session.currentQuestion ? [session.currentQuestion.question.id] : []),
    ]);
    // 尊重全局「生成开放题」开关：关闭时只从「可出选择题」的题中挑选，避免兜底出开放题。
    const fmtsAllowed = generateOpenQuestions ? [] : ['choice'];
    const pool = bank.filter((q) => !asked.has(q.id) && availableFormats(q, fmtsAllowed).length > 0);
    if (pool.length === 0) return false;

    const signals: AnswerSignal[] = Object.entries(session.evaluations)
      .map(([id, ev]) => {
        const q = bankById.get(id);
        if (!q || !ev) return null;
        return { topic: q.topic, score: ev.overall, difficulty: q.difficulty } as AnswerSignal;
      })
      .filter((x): x is AnswerSignal => x !== null);

    const picked = pickNextAdaptive(pool, signals, profile, Math.random, undefined, false);
    if (!picked || !picked.question) return false;
    const q = picked.question;
    const fmts = availableFormats(q, []);
    const format: FormatId = fmts.includes('choice') ? 'choice' : 'open';
    const sq: SessionQuestion = { question: q, format };
    session.currentQuestion = sq;
    handlers?.onQuestion?.(sq);
    return true;
  }

  /** 兜底模式下自驱：记录答案 → 评分 → 交付下一题（或收尾）。 */
  async function fallbackAdvance(answer: AnswerValue): Promise<void> {
    const sq = session.currentQuestion;
    if (sq) {
      const qid = sq.question.id;
      session.answers[qid] = answer;
      try {
        session.evaluations[qid] = await evaluateSessionQuestion(sq, answer, provider);
      } catch {
        session.evaluations[qid] = null;
      }
    }
    await ensureQuestionDelivered();
  }

  /**
   * 在 Agent run 收尾（agent_end）或看门狗触发时，确保「题已交付」：
   * - 当前已有一道待用户作答的题 → 不干预（正常等待作答）；
   * - 否则若仍在题数上限内且有未问题目 → 确定性兜底交付；
   * - 否则（无题可出 / 已达上限）→ 优雅收尾（onStatus('finished')）。
   */
  async function ensureQuestionDelivered(): Promise<void> {
    clearWatchdog();
    // 已交付且用户尚未作答 → 等待用户，不干预
    if (session.currentQuestion && !Object.prototype.hasOwnProperty.call(session.evaluations, session.currentQuestion.question.id)) {
      return;
    }
    const askedCount = new Set([...Object.keys(session.answers), ...Object.keys(session.evaluations)]).size;
    if (askedCount >= MAX_AGENT_QUESTIONS || session.status === 'finished') {
      handlers?.onStatus?.('finished');
      return;
    }
    if (fallbackNextQuestion()) {
      usingFallback = true;
      return;
    }
    // 无更多题目可交付
    if (Object.keys(session.evaluations).length > 0) handlers?.onStatus?.('finished');
    else handlers?.onError?.('面试已结束：当前题库没有可考察的题目', true);
  }

  const unsubscribe = agent.subscribe(async (event: AgentEvent, signal: AbortSignal) => {
    handlers?.onEvent?.(event, signal);
    if (event.type === 'message_end') {
      // 修复 B：识别流式错误（stopReason: error/aborted 或 errorMessage）
      const msg = event.message as AssistantMessage;
      if (msg.stopReason === 'error' || msg.stopReason === 'aborted' || msg.errorMessage) {
        lastErrorMessage = msg.errorMessage ?? `模型返回错误（${msg.stopReason}）`;
      }
    }
    if (event.type === 'tool_execution_end') {
      if (event.toolName === 'getQuestion') handlers?.onQuestion?.(session.currentQuestion);
      if (event.toolName === 'finishInterview') handlers?.onStatus?.('finished');
    }
    if (event.type === 'agent_end') {
      if (lastErrorMessage) handlers?.onError?.(lastErrorMessage);
      lastErrorMessage = undefined;
      // 修复 A/C：agent 静默收场但未交付题 → 兜底出题（或收尾）
      await ensureQuestionDelivered();
    }
  });

  function start(instruction: string): Promise<void> {
    lastErrorMessage = undefined;
    armWatchdog();
    return agent.prompt(instruction);
  }

  function submitAnswer(answer: AnswerValue): Promise<void> {
    // 兜底模式已接管：不走 agent.continue()，自驱评分与下一题（修复 C）
    if (usingFallback) return fallbackAdvance(answer);
    const qid = session.currentQuestion?.question.id;
    if (qid !== undefined) session.answers[qid] = answer;
    const msg: UserMessage = { role: 'user', content: typeof answer === 'string' ? answer : JSON.stringify(answer), timestamp: Date.now() };
    agent.state.messages = [...agent.state.messages, msg];
    lastErrorMessage = undefined;
    armWatchdog();
    return agent.continue();
  }

  function abort(): void {
    clearWatchdog();
    agent.abort();
  }

  return { agent, start, submitAnswer, abort, dispose: unsubscribe };
}
