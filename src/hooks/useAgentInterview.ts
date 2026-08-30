// Agent 面试会话状态机（从 AgentInterviewPage 抽出，提升到 App 层）。
// 与 useTrainingSession 同思路：把会话状态放在 App 顶层，切换 tab（如去设置页）时
// 组件卸载不丢失 session，回来即可继续。Agent 在后台继续运行，不被 dispose。
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MessageInstance } from 'antd/es/message/interface';
import type { AnswerValue } from '../types';
import type { AIConfig } from '../schemas/ai-config';
import type { LearnerProfile, SessionRecord } from '../schemas/learner';
import type { SessionQuestion } from '../schemas/session';
import { emptyAnswer } from '../domain/quiz';
import { questionBank as bank } from '../data/questionBank';
import { isEntryValid, createLLMProvider } from '../ai/provider';
import {
  createAgentSession,
  sessionRecordFromAgent,
  averageOverall,
  type InterviewAgentSession,
} from '../agent/types';
import { createInterviewAgent } from '../agent/interviewAgent';
import type { InterviewAgentHandle } from '../agent/interviewAgent';

export type AgentPhase = 'intro' | 'running' | 'done';

/** 一条 transcript 原始记录（未经折叠）。 */
export type TranscriptItem =
  | { kind: 'agent'; text: string }
  | { kind: 'tool'; tool: string; label: string; ok: boolean; detail?: string };

const TOOL_LABELS: Record<string, string> = {
  searchQuestions: '搜索题目',
  getQuestion: '选定题目',
  evaluateAnswer: '评估作答',
  getUserWeaknesses: '读取薄弱主题',
  finishInterview: '结束面试',
};

const OPENING_INSTRUCTION = `你是一位资深 AI 技术面试官，主持一次约 6–10 题的模拟面试。流程：
1) 先调用 getUserWeaknesses 了解我的薄弱主题；
2) 用 searchQuestions 在相关主题找候选题，再用 getQuestion 选定一道题呈现给我；
3) 等我作答后，调用 evaluateAnswer 评分；
4) 根据评分决定下一步：答得好就换方向或提高难度，答不好就追问或回退前置知识；当充分考察或达到约 8 题时调用 finishInterview 结束。
注意：你不要自己打分，评分必须走 evaluateAnswer 工具；每次只呈现一道题，等我作答。`;

/** 从一条 assistant message 中抽取纯文本（忽略 toolCall 等内容块）。 */
function messageText(msg: unknown): string {
  const m = msg as { content?: Array<{ type: string; text?: string }> } | undefined;
  if (!m?.content) return '';
  return m.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
}

/** 为工具调用结果生成一行简短可读摘要（用于 transcript）。 */
function toolDetail(event: { result?: { details?: unknown } }): string | undefined {
  const d = event.result?.details;
  if (!d || typeof d !== 'object') return undefined;
  const o = d as Record<string, unknown>;
  if (typeof o.overall === 'number') return `综合 ${o.overall} 分`;
  if (typeof o.questionsAsked === 'number') return `已评 ${o.questionsAsked} 题`;
  if (typeof o.count === 'number') return `${o.count} 道候选`;
  if (Array.isArray(o.weakTopics)) return `薄弱：${(o.weakTopics as string[]).join('、') || '（暂无）'}`;
  return undefined;
}

export interface AgentInterviewState {
  phase: AgentPhase;
  currentQuestion: SessionQuestion | null;
  answer: AnswerValue;
  questions: SessionQuestion[];
  transcript: TranscriptItem[];
  busy: boolean;
  submitting: boolean;
  summary: { asked: number; overall: number } | null;
  error: string | null;
  /** 已被 Agent 评分的题目数（来自 session.evaluations，渲染时读取，随 transcript 更新）。 */
  evaluatedCount: number;
  setAnswer: (v: AnswerValue) => void;
  start: () => Promise<void>;
  submit: () => Promise<void>;
  endEarly: () => void;
  restart: () => void;
}

/**
 * Agent 面试会话状态与全部时序逻辑。state 存在于调用方（App），故切换 tab 不丢失。
 * message 由调用方透传（App 已持有 antd message 实例），避免重复订阅。
 */
export function useAgentInterview(
  config: AIConfig,
  profile: LearnerProfile,
  onComplete: (record: SessionRecord) => void,
  message: MessageInstance,
): AgentInterviewState {
  const [phase, setPhase] = useState<AgentPhase>('intro');
  const [currentQuestion, setCurrentQuestion] = useState<SessionQuestion | null>(null);
  const [answer, setAnswer] = useState<AnswerValue>([]);
  const [questions, setQuestions] = useState<SessionQuestion[]>([]);
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [summary, setSummary] = useState<{ asked: number; overall: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRef = useRef<InterviewAgentHandle | null>(null);
  const sessionRef = useRef<InterviewAgentSession | null>(null);
  const questionsRef = useRef<SessionQuestion[]>([]);
  const pendingTextRef = useRef('');
  // 同步守卫：submitAnswer 是异步长任务，同一 tick 内的重复点击需即时拦截，避免触发"already processing"
  const submittingRef = useRef(false);

  const syncQuestions = useCallback((q: SessionQuestion) => {
    setQuestions((prev) => {
      if (prev.some((x) => x.question.id === q.question.id)) return prev;
      const next = [...prev, q];
      questionsRef.current = next;
      return next;
    });
  }, []);

  const finalize = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    handleRef.current?.abort();
    const asked = Object.keys(session.evaluations).length;
    if (asked === 0) {
      setPhase('done');
      setSummary({ asked: 0, overall: 0 });
      return;
    }
    const durationSec = Math.round((Date.now() - session.startedAt) / 1000);
    const record = sessionRecordFromAgent(session, questionsRef.current, 'Agent 面试', durationSec);
    onComplete(record);
    setSummary({ asked, overall: averageOverall(session) });
    setPhase('done');
  }, [onComplete]);

  const start = async () => {
    setError(null);
    const entry = config.providers?.find((p) => p.enabled && isEntryValid(p));
    const provider = createLLMProvider(config);
    if (!entry || !provider) {
      setError('未找到可用的 AI 引擎配置，请先在设置中配置。');
      return;
    }
    const session = createAgentSession();
    sessionRef.current = session;
    setQuestions([]);
    questionsRef.current = [];
    pendingTextRef.current = '';
    setTranscript([]);
    setCurrentQuestion(null);
    setAnswer([]);

    const handle = createInterviewAgent({
      session,
      profile,
      entry,
      bank: bank.questions.filter((question) => !(config.disabledCategories ?? []).includes(question.category)),
      provider,
      generateOpenQuestions: config.generateOpenQuestions,
      masteryThreshold: config.masteryThreshold,
      systemPrompt: config.prompts?.agentSystem,
      handlers: {
        onQuestion: (q) => {
          if (!q) {
            // 修复 F：getQuestion 未交付题（id 错/已结束）不应静默吞掉，至少留痕便于排查
            console.warn('[Agent] getQuestion 未交付题目（id 错误或 run 已结束）');
            return;
          }
          setCurrentQuestion(q);
          setAnswer(emptyAnswer(q));
          syncQuestions(q);
        },
        onStatus: (status) => {
          if (status === 'finished') finalize();
        },
        onError: (msg, fatal) => {
          // 修复 B：流式错误/自愈提示——致命则阻塞报错，可恢复则轻量告警（兜底已接续出题）
          if (fatal) setError(msg);
          else message.warning(msg);
        },
        onEvent: (event: unknown) => {
          const e = event as { type: string; message?: unknown; toolName?: string; isError?: boolean; result?: { details?: unknown } };
          switch (e.type) {
            case 'agent_start':
              setBusy(true);
              break;
            case 'turn_end':
            case 'agent_end': {
              setBusy(false);
              const text = pendingTextRef.current;
              pendingTextRef.current = '';
              if (text.trim()) setTranscript((prev) => [...prev, { kind: 'agent', text }]);
              break;
            }
            case 'message_update':
              pendingTextRef.current = messageText(e.message);
              break;
            case 'tool_execution_end': {
              const label = TOOL_LABELS[e.toolName ?? ''] ?? (e.toolName ?? '工具');
              const detail = toolDetail(e);
              // 没有薄弱主题时，这条调用只返回固定占位文本，不提供新的决策信息。
              if (e.toolName === 'getUserWeaknesses' && detail === '薄弱：（暂无）' && !e.isError) return;
              setTranscript((prev) => [
                ...prev,
                { kind: 'tool', tool: e.toolName ?? '', label, ok: !e.isError, detail },
              ]);
              break;
            }
            default:
              break;
          }
        },
      },
    });
    handleRef.current = handle;
    setPhase('running');
    try {
      await handle.start(OPENING_INSTRUCTION);
    } catch (err) {
      setBusy(false);
      setError('面试启动失败：' + (err as Error).message);
    }
  };

  const submit = async () => {
    if (submittingRef.current) return; // 同步拦截：提交进行中不允许重复点击
    if (!currentQuestion) return;
    if (!hasAnswer(answer)) {
      message.warning('请先作答再提交');
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setBusy(true); // 立即禁用按钮 + 显示遮罩，避免 LLM 响应前反复点击
    try {
      await handleRef.current?.submitAnswer(answer);
    } catch (err) {
      setError('提交失败：' + (err as Error).message);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
      setBusy(false);
    }
  };

  const endEarly = () => {
    if (Object.keys(sessionRef.current?.evaluations ?? {}).length === 0) {
      message.info('还没有可保存的作答');
      return;
    }
    finalize();
  };

  const restart = () => {
    handleRef.current?.dispose();
    handleRef.current = null;
    sessionRef.current = null;
    setPhase('intro');
    setCurrentQuestion(null);
    setAnswer([]);
    setQuestions([]);
    questionsRef.current = [];
    setTranscript([]);
    setSummary(null);
    setError(null);
  };

  // 仅在整个 App 卸载时清理 Agent 运行；切换 tab（AgentInterviewPage 卸载）不触发，
  // 以保留进行中的会话。restart 由用户主动调用，会显式 dispose。
  useEffect(() => () => handleRef.current?.dispose(), []);

  return {
    phase,
    currentQuestion,
    answer,
    questions,
    transcript,
    busy,
    submitting,
    summary,
    error,
    evaluatedCount: Object.keys(sessionRef.current?.evaluations ?? {}).length,
    setAnswer,
    start,
    submit,
    endEarly,
    restart,
  };
}

function hasAnswer(v?: AnswerValue): boolean {
  if (v == null) return false;
  return typeof v === 'string' ? v.trim().length > 0 : v.length > 0;
}
