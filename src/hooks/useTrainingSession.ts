// 训练会话状态机：组卷 → 作答 → （自适应）逐题评分选下一题 → 提交 → 落库 Learner 画像。
// 从 App.tsx 抽出，让 App.tsx 只保留路由/布局/导航，状态与业务时序收拢在这里，便于单独推理与测试。
// 仍然是"UI 状态 + 副作用"（useState/useRef/useEffect），不下沉到 domain/application（那里要求纯函数、无 React 依赖）。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MessageInstance } from 'antd/es/message/interface';
import { questionBank as bank } from '../data/questionBank';
import type { AnswerValue } from '../types';
import type { EvaluationResult } from '../schemas/evaluation';
import type { InterviewDefinition } from '../schemas/interview';
import type { InterviewSession, SessionQuestion } from '../schemas/session';
import type { LearnerProfile } from '../schemas/learner';
import type { AIConfig } from '../schemas/ai-config';
import type { SessionRecord } from '../schemas/learner';
import type { Question } from '../schemas/question';
import { emptyAnswer } from '../domain/quiz';
import { buildSession, evaluateSession, evaluateAnswer, nextAdaptiveStep } from '../application/interviewEngine';
import type { AnswerSignal, Strategy } from '../domain/adaptive';
import { isConfigValid } from '../ai/provider';
import { loadConfig, saveConfig } from '../storage/settings';
import { loadLearner, saveLearner } from '../storage/learner';
import { buildCoachDefinition, sessionFromQuiz, updateLearner, emptyProfile } from '../domain/learner';

export type Phase = 'home' | 'quiz' | 'result';
type MessageApi = MessageInstance;

/** 作答非空判定（选择题至少选一项，开放题至少有内容）。 */
export function hasAnswerValue(v?: AnswerValue): boolean {
  if (v == null) return false;
  return typeof v === 'string' ? v.trim().length > 0 : v.length > 0;
}

export function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export interface TrainingSession {
  config: AIConfig;
  profile: LearnerProfile | null;
  loadingProfile: boolean;
  phase: Phase;
  session: InterviewSession | null;
  answers: Record<string, AnswerValue>;
  grades: Record<string, EvaluationResult | null>;
  busy: string | null;
  remaining: number | null;
  prevOverall: number | null;
  strategies: (Strategy | undefined)[];
  questions: SessionQuestion[];
  configReady: boolean;
  answeredCount: number;
  adaptiveCursor: number;
  copilotQuestion: Question | null;
  resetLearnerProfile: () => void;
  handleSaveConfig: (c: AIConfig) => void;
  handleStart: (def: InterviewDefinition) => Promise<void>;
  handleAdaptiveNext: () => Promise<void>;
  handleFinishEarly: () => Promise<void>;
  doSubmit: () => Promise<void>;
  handleAnswerChange: (id: string, v: AnswerValue) => void;
  handleContinue: () => void;
  handleAgentComplete: (record: SessionRecord) => Promise<void>;
  handleRestart: () => void;
}

/**
 * 封装整套训练会话状态与时序。`message` 用于操作反馈（组卷失败/超时自动交卷等），
 * `onRestart` 在退出/重新开始时触发（由调用方决定导航回哪个页面）。
 */
export function useTrainingSession(message: MessageApi, onRestart: () => void): TrainingSession {
  const [config, setConfig] = useState<AIConfig>(() => loadConfig());
  // profile 初始为 null：Learner 画像现改为异步从 IndexedDB 加载（迁移见 storage/learner.ts）
  const [profile, setProfile] = useState<LearnerProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [phase, setPhase] = useState<Phase>('home');
  const [session, setSession] = useState<InterviewSession | null>(null);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [grades, setGrades] = useState<Record<string, EvaluationResult | null>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [prevOverall, setPrevOverall] = useState<number | null>(null);
  /** 自适应模式：每题的出题策略（与 questions 顺序对应） */
  const [strategies, setStrategies] = useState<(Strategy | undefined)[]>([]);

  // 用 ref 保存最新状态，供倒计时自动交卷 / 异步回调读取，避免闭包过期
  const answersRef = useRef(answers);
  answersRef.current = answers;
  // 同步动作锁：防止异步提交/组卷/评分在响应前被重复点击触发（与 Agent 面试防重入同思路）
  const actionLock = useRef(false);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const configRef = useRef(config);
  configRef.current = config;
  const profileRef = useRef<LearnerProfile>(profile ?? emptyProfile());
  profileRef.current = profile ?? emptyProfile();
  const gradesRef = useRef(grades);
  gradesRef.current = grades;
  /** 自适应模式：按顺序累积的作答信号，供下一题决策使用 */
  const signalsRef = useRef<AnswerSignal[]>([]);

  const questions = session?.questions ?? [];

  const answeredCount = useMemo(
    () => questions.filter((sq) => hasAnswerValue(answers[sq.question.id])).length,
    [questions, answers],
  );

  const handleSaveConfig = (c: AIConfig) => {
    setConfig(c);
    saveConfig(c);
    message.success('设置已保存');
  };

  const handleStart = async (def: InterviewDefinition) => {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(def.useAI ? '正在用 LLM 生成变体题目…' : '正在组卷…');
    signalsRef.current = [];
    setStrategies([]);
    try {
      const s = await buildSession(bank, def, configRef.current);
      const init: Record<string, AnswerValue> = {};
      s.questions.forEach((sq) => {
        init[sq.question.id] = emptyAnswer(sq);
      });
      setSession(s);
      setAnswers(init);
      setGrades({});
      setPhase('quiz');
      if (s.definition.timeLimitSec) message.info(`倒计时已开启：${fmt(s.definition.timeLimitSec)}`);
    } catch (e) {
      message.error('组卷失败：' + (e as Error).message);
    } finally {
      setBusy(null);
      actionLock.current = false;
    }
  };

  /** 自适应模式：当前已评分题数 = 游标（题目按顺序追加、按顺序作答）。 */
  const adaptiveCursor = session?.definition.adaptive ? Object.keys(grades).length : 0;
  const copilotQuestion =
    phase === 'quiz' && questions.length
      ? session?.definition.adaptive
        ? (questions[adaptiveCursor]?.question ?? questions[0]?.question ?? null)
        : (questions[0]?.question ?? null)
      : null;

  /**
   * 自适应模式的核心循环：评分当前题 → 记录作答信号 →
   * 由概念图迁移策略（deep-dive / gap-probe / broaden / move-on）选出下一题。
   */
  const handleAdaptiveNext = async () => {
    if (actionLock.current) return;
    const s = sessionRef.current;
    if (!s || !s.definition.adaptive) return;
    const idx = Object.keys(gradesRef.current).length;
    const sq = s.questions[idx];
    if (!sq || idx >= s.definition.count) return;

    actionLock.current = true;
    setBusy('正在评分…');
    try {
      const g = await evaluateAnswer(sq, answersRef.current[sq.question.id], s.definition, configRef.current);
      const nextGrades = { ...gradesRef.current, [sq.question.id]: g };
      gradesRef.current = nextGrades;
      setGrades(nextGrades);
      signalsRef.current = [
        ...signalsRef.current,
        { topic: sq.question.topic, score: g?.overall ?? 0, difficulty: sq.question.difficulty },
      ];

      if (s.questions.length < s.definition.count) {
        setBusy('正在根据你的表现选择下一题…');
        const step = await nextAdaptiveStep(bank, s, signalsRef.current, profileRef.current, configRef.current);
        if (step) {
          setSession({ ...s, questions: [...s.questions, step.question] });
          setStrategies((prev) => [...prev, step.strategy]);
          setAnswers((prev) => ({ ...prev, [step.question.question.id]: emptyAnswer(step.question) }));
        }
      }
    } finally {
      setBusy(null);
      actionLock.current = false;
    }
  };

  const doSubmit = useCallback(async () => {
    if (actionLock.current) return;
    const s = sessionRef.current;
    if (!s) return;
    actionLock.current = true;
    setBusy('正在评分并提交…');
    const cfg = configRef.current;
    try {
      // 自适应模式逐题评过（含提前结束时的当前题），无需再批量评估
      const g = s.definition.adaptive ? gradesRef.current : await evaluateSession(s, answersRef.current, cfg);
      setGrades(g);
      // 时长从会话创建（startedAt）起算——自适应模式下追加题目不会改变 startedAt
      const durationSec = Math.round((Date.now() - s.startedAt) / 1000);
      const prev = profileRef.current.sessions[0]?.overall ?? null;
      const rec = sessionFromQuiz(s, g, durationSec, answersRef.current);
      const next = updateLearner(profileRef.current, rec);
      await saveLearner(next);
      setProfile(next);
      setPrevOverall(prev);
      setPhase('result');
    } finally {
      setBusy(null);
      actionLock.current = false;
    }
  }, []);

  /** 提前结束：当前题若尚未评分，先评一次再入账，避免未评分题以 0 分污染学习记录。 */
  const handleFinishEarly = async () => {
    if (actionLock.current) return;
    const s = sessionRef.current;
    if (!s?.definition.adaptive) return doSubmit();
    const idx = Object.keys(gradesRef.current).length;
    const sq = s.questions[idx];
    if (!sq) return doSubmit();
    actionLock.current = true;
    setBusy('正在评分…');
    try {
      const g = await evaluateAnswer(sq, answersRef.current[sq.question.id], s.definition, configRef.current);
      const nextGrades = { ...gradesRef.current, [sq.question.id]: g };
      gradesRef.current = nextGrades;
      setGrades(nextGrades);
      signalsRef.current = [
        ...signalsRef.current,
        { topic: sq.question.topic, score: g?.overall ?? 0, difficulty: sq.question.difficulty },
      ];
    } finally {
      setBusy(null);
      actionLock.current = false;
    }
    void doSubmit();
  };

  const handleAnswerChange = (id: string, v: AnswerValue) => {
    setAnswers((prev) => ({ ...prev, [id]: v }));
  };

  const handleContinue = () => {
    const def = buildCoachDefinition(profileRef.current, { title: '继续训练' });
    void handleStart(def);
  };

  /** Agent 面试结束后的落库：复用既有 Learner 管线，与确定性 engine 写入同一份画像。 */
  const handleAgentComplete = async (record: SessionRecord) => {
    const prev = profileRef.current.sessions[0]?.overall ?? null;
    const next = updateLearner(profileRef.current, record);
    await saveLearner(next);
    setProfile(next);
    setPrevOverall(prev);
  };

  const handleRestart = () => {
    setSession(null);
    setAnswers({});
    setGrades({});
    setRemaining(null);
    setPrevOverall(null);
    setStrategies([]);
    signalsRef.current = [];
    setPhase('home');
    onRestart();
  };

  const resetLearnerProfile = () => setProfile(emptyProfile());

  // 启动：异步加载 Learner 画像（IndexedDB），加载完成后解除加载态。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await loadLearner();
        if (!cancelled) setProfile(p);
      } catch {
        if (!cancelled) setProfile(emptyProfile());
      } finally {
        if (!cancelled) setLoadingProfile(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 倒计时：截止点锚定在会话创建时间（session.startedAt）。
  // 自适应模式追加题目会生成新的 session 对象，但 startedAt 不变——
  // 因此依赖它而非 session 本身，避免每次换题把剩余时间重置回满额。
  const timeLimitSec = session?.definition.timeLimitSec;
  const sessionStartedAt = session?.startedAt;
  useEffect(() => {
    if (phase !== 'quiz' || !timeLimitSec || !sessionStartedAt) {
      setRemaining(null);
      return;
    }
    const deadline = sessionStartedAt + timeLimitSec * 1000;
    const tick = () => Math.max(0, Math.round((deadline - Date.now()) / 1000));
    setRemaining(tick());
    const id = setInterval(() => {
      const left = tick();
      setRemaining(left);
      if (left <= 0) {
        clearInterval(id);
        message.warning('时间到，自动交卷');
        void doSubmit();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [phase, timeLimitSec, sessionStartedAt, doSubmit, message]);

  return {
    config,
    profile,
    loadingProfile,
    phase,
    session,
    answers,
    grades,
    busy,
    remaining,
    prevOverall,
    strategies,
    questions,
    configReady: isConfigValid(config),
    answeredCount,
    adaptiveCursor,
    copilotQuestion,
    resetLearnerProfile,
    handleSaveConfig,
    handleStart,
    handleAdaptiveNext,
    handleFinishEarly,
    doSubmit,
    handleAnswerChange,
    handleContinue,
    handleAgentComplete,
    handleRestart,
  };
}
