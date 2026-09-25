// Agent 运行时编排（Phase 2）：构建 pi-agent-core Agent 作为面试决策中心。
// 职责边界（对齐 AGENTS.md 与计划）：
// - Agent 只做「不确定的决策」；确定性的选题/评分/读画像全部通过工具（见 tools.ts）；
// - 评分委托现有逻辑，Agent 不自己打分；
// - 持久化不在本层：UI 在 finishInterview 后调用 updateLearner + sessionFromQuiz 落库；
// - 停止条件：finishInterview 被调用，或已评题数达上限。

import { Agent } from '@earendil-works/pi-agent-core';
import type {
  AgentEvent,
  AgentTurnContext,
  BeforeToolCallContext,
  BeforeToolCallResult,
  StreamFn,
} from '@earendil-works/pi-agent-core';
import type { AssistantMessage, Model, UserMessage } from '@earendil-works/pi-ai';
import { isEntryValid } from '../ai/provider';
import type { AnswerValue, LLMProvider } from '../types';
import type { EvaluationResult } from '../schemas/evaluation';
import type { FormatId } from '../schemas/common';
import type { LearnerProfile } from '../schemas/learner';
import type { ProviderEntry } from '../schemas/ai-config';
import type { Question } from '../schemas/question';
import type { SessionQuestion } from '../schemas/session';
import { availableFormats } from '../domain/quiz';
import { pickNextAdaptive, type AnswerSignal } from '../domain/adaptive';
import { createAgentTools } from './tools';
import { effectiveProfileFor } from './sessionState';
import { evaluateSessionQuestion } from '../application/sessionEvaluator';
import { buildAgentSystemPrompt } from './prompt';
import { buildAgentRuntime, buildFallbackAgentRuntime } from './runtime';
import { piUsageToLLMUsage } from '../ai/pi';
import type { LLMUsage } from '../types';
import type { AgentHandlers, InterviewAgentSession } from './types';
import { countDelivered } from './types';

/** 单轮 Agent 面试的题数上限（达到即优雅停止）。 */
export const MAX_AGENT_QUESTIONS = 10;

/**
 * 单条用户答案的最大字符数：超出部分截断。
 *
 * 目的（评审第八节）：用户答案会直接进入 Agent 的 UserMessage 并被 evaluateAnswer 评分，
 * 若不限长，一次粘贴长文就能让上下文与评估 token 无界膨胀。
 *
 * 取舍：这里 **故意** 不设成与 Chrome 历史条目截断（900 字符）相同的值——
 * 过紧会截断开放题的正常作答，反而损害评分质量。副作用是超长答案在
 * 「Native 完整答案」与「Chrome 截断历史」两条路径上仍可能有差异，但差异已被本上限约束，
 * 且按评审结论**不引入 context compaction**：当前 10 题以内、以选择题为主，收益不足以抵消复杂度。
 */
export const MAX_ANSWER_CHARS = 2000;

/** 把用户答案限制在 {@link MAX_ANSWER_CHARS} 内（仅对字符串生效，选择题的选项数组原样返回）。 */
export function clampAnswer(answer: AnswerValue): AnswerValue {
  if (typeof answer !== 'string') return answer;
  return answer.length > MAX_ANSWER_CHARS
    ? `${answer.slice(0, MAX_ANSWER_CHARS)}…（已截断至 ${MAX_ANSWER_CHARS} 字）`
    : answer;
}

/**
 * 看门狗：若 Agent run 在 WATCHDOG_MS 内既未交付题目也未结束（如流式挂起），
 * 主动中止并触发确定性兜底出题，避免页面无限停在「面试官正在选题…」。
 */
const WATCHDOG_MS = 90_000;

/**
 * 停止条件：本轮调用了 finishInterview、已交付题数达上限、或**已停在逐题反馈上**。
 * 导出便于单测。
 *
 * 用「已交付」而非「已评分」计数：交付即占位，即便该题评分失败（evaluations[id] = null）
 * 也必须计入上限，否则评分连续失败时永远停不下来。
 *
 * 关于第三个条件（immediate 模式的暂停）：本函数是 `finishTurn` 的实现，
 * 返回 true 时运行时以 `{ action: 'end' }` **优雅收尾本轮 run**——
 * 刻意不走 `agent.abort()`：abort 会被运行时归类为错误（stopReason='aborted' → model_error
 * telemetry），既不优雅也会让用户看到「模型返回错误」。优雅收尾后由 `continueAfterFeedback()`
 * 通过 `agent.continue()` 另起一轮，语义清晰且不污染错误遥测。
 */
export function shouldStopAfterTurn(
  session: InterviewAgentSession,
  ctx: AgentTurnContext,
): boolean {
  if (session.status === 'awaiting_feedback') return true;
  if (ctx.toolResults.some((tr) => tr.toolName === 'finishInterview')) return true;
  if (countDelivered(session) >= MAX_AGENT_QUESTIONS) return true;
  return false;
}

/**
 * 工具调用守卫。
 * 1. 暂停闸：immediate 模式下已停在反馈上时，冻结「出题」与「重复评分」。
 *    必须挡在工具层——`finishTurn` 只在**整轮工具全部执行完**后才调用，
 *    若模型在同一条 assistant 消息里先调 evaluateAnswer 再调 getQuestion（toolExecution 为
 *    sequential，按序执行），没有这道闸就会在展示反馈前把题目换掉。
 * 2. 引擎闸：开放题评估需要 LLM，若引擎配置无效（无 key / 未启用）则拦截，
 *    避免运行时在无 key 情况下崩溃；选择题确定性判分不受影响。
 */
export function beforeToolCall(
  entry: ProviderEntry,
  session: InterviewAgentSession,
  ctx: BeforeToolCallContext,
): BeforeToolCallResult | undefined {
  if (
    session.status === 'awaiting_feedback' &&
    (ctx.toolCall.name === 'getQuestion' || ctx.toolCall.name === 'evaluateAnswer')
  ) {
    return {
      block: true,
      reason: '已停在本题反馈上，等待用户确认「继续」后再决定下一题，请勿提前出题或重复评分。',
    };
  }
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
  /** 主引擎（守卫/展示用）。`fallbackEntries` 未传时它也是唯一的运行时引擎。 */
  entry: ProviderEntry;
  /**
   * Agent 主循环降级链（P1-2）：按序尝试，首个为主引擎。传入多条时运行时走
   * `buildFallbackAgentRuntime`，否则退化为单引擎 `buildAgentRuntime(entry)`。
   * 用户主动取消（abort）绝不切换引擎，直接透出。
   */
  fallbackEntries?: ProviderEntry[];
  bank: Question[];
  provider: LLMProvider | null;
  handlers?: AgentHandlers;
  /** 对应 AIConfig.generateOpenQuestions 全局开关；默认 false（与全局 AIConfig 一致，避免漏传时绕过开关）。 */
  generateOpenQuestions?: boolean;
  /** 对应 AIConfig.runtimeVariantEnabled 全局开关；默认 false（Pool-first 离线资产优先，运行时仅兜底）。 */
  runtimeVariantEnabled?: boolean;
  /** 主题达标线（0-100）；默认 75。 */
  masteryThreshold?: number;
  /** 用户自定义指令（目标 / 风格 / 偏好层）。只追加在不可覆盖的安全层 + 契约层之后，
   *  绝不会替换或覆盖内置 system prompt；为空时仅用安全层 + 契约层（见 `buildAgentSystemPrompt`）。 */
  agentInstructions?: string;
  /** KV Cache 命中遥测（P1④）：每轮 assistant 消息结束（含工具调用轮）回传归一化用量。
   * 多轮 append-only 对话下，cacheHitTokens 应随轮次递增——这是验证 stable-prefix 是否命中缓存的真凭实据。 */
  onUsage?: (usage: LLMUsage) => void;
  /** 测试注入：用 mock streamFn + 占位 model 替换真实 buildAgentRuntime（避免真实网络/模型查找）。 */
  runtimeOverride?: { streamFn: StreamFn; model: unknown };
}

export interface InterviewAgentHandle {
  agent: Agent;
  /** 开场：用指令启动首轮（选题/提问）。 */
  start: (instruction: string) => Promise<void>;
  /** 提交用户作答并推进下一轮（当前题的答案 + 继续）。 */
  submitAnswer: (answer: AnswerValue) => Promise<void>;
  /**
   * 用户确认本题反馈、放行下一题（仅 immediate 模式有意义）。
   * - 幂等：非 `awaiting_feedback` 状态调用是 no-op；
   * - 开放题（LLM 路径）→ `agent.continue()`，由 Agent 决定下一题（保留自适应决策）；
   * - 选择题 / 兜底模式 → 确定性选题，与原路径一致，不额外唤起 LLM。
   */
  continueAfterFeedback: () => Promise<void>;
  /** 跳过当前题（不计分）并交付下一题，供「换一道/跳过/不想答」控制词使用。 */
  skip: () => Promise<void>;
  /** 中止当前运行。 */
  abort: () => void;
  /** 取消事件订阅。 */
  dispose: () => void;
}

/**
 * 创建一个面试 Agent 运行时。Agent 在 observe → decide → tool → observe 循环中推进面试，
 * 工具把决策落到共享的 `session` 上（currentQuestion / answers / evaluations / log）。
 *
 * 设计权衡（trade-off）——「自愈兜底」为什么必须有：
 * - LLM 不可靠：它可能在 run 结束时不调 getQuestion、把 topic 当 id 传入、或流式中途报错，
 *   纯 Agent 会静默收场，导致页面永远停在「面试官正在选题…」。这是真实发生过的高频卡死源。
 * - 因此引入确定性护栏：看门狗（WATCHDOG_MS）超时 + agent_end 收尾钩子，都会触发 ensureQuestionDelivered，
 *   用 pickNextAdaptive 直接出下一道题；一旦兜底接管（usingFallback），后续整场由确定性引擎自驱，
 *   不再依赖 LLM，保证「要么出题、要么优雅收尾」，杜绝无限「选题中」。
 * - 代价：状态机（usingFallback / watchdog / 双路径）增加了复杂度，但相比「卡死」是可接受的必要冗余。
 * - 工具注入方式：Agent 构造不接受 tools 选项，只能事后通过 state.tools 注入（已验证的 SDK 约定）。
 */
export function createInterviewAgent(opts: CreateInterviewAgentOptions): InterviewAgentHandle {
  const { session, profile, entry, fallbackEntries, bank, provider, handlers, generateOpenQuestions = false, runtimeVariantEnabled = false, masteryThreshold, agentInstructions: configuredInstructions } = opts;
  const chain = (fallbackEntries ?? [entry]).filter(Boolean);
  const runtime = opts.runtimeOverride ?? (chain.length > 1
    ? buildFallbackAgentRuntime(chain)
    : buildAgentRuntime(chain[0] ?? entry));
  const tools = createAgentTools({ bank, profile, provider, session, generateOpenQuestions, runtimeVariantEnabled, masteryThreshold });
  const bankById = new Map(bank.map((q) => [q.id, q]));

  // 分层构建系统提示：安全层 + 契约层（不可覆盖）始终在前，用户自定义指令只追加在后。
  // 关闭开放题时，把开关状态作为「本轮配置」追加在最后，让 Agent 主动只选选择题（减少无效请求被拒）。
  const systemPrompt = buildAgentSystemPrompt(configuredInstructions) + (generateOpenQuestions
    ? ''
    : `\n\n## 本轮配置\n「生成开放题」开关已关闭：请只选择并使用选择题（choice），不要请求开放题（open），否则会被系统拦截并要求换题。`);
  const agent = new Agent({
    streamFn: runtime.streamFn,
    // P0-1（DeepSeek KV Cache）：把 InterviewAgentSession.id（稳定 UUID）作为 provider cache-aware
    // 的 session identity 转给底层。DeepSeek 的磁盘 prefix cache 虽不靠 sessionId 命中，但这是 Pi 官方
    // 为 cache-aware backend 提供的会话身份，且能跨 resume/刷新保持同一身份（resume 复用持久化 session.id），
    // 对未来 provider 变化与任何 session-affinity 机制都有价值（pi-agent-core AgentOptions.sessionId）。
    sessionId: session.id,
    initialState: { model: runtime.model as Model<any>, systemPrompt },
    // 停止条件（pi-agent-core 0.87 的 finishTurn，取代已移除的 shouldStopAfterTurn）：
    // 需要停止时返回 `{ action: 'end' }` 优雅收尾本轮 run；否则返回 undefined 交回默认调度
    // （**不**返回 `{ action: 'continue' }`——那会强制多发一次 provider 请求，改变既有行为）。
    finishTurn: (turn) => (shouldStopAfterTurn(session, turn) ? { action: 'end' } : undefined),
    beforeToolCall: (ctx) => Promise.resolve(beforeToolCall(entry, session, ctx)),
    // 共享可变 session 状态：并行执行工具调用会引入真实竞态（同 tick 内多个 getQuestion/evaluateAnswer
    // 交错写入 session.currentQuestion / evaluations）。强制串行，保证工具按 LLM 决策顺序顺序落地。
    toolExecution: 'sequential',
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
      // 已交付且用户尚未作答 → 正常等待，不动；已结束 → 不动；停在反馈上等确认 → 不动
      if (session.status === 'finished' || session.status === 'awaiting_feedback') return;
      if (session.currentQuestion && !Object.prototype.hasOwnProperty.call(session.evaluations, session.currentQuestion.question.id)) return;
      agent.abort();
      void ensureQuestionDelivered('timeout');
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
    const fmtsAllowed: FormatId[] = generateOpenQuestions ? [] : ['choice'];
    const pool = bank.filter((q) => !asked.has(q.id) && availableFormats(q, fmtsAllowed).length > 0);
    if (pool.length === 0) return false;

    const signals: AnswerSignal[] = Object.entries(session.evaluations)
      .map(([id, ev]) => {
        const q = bankById.get(id);
        if (!q || !ev) return null;
        return { topic: q.topic, score: ev.overall, difficulty: q.difficulty } as AnswerSignal;
      })
      .filter((x): x is AnswerSignal => x !== null);

    // P0-1：确定性兜底与 Agent 工具读同一份「有效画像」（历史 + 本轮已评分），
    // 保证兜底接管的选题也感知本轮表现，而不是冻结的历史快照。
    const picked = pickNextAdaptive(pool, signals, effectiveProfileFor(session, bank, profile), Math.random);
    if (!picked || !picked.question) return false;
    const q = picked.question;
    const fmts = availableFormats(q, []);
    const format: FormatId = fmts.includes('choice') ? 'choice' : 'open';
    const sq: SessionQuestion = { question: q, format };
    session.currentQuestion = sq;
    handlers?.onQuestion?.(sq);
    return true;
  }

  /**
   * **评分完成的统一出口**（本特性的核心接缝）。
   *
   * 为什么必须在这里而不是在 evaluateAnswer 工具里：提交作答后共有三条评分路径——
   *   ① `choiceAdvance`：选择题，确定性 `gradeChoice`，**不经过** evaluateAnswer 工具；
   *   ② `fallbackAdvance`：兜底接管后由确定性引擎自驱，同样不经过工具；
   *   ③ LLM 循环：开放题，经 evaluateAnswer 工具 → `evaluateAnswerCapability`。
   * 三条路径最终都必须「写入 evaluations → 决定是否推进」，本函数就是这个共同动作。
   * 把暂停点放在工具层只能覆盖第 ③ 条，immediate 模式在选择题（当前占比过半）上会完全失效。
   *
   * 职责：写 evaluations → 通知 UI（onEvaluation）→ 依 feedbackMode 决定是否停在反馈上。
   *
   * @returns true 表示已进入 `awaiting_feedback`，**调用方不得再推进下一题**。
   */
  function afterEvaluation(
    sq: SessionQuestion,
    answer: AnswerValue,
    evaluation: EvaluationResult | null,
  ): boolean {
    session.evaluations[sq.question.id] = evaluation;
    // evaluation === null（未作答 / 评分失败）：没有可展示的反馈，
    // 绝不能伪造一份 0 分反馈，也不能把未评分题写进 Learner Memory → 按原流程推进。
    if (!evaluation) return false;
    // 先置状态再通知：回调里读到的 `session.status` 必须与「是否停在反馈上」一致。
    // （回调另有一个显式的 awaitingFeedback 参数，此处保持两者同源，避免出现
    //  「status 已暂停但回调说没暂停」这种自相矛盾的中途态。）
    const awaitingFeedback = session.feedbackMode === 'immediate';
    if (awaitingFeedback) session.status = 'awaiting_feedback';
    handlers?.onEvaluation?.(sq, answer, evaluation, awaitingFeedback);
    if (awaitingFeedback) {
      handlers?.onStatus?.('awaiting_feedback');
      return true;
    }
    return false;
  }

  /**
   * 确定性交付下一题（或优雅收尾），不依赖 LLM、不设置 usingFallback。
   * 由「选择题快路径」与「immediate 模式下用户确认继续（选择题 / 兜底）」共用。
   */
  function advanceDeterministic(): void {
    const askedCount = new Set([...Object.keys(session.answers), ...Object.keys(session.evaluations)]).size;
    if (askedCount >= MAX_AGENT_QUESTIONS || session.status === 'finished') {
      handlers?.onStatus?.('finished');
      return;
    }
    if (!fallbackNextQuestion()) {
      if (Object.keys(session.evaluations).length > 0) handlers?.onStatus?.('finished');
      else handlers?.onError?.('面试已结束：当前题库没有可考察的题目', true);
    }
  }

  /** 兜底模式下自驱：记录答案 → 评分 → 交付下一题（或收尾）。 */
  async function fallbackAdvance(answer: AnswerValue): Promise<void> {
    const sq = session.currentQuestion;
    if (sq) {
      session.answers[sq.question.id] = answer;
      let evaluation: EvaluationResult | null = null;
      try {
        evaluation = await evaluateSessionQuestion(sq, answer, provider);
      } catch {
        evaluation = null;
      }
      // immediate 模式：停在反馈上，等用户确认（不再继续推进）
      if (afterEvaluation(sq, answer, evaluation)) return;
    }
    await ensureQuestionDelivered();
  }

  /**
   * 选择题快路径（性能优化，独立于兜底）：选择题判分是确定性的（gradeChoice，不触 LLM/网络），
   * 且下一题选择由确定性自适应引擎 pickNextAdaptive 承担，因此**完全跳过 LLM 决策循环**——
   * 用户提交选择题后应瞬时出结果，不应出现「正在检查回答」长时间转圈。
   * 与 fallbackAdvance 的区别：本路径只处理「当前题为选择题」这一回合，不翻转 usingFallback，
   * 以免误杀后续开放题的 LLM 评分路径与 Agent 自适应决策。
   */
  async function choiceAdvance(answer: AnswerValue): Promise<void> {
    const sq = session.currentQuestion;
    if (sq) {
      const qid = sq.question.id;
      session.answers[qid] = answer;
      let evaluation: EvaluationResult | null = null;
      try {
        // choice 形态走 gradeChoice（确定性），不触 LLM；即使 provider 无效也不影响
        evaluation = await evaluateSessionQuestion(sq, answer, provider);
      } catch {
        evaluation = null;
      }
      // immediate 模式：停在反馈上，等用户确认（不再继续推进）
      if (afterEvaluation(sq, answer, evaluation)) return;
    }
    // 确定性交付下一题（或收尾），不设置 usingFallback
    advanceDeterministic();
  }

  /**
   * 在 Agent run 收尾（agent_end）或看门狗触发时，确保「题已交付」：
   * - 当前已有一道待用户作答的题 → 不干预（正常等待作答）；
   * - 否则若仍在题数上限内且有未问题目 → 确定性兜底交付；
   * - 否则（无题可出 / 已达上限）→ 优雅收尾（onStatus('finished')）。
   */
  async function ensureQuestionDelivered(
    reason: 'timeout' | 'model_error' | 'agent_no_action' = 'agent_no_action',
  ): Promise<void> {
    clearWatchdog();
    // immediate 模式下停在反馈上等用户确认 → 不干预。
    // 必须在最前面：本函数会被 agent_end 调用，而 immediate 的暂停正是靠「本轮 run 优雅结束」
    // 实现的——若没有这道闸，run 一结束就会立刻兜底出下一题，暂停形同虚设。
    if (session.status === 'awaiting_feedback') return;
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
      // telemetry：记录兜底原因与次数，便于观察真实 Agent 稳定性（P1 第 4 项），不驱动逻辑。
      session.fallbackCount = (session.fallbackCount ?? 0) + 1;
      if (!session.fallbackReason) session.fallbackReason = reason;
      session.log.push({
        at: Date.now(),
        kind: 'event',
        summary: `兜底出题接管（原因：${reason}）`,
        details: { fallbackReason: reason, fallbackCount: session.fallbackCount },
      });
      return;
    }
    // 无更多题目可交付
    if (countDelivered(session) > 0) handlers?.onStatus?.('finished');
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
      // P1④：每轮 assistant 消息都带用量（含 KV Cache 命中/未命中），回传上层做遥测。
      if (opts.onUsage && msg.usage) opts.onUsage(piUsageToLLMUsage(msg.usage));
    }
    if (event.type === 'tool_execution_end') {
      if (event.toolName === 'getQuestion') handlers?.onQuestion?.(session.currentQuestion);
      if (event.toolName === 'evaluateAnswer') {
        // LLM 路径（第 ③ 条）汇入统一出口：工具已把结果写进 session.evaluations，
        // 这里只负责「通知 UI + 依 feedbackMode 决定是否暂停」，与另两条路径行为一致。
        const sq = session.currentQuestion;
        if (sq) afterEvaluation(sq, session.answers[sq.question.id], session.evaluations[sq.question.id] ?? null);
      }
      if (event.toolName === 'finishInterview') handlers?.onStatus?.('finished');
    }
    if (event.type === 'agent_end') {
      // 先定格兜底原因：lastErrorMessage 稍后会被清空，若等清空后再判断，
      // ensureQuestionDelivered 永远只会收到 'agent_no_action'，model_error 将永不入账。
      const reason = lastErrorMessage ? 'model_error' : 'agent_no_action';
      if (lastErrorMessage) handlers?.onError?.(lastErrorMessage);
      lastErrorMessage = undefined;
      // 修复 A/C：agent 静默收场但未交付题 → 兜底出题（或收尾）
      await ensureQuestionDelivered(reason);
    }
  });

  function start(instruction: string): Promise<void> {
    lastErrorMessage = undefined;
    armWatchdog();
    return agent.prompt(instruction);
  }

  function submitAnswer(answer: AnswerValue): Promise<void> {
    // immediate 模式下停在反馈上：拒绝新的作答提交（必须先确认继续）。
    // 防御性 no-op：正常 UI 在反馈态不会给出提交入口，但 Copilot 侧与快捷键可能重入。
    if (session.status === 'awaiting_feedback') {
      session.log.push({
        at: Date.now(),
        kind: 'event',
        summary: '已停在本题反馈上，忽略新的作答提交（需先确认「继续」）',
      });
      return Promise.resolve();
    }
    // 入口处统一限长：答案无上界会让上下文/评估 token 随一次粘贴无限膨胀（评审第八节）。
    const bounded = clampAnswer(answer);
    // 兜底模式已接管：不走 agent.continue()，自驱评分与下一题（修复 C）
    if (usingFallback) return fallbackAdvance(bounded);
    // 选择题：确定性判分 + 确定性选题，跳过 LLM 循环（应非常快，避免「正在检查回答」长时间转圈）
    if (session.currentQuestion?.format === 'choice') return choiceAdvance(bounded);
    const qid = session.currentQuestion?.question.id;
    if (qid !== undefined) session.answers[qid] = bounded;
    const msg: UserMessage = { role: 'user', content: typeof bounded === 'string' ? bounded : JSON.stringify(bounded), timestamp: Date.now() };
    agent.state.messages = [...agent.state.messages, msg];
    lastErrorMessage = undefined;
    armWatchdog();
    return agent.continue();
  }

  /**
   * 用户确认本题反馈 → 放行下一题（仅 immediate 模式）。
   *
   * 按路径分流（为什么不能一律走确定性兜底）：
   * - 选择题 / 兜底模式：原本就是确定性选题（不依赖 LLM），直接复用，保持「瞬时出下一题」；
   * - 开放题：原本由 Agent 在 LLM 循环里决定下一题。若改用 `fallbackNextQuestion()`，
   *   会把 `usingFallback` 永久翻转为 true，使余下整场面试都退化成确定性选题、丧失自适应决策——
   *   因此必须用 `agent.continue()` 把循环接回来，由 Agent 决定下一题。
   */
  async function continueAfterFeedback(): Promise<void> {
    if (session.status !== 'awaiting_feedback') return; // 幂等：重复点击 / 非暂停态调用
    session.status = 'running';
    handlers?.onStatus?.('running');
    const sq = session.currentQuestion;
    if (usingFallback || sq?.format === 'choice') {
      advanceDeterministic();
      return;
    }
    lastErrorMessage = undefined;
    armWatchdog();
    await agent.continue();
  }

  function abort(): void {
    clearWatchdog();
    agent.abort();
  }

  /**
   * 跳过当前题：不评分，直接交付下一题（或收尾）。供 Chat「换一道/跳过/不想答」控制词使用。
   * 仅标记当前题为「已处理（不计分）」，复用确定性兜底选题（与正常流程同一份 effective profile）。
   */
  async function skip(): Promise<void> {
    // 停在反馈上时跳过：先解除暂停。否则 ensureQuestionDelivered 会因 awaiting_feedback
    // 直接 early-return，导致「跳过」静默失效。
    if (session.status === 'awaiting_feedback') {
      session.status = 'running';
      handlers?.onStatus?.('running');
    }
    const sq = session.currentQuestion;
    if (sq) session.evaluations[sq.question.id] = null;
    await ensureQuestionDelivered();
  }

  // 真正的资源释放：清空看门狗（避免悬挂定时器）→ 中止仍在运行的 run → 取消事件订阅。
  // 此前 dispose 仅等于 unsubscribe，看门狗与进行中的 run 不会被回收，切换/卸载会话时造成泄漏与竞态。
  function dispose(): void {
    clearWatchdog();
    try {
      agent.abort();
    } catch {
      // 未运行 agent.abort() 是安全的 no-op，忽略
    }
    unsubscribe();
  }

  return { agent, start, submitAnswer, continueAfterFeedback, skip, abort, dispose };
}
