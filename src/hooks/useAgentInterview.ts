// Agent 面试会话状态机（从 AgentInterviewPage 抽出，提升到 App 层）。
// 与 useTrainingSession 同思路：把会话状态放在 App 顶层，切换 tab（如去设置页）时
// 组件卸载不丢失 session，回来即可继续。Agent 在后台继续运行，不被 dispose。
//
// 进行中面试的本地持久化（刷新/重开页面可续面）：
// - 每个回合边界（首轮结束 / 每次提交后 / 题目交付时）把 session + agent 对话历史(messages) +
//   已交付题(questions) 写入 Dexie 的 agentSessions 表；
// - 钩子挂载时若存在「进行中」草稿，则重建 Agent、整体写回 messages，从断点续面；
// - 面试结束或用户主动重开时删除草稿，避免残留。
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MessageInstance } from 'antd/es/message/interface';
import type { AnswerValue } from '../types';
import type { AIConfig, ProviderEntry } from '../schemas/ai-config';
import type { LearnerProfile, SessionRecord } from '../schemas/learner';
import type { SessionQuestion } from '../schemas/session';
import { emptyAnswer } from '../domain/quiz';
import { questionBank as bank } from '../data/questionBank';
import { isEntryValid, createLLMProvider } from '../ai/provider';
import {
  createAgentSession,
  sessionRecordFromAgent,
  averageOverall,
  countDelivered,
  type InterviewAgentSession,
} from '../agent/types';
import { createInterviewAgent } from '../agent/interviewAgent';
import type { InterviewAgentHandle } from '../agent/interviewAgent';
import { resolveOpeningInstruction } from '../agent/prompt';
import { devUsageLogger } from '../ai/usageTelemetry';
import {
  saveAgentSession,
  getActiveAgentSession,
  deleteAgentSession,
} from '../storage/agentSession';

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

/** 由 session.log 重建一份最小 transcript（仅工具调用），用于刷新后续面时保留连续性。 */
function rebuildTranscript(session: InterviewAgentSession): TranscriptItem[] {
  return session.log
    .filter((e) => e.kind === 'tool')
    .map((e) => ({
      kind: 'tool' as const,
      tool: e.tool ?? '',
      label: TOOL_LABELS[e.tool ?? ''] ?? (e.tool ?? '工具'),
      ok: true,
      detail: e.summary,
    }));
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
  // 续面用的快照/查找键：存入草稿、恢复时回读（避免持久化 apiKey / 保证弱项推荐一致）
  const profileRef = useRef<LearnerProfile>(profile);
  profileRef.current = profile;
  const entryIdRef = useRef<string | null>(null);
  const resumeStartedRef = useRef(false);
  /**
   * 续面是否已完成（无论是否真的找到草稿）。
   * `start()` 在此之前一律拒绝：resume 的 `await getActiveAgentSession()` 期间若用户点了开始，
   * resume 随后会用 `sessionRef/handleRef = ...` 覆盖刚创建的会话，导致新会话的 run / 看门狗 / 草稿全部泄漏。
   */
  const resumeDoneRef = useRef(false);
  /** `start()` 的重入锁（同步拦截，覆盖同 tick 内多次点击与 await 期间的再次进入）。 */
  const startingRef = useRef(false);
  // 终局幂等守卫：finishInterview / 兜底收尾 / endEarly 都可能触发 finalize，
  // 必须保证 onComplete（落库到 Learner Memory）只调用一次，禁止重复写入。
  const finalizedRef = useRef(false);

  const syncQuestions = useCallback((q: SessionQuestion) => {
    setQuestions((prev) => {
      if (prev.some((x) => x.question.id === q.question.id)) return prev;
      const next = [...prev, q];
      questionsRef.current = next;
      return next;
    });
  }, []);

  const finalize = useCallback(() => {
    if (finalizedRef.current) return; // 幂等：已收尾则直接返回，杜绝重复落库
    const session = sessionRef.current;
    if (!session) return;
    finalizedRef.current = true;
    handleRef.current?.abort();
    const asked = countDelivered(session);
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

  /**
   * 落库写入的串行队列：所有 saveAgentSession 都接到队尾依次执行。
   *
   * 背景：persistDraft 原先是 fire-and-forget（`void saveAgentSession(...)`），
   * IndexedDB 写入完成顺序不保证与调用顺序一致，快速连续落库时会出现
   * 「旧快照后完成、覆盖新快照」的回退。串行化后写入顺序恒等于调用顺序。
   */
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());

  /** 等待队列中未完成的落库写完后，再执行后续动作（如删除草稿）。 */
  const flushPersist = useCallback(async () => {
    try {
      await persistQueueRef.current;
    } catch {
      // 落库失败不应阻塞收尾流程（草稿只是可恢复快照，非权威数据）
    }
  }, []);

  /** 落库当前进行中面试（仅在回合边界调用，保证 session/messages 处于一致状态）。 */
  const persistDraft = useCallback(() => {
    const handle = handleRef.current;
    const session = sessionRef.current;
    const entryId = entryIdRef.current;
    if (!handle || !session || !entryId) return;
    if (session.status === 'finished') return; // 结束由 deleteAgentSession 处理
    // 快照在此同步取好（session/messages/questions 均为引用，入队后再读可能已变）。
    const snapshot = {
      id: session.id,
      session,
      messages: handle.agent.state.messages,
      questions: questionsRef.current,
      entryId,
      profile: profileRef.current,
      updatedAt: Date.now(),
    };
    // 接到队尾串行执行，保证「后调用的写入后落库」，避免旧快照覆盖新快照。
    persistQueueRef.current = persistQueueRef.current
      .then(() => saveAgentSession(snapshot))
      .catch(() => {
        // 落库失败不冒泡：草稿持久化是尽力而为，不能打断面试主流程
      });
    return persistQueueRef.current;
  }, []);

  /**
   * 创建（但不启动）一个面试 Agent 运行时，并接好全部 handlers。
   * 供 start（新开）与 resume（续面）复用；UI 状态初始化由调用方负责。
   */
  const buildHandle = useCallback(
    (session: InterviewAgentSession, usedProfile: LearnerProfile, entry: ProviderEntry): InterviewAgentHandle => {
      const handle = createInterviewAgent({
        session,
        profile: usedProfile,
        entry,
        bank: bank.questions.filter((q) => !(config.disabledCategories ?? []).includes(q.category)),
        provider: createLLMProvider(config, devUsageLogger),
        generateOpenQuestions: config.generateOpenQuestions,
        masteryThreshold: config.masteryThreshold,
        agentInstructions: config.prompts?.agentInstructions,
        onUsage: devUsageLogger,
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
            void persistDraft(); // 题目已交付 = 安全断点，立即落库
          },
          onStatus: (status) => {
            if (status === 'finished') {
              // 先等未完成的落库写完再删，否则在途写入会在删除之后把草稿重新写回
              void flushPersist().then(() => deleteAgentSession(session.id)); // 结束即清草稿，避免残留
              finalize();
            }
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
      return handle;
    },
    [config, finalize, syncQuestions, persistDraft, message],
  );

  const start = async () => {
    // 重入保护：同 tick 内多次点击、或 await 期间再次进入，都直接忽略。
    // 缺这条会创建多个 session/handle，而 getActiveAgentSession 只取最新一条草稿 ⇒ 其余全部泄漏。
    if (startingRef.current) return;
    // resume 的异步恢复尚未落地，此时开始会被 resume 的赋值覆盖 → 拒绝，等 resume 完成再点。
    if (!resumeDoneRef.current) return;
    startingRef.current = true;
    try {
      await startInner();
    } finally {
      startingRef.current = false;
    }
  };

  const startInner = async () => {
    setError(null);
    finalizedRef.current = false; // 新一轮面试：解除终局守卫
    const entry = config.providers?.find((p) => p.enabled && isEntryValid(p));
    const provider = createLLMProvider(config, devUsageLogger);
    if (!entry || !provider) {
      setError('未找到可用的 AI 引擎配置，请先在设置中配置。');
      return;
    }
    const session = createAgentSession();
    sessionRef.current = session;
    entryIdRef.current = entry.id;
    profileRef.current = profile;
    setQuestions([]);
    questionsRef.current = [];
    pendingTextRef.current = '';
    setTranscript([]);
    setCurrentQuestion(null);
    setAnswer([]);

    const handle = buildHandle(session, profile, entry);
    setPhase('running');
    try {
      await handle.start(resolveOpeningInstruction(config.prompts?.agentOpening));
      void persistDraft(); // 首轮结束落库
    } catch (err) {
      // 启动失败 ≠ 一个可以继续的 running 会话：必须清理并回到 intro。
      // 否则 phase 停在 'running'、currentQuestion 为 null、endEarly 又被「无可保存作答」挡回，
      // 用户会永久卡在「面试官正在选题…」，既无题也无出口。
      handleRef.current?.dispose(); // 中止 run + 清看门狗 + 取消订阅
      handleRef.current = null;
      sessionRef.current = null;
      questionsRef.current = [];
      setBusy(false);
      setError('面试启动失败：' + (err as Error).message);
      setPhase('intro');
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
      void persistDraft(); // 回合结束落库
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
    handleRef.current?.dispose(); // 真正中止进行中的 run + 清看门狗 + 取消订阅
    handleRef.current = null;
    const restartSessionId = sessionRef.current?.id;
    if (restartSessionId) void flushPersist().then(() => deleteAgentSession(restartSessionId));
    sessionRef.current = null;
    finalizedRef.current = false; // 解除终局守卫，允许下次面试收尾
    setPhase('intro');
    setCurrentQuestion(null);
    setAnswer([]);
    setQuestions([]);
    questionsRef.current = [];
    setTranscript([]);
    setSummary(null);
    setError(null);
  };

  // 挂载时尝试恢复进行中草稿：存在则重建 Agent 并整体写回 messages，从断点续面。
  useEffect(() => {
    if (resumeStartedRef.current) return;
    resumeStartedRef.current = true;
    void (async () => {
      try {
      const rec = await getActiveAgentSession();
      if (!rec) return;
      const entry = config.providers?.find((p) => p.id === rec.entryId && p.enabled && isEntryValid(p));
      if (!entry) {
        // 引擎已不可用，无法续面：清掉草稿，回到 intro 由用户重开
        void flushPersist().then(() => deleteAgentSession(rec.id));
        return;
      }
      const session = rec.session;
      sessionRef.current = session;
      entryIdRef.current = rec.entryId;
      profileRef.current = rec.profile;
      const handle = createInterviewAgent({
        session,
        profile: rec.profile,
        entry,
        bank: bank.questions.filter((q) => !(config.disabledCategories ?? []).includes(q.category)),
        provider: createLLMProvider(config, devUsageLogger),
        generateOpenQuestions: config.generateOpenQuestions,
        masteryThreshold: config.masteryThreshold,
        agentInstructions: config.prompts?.agentInstructions,
        onUsage: devUsageLogger,
        handlers: {
          onQuestion: (q) => {
            if (!q) {
              console.warn('[Agent] getQuestion 未交付题目（id 错误或 run 已结束）');
              return;
            }
            setCurrentQuestion(q);
            setAnswer(emptyAnswer(q));
            syncQuestions(q);
            void persistDraft();
          },
          onStatus: (status) => {
            if (status === 'finished') {
              void flushPersist().then(() => deleteAgentSession(session.id));
              finalize();
            }
          },
          onError: (msg, fatal) => {
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
      // 整体写回对话历史，LLM 从断点继续（messages 已在回合边界落库，结尾干净）
      handle.agent.state.messages = rec.messages as unknown as typeof handle.agent.state.messages;
      handleRef.current = handle;
      setQuestions(rec.questions as SessionQuestion[]);
      questionsRef.current = rec.questions as SessionQuestion[];
      setCurrentQuestion(session.currentQuestion);
      setAnswer(session.currentQuestion ? emptyAnswer(session.currentQuestion) : []);
      setTranscript(rebuildTranscript(session));
      setPhase('running');
      setBusy(false);
      } finally {
        // 无论是否找到草稿、是否成功续面，都必须放行 start()：
        // 否则一次 resume 异常会让用户永远无法开始新面试。
        resumeDoneRef.current = true;
      }
    })();
  // 仅挂载时尝试一次；resumeStartedRef 保证 StrictMode 双调用下不重复重建
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    // 「已考察 N 题」= 已交付题数（含评分失败记为 null 的题），与 MAX_AGENT_QUESTIONS 上限口径一致。
    evaluatedCount: sessionRef.current ? countDelivered(sessionRef.current) : 0,
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
