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

export interface StartChatInterviewOptions {
  bank: Question[];
  profile: LearnerProfile;
  entry: ProviderEntry;
  provider: LLMProvider | null;
  instruction?: string;
  generateOpenQuestions?: boolean;
  masteryThreshold?: number;
  /** 用户自定义指令（目标 / 风格 / 偏好层），只追加在不可覆盖的安全层之后。 */
  agentInstructions?: string;
  /** 测试注入：用 mock streamFn + 占位 model 替换真实运行时。 */
  runtimeOverride?: { streamFn: StreamFn; model: unknown };
}

export async function startChatInterview(opts: StartChatInterviewOptions): Promise<{
  controller: ChatInterviewController;
  firstQuestion: SessionQuestion | null;
  finished: boolean;
  fatalError?: string;
}> {
  const session = createAgentSession();
  let resolver: ((step: ChatInterviewStep) => void) | null = null;

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
      const p = makeStepPromise();
      void agent.submitAnswer(answer);
      return p;
    },
    // 跳过当前题（不计分）并交付下一题。
    skip: () => {
      const p = makeStepPromise();
      void agent.skip();
      return p;
    },
    abort: () => agent.abort(),
    dispose: () => agent.dispose(),
  };

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
