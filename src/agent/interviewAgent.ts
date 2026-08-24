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
import type { Model, UserMessage } from '@earendil-works/pi-ai';
import { isEntryValid } from '../ai/provider';
import type { AnswerValue, LLMProvider, LearnerProfile, ProviderEntry, Question } from '../types';
import { createAgentTools } from './tools';
import { INTERVIEW_AGENT_SYSTEM_PROMPT } from './prompt';
import { buildAgentRuntime } from './runtime';
import type { AgentHandlers, InterviewAgentSession } from './types';
import { countEvaluated } from './types';

/** 单轮 Agent 面试的题数上限（达到即优雅停止）。 */
export const MAX_AGENT_QUESTIONS = 10;

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
  const { session, profile, entry, bank, provider, handlers } = opts;
  const runtime = opts.runtimeOverride ?? buildAgentRuntime(entry);
  const tools = createAgentTools({ bank, profile, provider, session });

  const agent = new Agent({
    streamFn: runtime.streamFn,
    initialState: { model: runtime.model as Model<any>, systemPrompt: INTERVIEW_AGENT_SYSTEM_PROMPT },
    shouldStopAfterTurn: (ctx) => shouldStopAfterTurn(session, ctx),
    beforeToolCall: (ctx) => Promise.resolve(beforeToolCall(entry, session, ctx)),
  });
  // Agent 构造不接受 tools 选项，工具须通过 state.tools 注入（AgentState 的 setter 会拷贝数组）。
  agent.state.tools = tools;

  const unsubscribe = agent.subscribe((event: AgentEvent, signal: AbortSignal) => {
    handlers?.onEvent?.(event, signal);
    if (event.type === 'tool_execution_end') {
      if (event.toolName === 'getQuestion') handlers?.onQuestion?.(session.currentQuestion);
      if (event.toolName === 'finishInterview') handlers?.onStatus?.('finished');
    }
  });

  function start(instruction: string): Promise<void> {
    return agent.prompt(instruction);
  }

  function submitAnswer(answer: AnswerValue): Promise<void> {
    const qid = session.currentQuestion?.question.id;
    if (qid !== undefined) session.answers[qid] = answer;
    const msg: UserMessage = { role: 'user', content: typeof answer === 'string' ? answer : JSON.stringify(answer), timestamp: Date.now() };
    agent.state.messages = [...agent.state.messages, msg];
    return agent.continue();
  }

  function abort(): void {
    agent.abort();
  }

  return { agent, start, submitAnswer, abort, dispose: unsubscribe };
}
