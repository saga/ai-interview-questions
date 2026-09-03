import type { StreamFn } from '@earendil-works/pi-agent-core';
import type { LLMProvider, QuestionBank } from '../../types';
import type { AIConfig } from '../../schemas/ai-config';
import type { InterviewDefinition } from '../../schemas/interview';
import type { LearnerProfile } from '../../schemas/learner';
import type { EvaluationResult } from '../../schemas/evaluation';
import type { ProviderEntry } from '../../schemas/ai-config';
import type { AnswerValue } from '../../types';
import type { InterviewSession, SessionQuestion } from '../../schemas/session';
import type { Question } from '../../schemas/question';
import type { ConversationSession } from './conversationSession';
import { buildSession, nextAdaptiveStep } from '../interviewEngine';
import { evaluateAnswer } from './evaluationCapability';
import type { AnswerSignal, Strategy } from '../../domain/adaptive';
import { createInterviewAgent, type InterviewAgentHandle } from '../../agent/interviewAgent';
import { createAgentSession, type AgentHandlers, type InterviewAgentSession } from '../../agent/types';
// 注：本模块复用 createInterviewAgent 作为 Chat 面试的运行时（plan0831_5 §P0-1/P0-2），
// 不再自行实现简化版 Agent 面试。

export async function startInterview(
  bank: QuestionBank,
  definition: InterviewDefinition,
  config?: AIConfig,
): Promise<InterviewSession> {
  return buildSession(bank, definition, config);
}

export async function evaluateInterviewAnswer(
  question: SessionQuestion,
  answer: AnswerValue | undefined,
  provider: LLMProvider | null,
  definition: InterviewDefinition,
): Promise<EvaluationResult | null> {
  return evaluateAnswer(question, answer, provider, definition);
}

export async function continueAdaptiveInterview(
  bank: QuestionBank,
  session: InterviewSession,
  signals: AnswerSignal[],
  profile: LearnerProfile,
  config?: AIConfig,
  provider?: LLMProvider,
): Promise<{ question: SessionQuestion; strategy: Strategy } | null> {
  return nextAdaptiveStep(bank, session, signals, profile, config, provider);
}

/**
 * P0：把 Chat 的「模拟面试」真正接到 `createInterviewAgent`（pi-agent-core），
 * 而非自己实现一套简化版 Agent 面试（plan0831_5 P0-1/P0-2）。
 *
 * `createInterviewAgent` 是事件驱动的（subscribe/start/submitAnswer/onQuestion/onStatus），
 * 而 Chat 的 `CopilotSidebar` 是「拉取式」的（每次用户输入 await 下一步）。本模块把它包成
 * 一个 Promise 化的拉取式驱动：每次 `submit`/`skip` 返回一个 `ChatInterviewStep`，
 * 待 Agent 通过事件把「下一题」或「结束」交付后再 resolve。
 *
 * 这样 Chat 与独立 Agent Interview 页面共用**同一套** Agent 运行时与选题/评分逻辑，
 * 不再维护第三套状态（plan0831_5 §P1-2）；运行时会话直接复用 `InterviewAgentSession`。
 */
export interface ChatInterviewStep {
  /** 是否已结束（无下一题）。 */
  finished: boolean;
  /** 已交付的下一题（finished 时为 null）。 */
  question: SessionQuestion | null;
  /** 致命错误（无法继续，应终止并开新会话）。 */
  fatalError?: string;
}

export interface ChatInterviewController {
  /** 运行时会话（与 Agent Interview 共用同一份结构，满足 §P1-2「不维护第三套状态」）。 */
  readonly session: InterviewAgentSession;
  /** 提交用户答案并推进：评当前题 → 交付下一题（或结束）。返回本回合结果。 */
  submit: (answer: AnswerValue) => Promise<ChatInterviewStep>;
  /** 跳过当前题（不计分）并交付下一题。 */
  skip: () => Promise<ChatInterviewStep>;
  /** 中止当前运行。 */
  abort: () => void;
  /** 释放资源（中止 + 取消订阅）。 */
  dispose: () => void;
}

/**
 * 从持久化的 ConversationSession 重建运行时会话（plan0831_6 P0-1）。
 *
 * 不序列化整个 Agent（含 LLM 运行时），只重建纯数据：answers / evaluations / currentQuestion /
 * startedAt。log / lastSearchIds / fallback 等运行时遥测不持久化，重建时清空。
 * 用于刷新后「把已有 session state 恢复进去、继续 agent」：choice 题走确定性 choiceAdvance，
 * 无需重建 LLM loop；open 题走 submitAnswer → continue()，SDK 允许不先 prompt() 直接续跑
 * （continue() 仅要求 transcript 末条为 user/toolResult，submitAnswer 已满足）。
 */
export function rehydrateInterviewAgent(session: ConversationSession): InterviewAgentSession {
  const currentQuestion = session.context.currentQuestionId
    ? session.questions.find((q) => q.question.id === session.context.currentQuestionId) ?? null
    : null;
  return {
    id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now()),
    status: 'running',
    startedAt: session.startedAt,
    currentQuestion,
    answers: { ...session.answers },
    evaluations: { ...session.evaluations },
    log: [],
    lastSearchIds: [],
    fallbackCount: 0,
  };
}

export interface StartChatInterviewOptions {
  bank: Question[];
  profile: LearnerProfile;
  entry: ProviderEntry;
  /** Agent 主循环降级链（P1-2）：缺省仅用 entry 单引擎。 */
  fallbackEntries?: ProviderEntry[];
  provider: LLMProvider | null;
  instruction?: string;
  generateOpenQuestions?: boolean;
  masteryThreshold?: number;
  /** 用户自定义指令（目标 / 风格 / 偏好层），只追加在不可覆盖的安全层之后。 */
  agentInstructions?: string;
  /** 测试注入：用 mock streamFn + 占位 model 替换真实运行时。 */
  runtimeOverride?: { streamFn: StreamFn; model: unknown };
  /** 恢复模式（plan0831_6 P0-1）：传入已重建的运行时会话，跳过开场指令直接接回当前题。 */
  resumeSession?: InterviewAgentSession;
}

export async function startChatInterview(opts: StartChatInterviewOptions): Promise<{
  controller: ChatInterviewController;
  firstQuestion: SessionQuestion | null;
  finished: boolean;
  fatalError?: string;
}> {
  // 恢复模式：直接复用已重建的运行时会话，不新建（plan0831_6 P0-1）。
  const session = opts.resumeSession ?? createAgentSession();
  let resolver: ((step: ChatInterviewStep) => void) | null = null;

  // 并发保护（plan0831_6 P1-4）：两次提交之间 Agent 必须空闲。busy 期间拒绝新提交，
  // 避免「后一次 makeStepPromise 覆盖 resolver」导致前一次 submit 的 Promise 永不 resolve
  // （double click / 键盘重复提交 / 重入都会触发）。
  let busy = false;

  // 开场阶段的致命错误（首题交付前 Agent 直接 fatal，应终止并开新会话）。
  let startFatal: string | undefined;

  // 把 Agent 的事件（onQuestion / onStatus / onError）转成 Promise 的一次性结果。
  // 每次 submit/skip 都会先设置 resolver 再驱动 Agent，Agent 交付下一题/结束时回调 resolve，
  // 因此 resolver 在事件到达时必然已就绪（两次提交之间 Agent 空闲，不会触发事件）。
  // 注意：开场阶段（agent.start 运行期间）resolver 仍为 null，onQuestion 的 settle 是 no-op，
  // 首题在 await agent.start() 完整结束后再从 session.currentQuestion 读取（见函数末尾）。
  const settle = (step: ChatInterviewStep): void => {
    if (!resolver) return;
    const r = resolver;
    resolver = null;
    // 一步已交付/结束 → Agent 回到空闲，解除并发锁（plan0831_6 P1-4）。
    // 必须在 step 落定时清除，而非在 submitAnswer 内部 Promise 结束时（后者晚于 step 落定，
    // 会与下一次 submit 的 busy=true 竞态，导致锁被错误提前清除）。
    busy = false;
    r(step);
  };

  const handlers: AgentHandlers = {
    onQuestion: (q) => settle({ finished: false, question: q }),
    onStatus: (status) => {
      if (status === 'finished') settle({ finished: true, question: null });
    },
    onError: (message, fatal) => {
      if (fatal) {
        startFatal = message;
        settle({ finished: true, question: null, fatalError: message });
      }
    },
  };

  const agent: InterviewAgentHandle = createInterviewAgent({
    session,
    profile: opts.profile,
    entry: opts.entry,
    fallbackEntries: opts.fallbackEntries ?? [opts.entry],
    bank: opts.bank,
    provider: opts.provider,
    handlers,
    generateOpenQuestions: opts.generateOpenQuestions,
    masteryThreshold: opts.masteryThreshold,
    agentInstructions: opts.agentInstructions,
    runtimeOverride: opts.runtimeOverride,
  });

  const makeStepPromise = (): Promise<ChatInterviewStep> =>
    new Promise<ChatInterviewStep>((res) => {
      resolver = res;
    });

  const controller: ChatInterviewController = {
    session,
    // 提交答案并推进：先挂 resolver，再驱动 Agent（评当前题 → 交付下一题 / 结束）。
    submit: (answer) => {
      if (busy) return Promise.reject(new Error('BUSY'));
      busy = true;
      const p = makeStepPromise();
      // 错误兜底：仅当没有新一步在途（resolver 已空）时才解锁，避免与下一次 submit 的 busy=true 竞态。
      void agent.submitAnswer(answer).catch(() => { if (resolver === null) busy = false; });
      return p;
    },
    // 跳过当前题（不计分）并交付下一题。
    skip: () => {
      if (busy) return Promise.reject(new Error('BUSY'));
      busy = true;
      const p = makeStepPromise();
      void agent.skip().catch(() => { if (resolver === null) busy = false; });
      return p;
    },
    abort: () => agent.abort(),
    dispose: () => agent.dispose(),
  };

  // 恢复模式：当前题已在 session.currentQuestion，无需重新开场（plan0831_6 P0-1）。
  // choice 题后续 submit 走确定性 choiceAdvance；open 题走 submitAnswer → continue()（无需 prior prompt）。
  if (opts.resumeSession?.currentQuestion) {
    return {
      controller,
      firstQuestion: opts.resumeSession.currentQuestion,
      finished: opts.resumeSession.status === 'finished',
    };
  }

  // 开场：await 首轮 run 完整完成（agent_end / 兜底出题），再读 session.currentQuestion 作首题。
  // 不能在第 1 个 onQuestion 事件上提前 resolve——此时 Agent 仍在 processing，
  // 后续 controller.submit → agent.submitAnswer → agent.continue() 会抛「Agent is already processing」。
  await agent.start(opts.instruction ?? '请开始一次模拟面试，给我出第一道题。');

  return {
    controller,
    firstQuestion: session.currentQuestion,
    finished: session.status === 'finished',
    fatalError: startFatal,
  };
}
