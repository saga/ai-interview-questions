import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Layout, Typography, Button, Space, Spin, App as AntdApp, Progress, Tag, Menu, Alert } from 'antd';
import {
  SettingOutlined,
  ThunderboltOutlined,
  BarChartOutlined,
  CommentOutlined,
  RobotOutlined,
  CheckCircleFilled,
} from '@ant-design/icons';
import { questionBank as bank } from './data/questionBank';
import type {
  AnswerValue,
  EvaluationResult,
  InterviewDefinition,
  InterviewSession,
  LearnerProfile,
  AIConfig,
  SessionRecord,
} from './types';
import { emptyAnswer } from './domain/quiz';
import { buildSession, evaluateSession, evaluateAnswer, nextAdaptiveStep } from './application/interviewEngine';
import { collectTopicRefs } from './domain/learner';
import { computeCoverage, suggestNextTopics } from './domain/learner';
import type { AnswerSignal, Strategy } from './domain/adaptive';
import { isConfigValid } from './ai/provider';
import { loadConfig, saveConfig } from './storage/settings';
import { loadLearner, saveLearner } from './storage/learner';
import { buildCoachDefinition, sessionFromQuiz, updateLearner, emptyProfile } from './domain/learner';
import SettingsPanel from './components/settings/SettingsPanel';
import TrainingHome from './components/home/TrainingHome';
import ProgressPage from './components/progress/ProgressPage';
import InterviewPage from './components/interview/InterviewPage';
import AgentInterviewPage from './components/agent/AgentInterviewPage';
import QuestionCard from './components/quiz/QuestionCard';
import AdaptiveQuiz from './components/quiz/AdaptiveQuiz';
import ResultPanel from './components/result/ResultPanel';
import CopilotSidebar from './components/copilot/CopilotSidebar';

type Page = 'train' | 'progress' | 'interview' | 'settings' | 'agent';
type Phase = 'home' | 'quiz' | 'result';

const VALID_PAGES: Page[] = ['train', 'progress', 'interview', 'settings', 'agent'];
/** 由 URL pathname 派生当前页面；未知路径回退训练首页。 */
function pageFromPath(pathname: string): Page {
  const seg = pathname.split('/').filter(Boolean)[0] ?? '';
  return (VALID_PAGES as string[]).includes(seg) ? (seg as Page) : 'train';
}

/** 作答非空判定（选择题至少选一项，开放题至少有内容）。 */
function hasAnswerValue(v?: AnswerValue): boolean {
  if (v == null) return false;
  return typeof v === 'string' ? v.trim().length > 0 : v.length > 0;
}

const NAV_ITEMS = [
  { key: 'train', icon: <ThunderboltOutlined />, label: '训练' },
  { key: 'progress', icon: <BarChartOutlined />, label: '进度' },
  { key: 'interview', icon: <CommentOutlined />, label: '面试' },
  { key: 'agent', icon: <RobotOutlined />, label: 'Agent 面试' },
  { key: 'settings', icon: <SettingOutlined />, label: '设置' },
];

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * 把可能为 null 的 LearnerProfile 绑定为确定值（null 时回退空画像），
 * 通过 render-prop 注入子组件，避免 JSX 内联 IIFE 嵌套与重复兜底。
 */
function LearnerBound({
  profile,
  children,
}: {
  profile: LearnerProfile | null;
  children: (p: LearnerProfile) => ReactNode;
}) {
  return <>{children(profile ?? emptyProfile())}</>;
}

export default function App() {
  const { message } = AntdApp.useApp();
  const [config, setConfig] = useState<AIConfig>(() => loadConfig());
  // profile 初始为 null：Learner 画像现改为异步从 IndexedDB 加载（迁移见 storage/learner.ts）
  const [profile, setProfile] = useState<LearnerProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const location = useLocation();
  const navigate = useNavigate();
  const page = pageFromPath(location.pathname);
  const goPage = (p: Page) => navigate(p === 'train' ? '/train' : `/${p}`);
  const [phase, setPhase] = useState<Phase>('home');
  const [session, setSession] = useState<InterviewSession | null>(null);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [grades, setGrades] = useState<Record<string, EvaluationResult | null>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [prevOverall, setPrevOverall] = useState<number | null>(null);
  /** 自适应模式：每题的出题策略（与 questions 顺序对应） */
  const [strategies, setStrategies] = useState<(Strategy | undefined)[]>([]);
  const [copilotOpen, setCopilotOpen] = useState(false);

  // 用 ref 保存最新状态，供倒计时自动交卷 / 异步回调读取，避免闭包过期
  const answersRef = useRef(answers);
  answersRef.current = answers;
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
  const configReady = isConfigValid(config);

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
    const s = sessionRef.current;
    if (!s || !s.definition.adaptive) return;
    const idx = Object.keys(gradesRef.current).length;
    const sq = s.questions[idx];
    if (!sq || idx >= s.definition.count) return;

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
    }
  };

  /** 提前结束：当前题若尚未评分，先评一次再入账，避免未评分题以 0 分污染学习记录。 */
  const handleFinishEarly = async () => {
    const s = sessionRef.current;
    if (!s?.definition.adaptive) return doSubmit();
    const idx = Object.keys(gradesRef.current).length;
    const sq = s.questions[idx];
    if (!sq) return doSubmit();
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
    }
    doSubmit();
  };

  const doSubmit = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;
    const cfg = configRef.current;
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
  }, []);

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
    goPage('train');
  };

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

  // 根路径统一收敛到训练首页，确保地址栏总是反映当前页面
  if (location.pathname === '/' || location.pathname === '') {
    return <Navigate to="/train" replace />;
  }

  return (
    <Layout style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Layout.Header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: '#fff',
          borderBottom: '1px solid #f0f0f0',
          paddingInline: 24,
        }}
      >
        <Typography.Title level={4} style={{ margin: 0 }}>
          🧠 AI 面试训练器
        </Typography.Title>
        <Space>
          {remaining != null && (
            <Tag color={remaining <= 60 ? 'red' : 'blue'} style={{ fontSize: 14 }}>
              剩余 {fmt(remaining)}
            </Tag>
          )}
          {phase === 'home' && (
            <Button
              type={configReady ? 'text' : 'primary'}
              size="small"
              icon={configReady ? <CheckCircleFilled style={{ color: '#52c41a' }} /> : <SettingOutlined />}
              onClick={() => goPage('settings')}
            >
              {configReady ? 'AI ✓' : 'AI 未配置'}
            </Button>
          )}
          <Button
            type={copilotOpen ? 'primary' : 'default'}
            size="small"
            icon={<CommentOutlined />}
            onClick={() => setCopilotOpen((v) => !v)}
          >
            ✨ Copilot
          </Button>
        </Space>
      </Layout.Header>

      {phase === 'home' && (
        <Menu
          mode="horizontal"
          selectedKeys={[page]}
          items={NAV_ITEMS}
          onClick={(e) => goPage(e.key as Page)}
          style={{ justifyContent: 'center', borderBottom: '1px solid #f0f0f0' }}
        />
      )}

      <div style={{ display: 'flex', flex: 1, minHeight: 0, alignItems: 'stretch' }}>
        <Layout.Content
          style={{
            padding: 24,
            maxWidth: 980,
            margin: '0 auto',
            width: '100%',
            flex: 1,
            minWidth: 0,
            overflowY: 'auto',
          }}
        >
        {loadingProfile ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
            <Spin size="large" tip="正在加载学习记录…" />
          </div>
        ) : (
          <LearnerBound profile={profile}>
            {(displayedProfile) => (
              <>
                {phase === 'home' && page === 'train' && (
                  <TrainingHome
                    categories={bank.categories}
                    config={config}
                    profile={displayedProfile}
                    onStart={handleStart}
                    onGoSettings={() => goPage('settings')}
                  />
                )}

                {phase === 'home' && page === 'progress' && (
                  <ProgressPage
                    profile={displayedProfile}
                    onGoTrain={() => goPage('train')}
                    coverage={computeCoverage(collectTopicRefs(bank.questions), displayedProfile)}
                    suggestions={suggestNextTopics(collectTopicRefs(bank.questions), displayedProfile)}
                  />
                )}

                {phase === 'home' && page === 'interview' && (
                  <InterviewPage
                    config={config}
                    profile={displayedProfile}
                    onStart={handleStart}
                    onGoSettings={() => goPage('settings')}
                  />
                )}

                {phase === 'home' && page === 'settings' && (
                  <SettingsPanel
                    config={config}
                    onSave={handleSaveConfig}
                    onResetLearner={() => setProfile(emptyProfile())}
                  />
                )}

                {phase === 'home' && page === 'agent' && (
                  <AgentInterviewPage
                    config={config}
                    profile={displayedProfile}
                    onComplete={handleAgentComplete}
                    onGoSettings={() => goPage('settings')}
                    onGoProgress={() => goPage('progress')}
                  />
                )}

                {phase === 'quiz' && session?.definition.adaptive && questions[adaptiveCursor] && (
                  <div style={{ maxWidth: 820, margin: '0 auto' }}>
                    <AdaptiveQuiz
                      sq={questions[adaptiveCursor]}
                      index={adaptiveCursor}
                      total={session.definition.count}
                      value={
                        answers[questions[adaptiveCursor].question.id] ??
                        emptyAnswer(questions[adaptiveCursor])
                      }
                      strategy={strategies[adaptiveCursor]}
                      evaluating={busy != null}
                      hasAnswer={hasAnswerValue(answers[questions[adaptiveCursor].question.id])}
                      onChange={(v) => handleAnswerChange(questions[adaptiveCursor].question.id, v)}
                      onSubmitNext={() => void handleAdaptiveNext()}
                      onFinish={() => void handleFinishEarly()}
                    />
                  </div>
                )}

                {phase === 'quiz' && session?.definition.adaptive && !questions[adaptiveCursor] && (
                  <div style={{ maxWidth: 820, margin: '0 auto' }}>
                    <Alert
                      type="success"
                      showIcon
                      message={`已完成 ${questions.length} 道自适应题目`}
                      description="每题均已实时评分。点击下方按钮查看完整结果与薄弱项分析。"
                      action={
                        <Button type="primary" onClick={() => void doSubmit()}>
                          查看训练结果
                        </Button>
                      }
                    />
                  </div>
                )}

                {phase === 'quiz' && !(session?.definition.adaptive && questions[adaptiveCursor]) && !(session?.definition.adaptive && !questions[adaptiveCursor]) && (
                  <div>
                    <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }} wrap>
                      <Tag color="blue">共 {questions.length} 题</Tag>
                      <span>
                        已答 {answeredCount}/{questions.length}
                      </span>
                      <Progress
                        percent={Math.round((answeredCount / questions.length) * 100)}
                        size="small"
                        style={{ width: 160 }}
                      />
                      <Button onClick={handleRestart}>退出</Button>
                    </Space>
                    {questions.map((sq, i) => (
                      <QuestionCard
                        key={`${sq.question.id}-${i}`}
                        index={i}
                        question={sq.question}
                        format={sq.format}
                        value={answers[sq.question.id] ?? emptyAnswer(sq)}
                        onChange={(v) => handleAnswerChange(sq.question.id, v)}
                      />
                    ))}
                    <Button type="primary" size="large" block onClick={doSubmit}>
                      提交并查看结果
                    </Button>
                  </div>
                )}

                {phase === 'result' && (
                  <ResultPanel
                    questions={questions}
                    answers={answers}
                    grades={grades}
                    profile={displayedProfile}
                    prevOverall={prevOverall}
                    onContinue={handleContinue}
                    onRestart={handleRestart}
                  />
                )}
              </>
            )}
          </LearnerBound>
        )}
      </Layout.Content>
        <CopilotSidebar
          open={copilotOpen}
          onClose={() => setCopilotOpen(false)}
          config={config}
          profile={profile}
          session={session}
          currentQuestion={copilotQuestion}
        />
      </div>

      {busy && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(255,255,255,0.7)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            gap: 16,
          }}
        >
          <Spin size="large" />
          <Typography.Text>{busy}</Typography.Text>
        </div>
      )}
    </Layout>
  );
}
