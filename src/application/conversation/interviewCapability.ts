// 面试能力层（application/conversation 下的 capability 之一，与 questionCapability /
// evaluationCapability / knowledgeCapability 同层）。
//
// 这里只保留**规则式面试**的确定性能力：建会话 / 评一题 / 走一步自适应。
// 由 pi-agent-core 驱动的「Agent 面试」不在此处——它由 `agent/interviewAgent` 提供运行时，
// 状态由 App 层的 `useAgentInterview` 持有，两个入口（Agent 面试页 / Copilot 侧栏）共用同一份。

import type { LLMProvider, QuestionBank } from '../../types';
import type { AIConfig } from '../../schemas/ai-config';
import type { InterviewDefinition } from '../../schemas/interview';
import type { LearnerProfile } from '../../schemas/learner';
import type { EvaluationResult } from '../../schemas/evaluation';
import type { AnswerValue } from '../../types';
import type { InterviewSession, SessionQuestion } from '../../schemas/session';
import { buildSession, nextAdaptiveStep } from '../interviewEngine';
import { evaluateAnswer } from './evaluationCapability';
import type { AnswerSignal, Strategy } from '../../domain/adaptive';

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
