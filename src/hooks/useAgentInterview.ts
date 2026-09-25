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
import type { EvaluationResult } from '../schemas/evaluation';
import {
  DEFAULT_INTERVIEW_FEEDBACK_MODE,
  type InterviewFeedbackMode,
} from '../schemas/interview';
import { buildInterviewFeedback, type InterviewFeedback } from '../domain/interviewFeedback';
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
import { validAgentEntries } from '../agent/runtime';
import { resolveOpeningInstruction } from '../agent/prompt';
import { devUsageLogger, resetUsageTelemetry } from '../ai/usageTelemetry';
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

/** Agent 面试每题倒计时（秒）。时间到不自动跳题，而是弹窗让用户选择「延长本题」或「跳到下一题」。 */
export const AGENT_QUESTION_TIME_LIMIT_SEC = 180;

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
  /** 当前题剩余秒数；非 running 或尚未交付题为 null。 */
  questionTimeLeftSec: number | null;
  /** 本题倒计时已归零，等待用户在弹窗中选择「延长本题」或「跳到下一题」。 */
  questionTimeUp: boolean;
  /** 「延长本题时间」：本题重新开始计时。 */
  extendQuestionTime: () => void;
  /** 「跳到下一题」：放弃当前题并交付下一题（不计分）。 */
  jumpToNextQuestion: () => void;
  /**
   * 本题反馈（immediate 模式下评分后暂停时非 null；standard 模式恒为 null）。
   * 这是给用户看的**投影**；「是否停在反馈上」请读 `awaitingFeedback`（runtime 真源），
   * 不要用 `feedback !== null` 推断——那会把「有评分」误当成「已暂停」。
   */
  feedback: InterviewFeedback | null;
  /** 是否正停在本题反馈上等用户确认（= runtime 的 `status === 'awaiting_feedback'`）。 */
  awaitingFeedback: boolean;
  /** 当前会话的逐题反馈模式（进入面试前可切换；面试进行中不可变）。 */
  feedbackMode: InterviewFeedbackMode;
  /**
   * 最近一次评分的**原始结果**（与 `feedback` 同步写入）。
   * `feedback` 是给用户看的投影（分档/字母/关键知识点），会丢字段；
   * 「让 Copilot 详细解释」需要把结构化评分交给 Copilot，故额外保留原始对象。
   */
  lastEvaluation: EvaluationResult | null;
  /** 进入面试前切换逐题反馈模式。面试进行中调用无效（会话级契约不可中途变更）。 */
  setFeedbackMode: (mode: InterviewFeedbackMode) => void;
  /** 用户确认本题反馈 → 放行下一题（immediate 模式）。 */
  continueAfterFeedback: () => Promise<void>;
  /** 「继续」请求进行中（反馈卡上的按钮 loading）。 */
  continuing: boolean;
  setAnswer: (v: AnswerValue) => void;
  start: () => Promise<void>;
  /**
   * 提交作答。
   *
   * @param answerOverride 显式作答。Agent 面试页省略（用页面输入框的 `answer`）；
   *   Copilot 侧栏必须传——它的作答来自聊天框文本（`parseChatAnswer` 解析），
   *   并不在 hook 的 `answer` state 里。两者语义一致：都是「提交当前题的作答」。
   */
  submit: (answerOverride?: AnswerValue) => Promise<void>;
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

  // ── 逐题反馈（immediate 模式）──
  // feedbackMode 在「进入面试前」可选（intro 页），start 时固化为会话级配置：
  // 中途改变会让已交付题的反馈节奏前后不一致，故面试进行中 setter 为 no-op。
  const [feedbackMode, setFeedbackModeState] = useState<InterviewFeedbackMode>(DEFAULT_INTERVIEW_FEEDBACK_MODE);
  const [feedback, setFeedback] = useState<InterviewFeedback | null>(null);
  const [lastEvaluation, setLastEvaluation] = useState<EvaluationResult | null>(null);
  /**
   * 是否正停在本题反馈上（runtime 真源 = `session.status === 'awaiting_feedback'`）。
   *
   * 单独持有它、而不是让 UI 用 `feedback !== null` 推断：反馈卡是**投影**，暂停是**运行时状态**。
   * 两者一旦被当成同一件事，将来任何「有评分但不暂停」的场景（standard 模式、未来的
   * 「回看历史反馈」）都会把 UI 带进暂停态——这正是 standard 模式误显示反馈卡的成因。
   */
  const [awaitingFeedback, setAwaitingFeedback] = useState(false);
  /** 用户已点「继续」、正在请求下一题（按钮 loading）。 */
  const [continuing, setContinuing] = useState(false);

  /**
   * 清空本题反馈。投影（feedback）、原始评分（lastEvaluation）与暂停标记（awaitingFeedback）
   * 必须**成对**清空：三者一旦不同步，就会出现「卡片显示 A 题、Copilot 收到 B 题评分」
   * 或「已离开反馈态却仍显示反馈卡」这类静默错配。
   */
  const clearFeedback = useCallback(() => {
    setFeedback(null);
    setLastEvaluation(null);
    setAwaitingFeedback(false);
  }, []);

  /**
   * 切换逐题反馈模式。**仅允许在面试未运行时**：
   * 模式在 start 时被固化为会话级配置（`session.feedbackMode`），
   * 运行中改它会让 UI 选择与实际评分节奏不一致（用户以为切换了、实际没生效）。
   */
  const setFeedbackMode = useCallback(
    (mode: InterviewFeedbackMode) => {
      if (phase === 'running') return;
      setFeedbackModeState(mode);
    },
    [phase],
  );

  // ── 每题倒计时（计时器）──
  // 时间到不自动跳题：弹窗让用户选择「延长本题」或「跳到下一题」（见 AgentInterviewPage 的 Modal）。
  const [questionTimeLeftSec, setQuestionTimeLeftSec] = useState<number | null>(null);
  const [questionTimeUp, setQuestionTimeUp] = useState(false);
  const questionTimerIdRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const questionTimerRemainingRef = useRef(AGENT_QUESTION_TIME_LIMIT_SEC);
  const questionTimerFrozenRef = useRef(false);

  const handleRef = useRef<InterviewAgentHandle | null>(null);
  const sessionRef = useRef<InterviewAgentSession | null>(null);
  const questionsRef = useRef<SessionQuestion[]>([]);
  const pendingTextRef = useRef('');
  // 同步守卫：submitAnswer 是异步长任务，同一 tick 内的重复点击需即时拦截，避免触发"already processing"
  const submittingRef = useRef(false);
  // 「继续」的同步重入锁：与 submittingRef 同因——点击后到 Promise 落地之间存在窗口期，
  // 双击会触发两次 continueAfterFeedback（运行时虽幂等，但会重复落库并闪 loading）。
  const continuingRef = useRef(false);
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

  // 先同步写 ref，再触发 state 更新：React 的 setState updater 不保证在调用处立即执行，
  // 若把 ref 更新塞进 updater，后面紧跟的 persistDraft() 可能读到上一轮的旧 ref，
  // 导致「UI 显示 3 题、草稿只存 2 题」、续面缺最后一题、sessionRecord 丢最后一题评分（P0-2）。
  const syncQuestions = useCallback((q: SessionQuestion) => {
    if (questionsRef.current.some((x) => x.question.id === q.question.id)) return;
    const next = [...questionsRef.current, q];
    questionsRef.current = next;
    setQuestions(next);
  }, []);

  // ── 每题倒计时控制 ──
  const stopQuestionTimer = useCallback(() => {
    if (questionTimerIdRef.current) {
      clearInterval(questionTimerIdRef.current);
      questionTimerIdRef.current = null;
    }
  }, []);

  /** 一道新题交付时调用：重置并启动本题倒计时。 */
  const startQuestionTimer = useCallback(() => {
    stopQuestionTimer();
    questionTimerRemainingRef.current = AGENT_QUESTION_TIME_LIMIT_SEC;
    questionTimerFrozenRef.current = false;
    setQuestionTimeUp(false);
    setQuestionTimeLeftSec(AGENT_QUESTION_TIME_LIMIT_SEC);
    questionTimerIdRef.current = setInterval(() => {
      // busy / submitting 时冻结（面试官思考/评分期间不消耗作答时间）
      if (questionTimerFrozenRef.current) return;
      const v = Math.max(0, questionTimerRemainingRef.current - 1);
      questionTimerRemainingRef.current = v;
      setQuestionTimeLeftSec(v);
      if (v <= 0) {
        stopQuestionTimer();
        setQuestionTimeUp(true); // 触发 UI 弹窗，不自动跳题
      }
    }, 1000);
  }, [stopQuestionTimer]);

  /** 「延长本题时间」：本题重新开始计时（全额时长）。 */
  const extendQuestionTime = useCallback(() => {
    questionTimerRemainingRef.current = AGENT_QUESTION_TIME_LIMIT_SEC;
    questionTimerFrozenRef.current = false;
    setQuestionTimeUp(false);
    setQuestionTimeLeftSec(AGENT_QUESTION_TIME_LIMIT_SEC);
  }, []);

  /** 「跳到下一题」：放弃当前题（不计分）并交付下一题（Agent 的 skip）。 */
  const jumpToNextQuestion = useCallback(() => {
    setQuestionTimeUp(false);
    stopQuestionTimer();
    // 跳过会解除运行时的暂停态（见 interviewAgent.skip），UI 的反馈卡也必须同步关闭，
    // 否则会出现「已跳到下一题，却还显示上一题反馈」的错位。
    clearFeedback();
    void handleRef.current?.skip();
  }, [stopQuestionTimer, clearFeedback]);

  // 面试官思考/评分期间冻结倒计时，避免消耗作答时间
  useEffect(() => {
    questionTimerFrozenRef.current = busy || submitting;
  }, [busy, submitting]);

  const finalize = useCallback(() => {
    if (finalizedRef.current) return; // 幂等：已收尾则直接返回，杜绝重复落库
    stopQuestionTimer(); // 收尾：停掉进行中的倒计时，避免弹窗残留
    setQuestionTimeUp(false);
    setQuestionTimeLeftSec(null);
    clearFeedback(); // 收尾：反馈卡随之关闭（结果页承担总结职责）
    setContinuing(false);
    const session = sessionRef.current;
    if (!session) return;
    finalizedRef.current = true;
    session.status = 'finished'; // domain truth：持久化层据此判定草稿可删，修复「终局状态分裂」（P0-1）
    handleRef.current?.abort();
    const asked = countDelivered(session);
    // 终局：先等未完成的落库写完，再删草稿，避免删除之后在途写入把草稿重新写回（草稿复活）。
    void flushPersist().then(() => deleteAgentSession(session.id));
    if (asked === 0) {
      setPhase('done');
      setSummary({ asked: 0, overall: 0 });
      return;
    }
    const durationSec = Math.round((Date.now() - session.startedAt) / 1000);
    const record = sessionRecordFromAgent(session, questionsRef.current, 'Agent 面试', durationSec);
    // 没有任何有效评分（整场 LLM 评分都失败）：不写入 Learner Memory，
    // 避免把「未产生成绩」误解成一次 0 分训练（与 updateLearner 空结果守卫同义，此处显式拦截，P1-4）。
    if (record.questionResults.length === 0) {
      setSummary({ asked, overall: 0 });
      setPhase('done');
      return;
    }
    onComplete(record);
    setSummary({ asked, overall: averageOverall(session) });
    setPhase('done');
  }, [onComplete, clearFeedback]);

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
    // 终局后不再落库（无论 UI 是否已切到 done）：finalize 已置 finalizedRef 并负责删草稿，
    // 否则会在 deleteAgentSession 之后又把旧快照写回（草稿复活）。status 是 domain truth 冗余校验。
    if (finalizedRef.current || session.status === 'finished') return;
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
        fallbackEntries: validAgentEntries(config),
        bank: bank.questions.filter((q) => !(config.disabledCategories ?? []).includes(q.category)),
        provider: createLLMProvider(config, devUsageLogger),
        generateOpenQuestions: config.generateOpenQuestions,
        runtimeVariantEnabled: config.runtimeVariantEnabled,
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
            // 新题已交付 ⇒ 上一题的反馈阶段结束，关闭反馈卡（避免与下一题同屏并存）。
            clearFeedback();
            setCurrentQuestion(q);
            setAnswer(emptyAnswer(q));
            syncQuestions(q);
            startQuestionTimer(); // 新题交付：重置并启动本题倒计时
            void persistDraft(); // 题目已交付 = 安全断点，立即落库
          },
          onStatus: (status) => {
            if (status === 'finished') {
              finalize(); // 唯一终局出口：置 finished + 删草稿 + onComplete（finalize 内会清空反馈态）
              return;
            }
            if (status === 'awaiting_feedback') {
              // immediate 模式：本题已评分、停在反馈上等用户确认。
              // 停掉本题倒计时——题已答完，继续计时只会误导用户（且时间到会弹无意义的「延长/跳题」）。
              setAwaitingFeedback(true);
              stopQuestionTimer();
              setQuestionTimeUp(false);
              setQuestionTimeLeftSec(null);
              return;
            }
            // running：离开反馈态（本特性目前只在「继续」后回到 running）。
            setAwaitingFeedback(false);
          },
          onEvaluation: (q, answered, evaluation, awaitingFeedback) => {
            // 三条评分路径（选择题确定性 / 兜底 / LLM 工具）的统一出口回调。
            // 关键：**standard 模式也会走到这里**（评分总得发生），但只有 immediate 才该弹反馈卡。
            // 若在此无条件 setFeedback，standard 模式会在「评分完成 → 下一题交付」的窗口里
            // 显示反馈卡（开放题下这个窗口长达数秒），同时把题目置为只读、隐藏提交按钮。
            setLastEvaluation(evaluation); // 原始评分保留给「让 Copilot 详细解释」
            setAwaitingFeedback(awaitingFeedback);
            if (awaitingFeedback) {
              setFeedback(buildInterviewFeedback(q.question, q.format, answered, evaluation));
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
    [config, finalize, syncQuestions, persistDraft, message, startQuestionTimer, stopQuestionTimer, clearFeedback],
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
    stopQuestionTimer(); // 新一轮：清掉上一场可能残留的倒计时
    setQuestionTimeUp(false);
    setQuestionTimeLeftSec(null);
    clearFeedback();
    setContinuing(false);
    finalizedRef.current = false; // 新一轮面试：解除终局守卫
    resetUsageTelemetry(); // 重置 KV Cache 命中率累计（P1④）：每场面试从 Round 1 重新计数
    const entry = config.providers?.find((p) => p.enabled && isEntryValid(p));
    const provider = createLLMProvider(config, devUsageLogger);
    if (!entry || !provider) {
      setError('未找到可用的 AI 引擎配置，请先在设置中配置。');
      return;
    }
    const session = createAgentSession(feedbackMode);
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

  const submit = async (answerOverride?: AnswerValue) => {
    if (submittingRef.current) return; // 同步拦截：提交进行中不允许重复点击
    if (!currentQuestion) return;
    // 答案来源：Agent 面试页用页面输入框（`answer`），Copilot 侧栏用聊天框解析结果（override）。
    const actualAnswer = answerOverride ?? answer;
    if (!hasAnswer(actualAnswer)) {
      message.warning('请先作答再提交');
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setBusy(true); // 立即禁用按钮 + 显示遮罩，避免 LLM 响应前反复点击
    try {
      await handleRef.current?.submitAnswer(actualAnswer);
      void persistDraft(); // 回合结束落库
    } catch (err) {
      setError('提交失败：' + (err as Error).message);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
      setBusy(false);
    }
  };

  /**
   * 用户确认本题反馈 → 放行下一题（immediate 模式）。
   *
   * 反馈卡**不**在此处清空：清空交给 onQuestion（下一题已交付）或 finalize（收尾）。
   * 若在此清空，「继续」到下一题到达之间会先闪一个「无反馈且无新题」的空档。
   */
  const continueAfterFeedback = async () => {
    if (continuingRef.current) return; // 同步拦截：双击 / 重入
    continuingRef.current = true;
    setContinuing(true);
    setBusy(true); // 与提交一致：立即禁用交互并显示遮罩，避免请求期间重复点击
    try {
      await handleRef.current?.continueAfterFeedback();
      void persistDraft(); // 回合结束落库
    } catch (err) {
      setError('继续失败：' + (err as Error).message);
    } finally {
      continuingRef.current = false;
      setContinuing(false);
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
    stopQuestionTimer();
    setQuestionTimeUp(false);
    setQuestionTimeLeftSec(null);
    clearFeedback();
    setContinuing(false);
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
      // 会话真源在 session 上，React state 必须同步过来：
      // 否则 immediate 会话刷新后，state 仍是缺省的 'standard'，顶部「逐题反馈」标签消失、
      // 提交按钮文案退回「提交作答并继续」——UI 与实际评分节奏不符。
      setFeedbackModeState(session.feedbackMode);
      // 复用 buildHandle，而不是再写一份等价的 createInterviewAgent 配置：
      // 两份配置一旦漂移，续面路径就会缺失新加的 handler（如 onEvaluation / awaiting_feedback），
      // 表现为「刷新后逐题反馈消失」。这里由单一构造点保证两条路径行为恒等。
      const handle = buildHandle(session, rec.profile, entry);
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
      // 恢复暂停态：刷新时若正停在反馈卡上（status 已持久化为 awaiting_feedback），
      // 必须把反馈卡一并重建——否则当前题已评分、却没有下一题，用户会卡在一个「已答完」的空页面上。
      const pendingEvaluation =
        session.status === 'awaiting_feedback' && session.currentQuestion
          ? session.evaluations[session.currentQuestion.question.id] ?? null
          : null;
      if (pendingEvaluation && session.currentQuestion) {
        // 三者必须一起恢复。漏掉 lastEvaluation 会让反馈卡上的「让 Copilot 详细解释」消失
        // （它的可用条件是 lastEvaluation 非空）；漏掉 awaitingFeedback 会让页面把反馈卡
        // 当成「临时投影」，与 runtime 真源脱节。
        setLastEvaluation(pendingEvaluation);
        setAwaitingFeedback(true);
        setFeedback(
          buildInterviewFeedback(
            session.currentQuestion.question,
            session.currentQuestion.format,
            session.answers[session.currentQuestion.question.id] ?? '',
            pendingEvaluation,
          ),
        );
        stopQuestionTimer(); // 停在反馈上：题已答完，不再计时
        setQuestionTimeUp(false);
        setQuestionTimeLeftSec(null);
      } else if (session.currentQuestion) {
        startQuestionTimer(); // 续面已有当前题：立即启动倒计时
      }
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
  useEffect(
    () => () => {
      handleRef.current?.dispose();
      stopQuestionTimer();
    },
    [stopQuestionTimer],
  );

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
    questionTimeLeftSec,
    questionTimeUp,
    extendQuestionTime,
    jumpToNextQuestion,
    feedback,
    awaitingFeedback,
    feedbackMode,
    lastEvaluation,
    setFeedbackMode,
    continueAfterFeedback,
    continuing,
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
