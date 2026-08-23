import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layout, Typography, Button, Space, Spin, App as AntdApp, Progress, Tag, Menu } from 'antd';
import {
  SettingOutlined,
  ThunderboltOutlined,
  BarChartOutlined,
  CommentOutlined,
  CheckCircleFilled,
} from '@ant-design/icons';
import bankData from './data/questions.json';
import type {
  AnswerValue,
  EvaluationResult,
  InterviewDefinition,
  InterviewSession,
  LearnerProfile,
  PiConfig,
  Question,
  QuestionBank,
} from './types';
import { emptyAnswer } from './domain/quiz';
import { buildSession, evaluateSession } from './lib/interviewEngine';
import { isConfigValid } from './ai/provider';
import { loadConfig, saveConfig } from './storage/settings';
import { loadLearner, saveLearner } from './storage/learner';
import { buildCoachDefinition, sessionFromQuiz, updateLearner } from './domain/learner';
import SettingsPanel from './components/settings/SettingsPanel';
import TrainingHome from './components/home/TrainingHome';
import ProgressPage from './components/progress/ProgressPage';
import InterviewPage from './components/interview/InterviewPage';
import QuestionCard from './components/quiz/QuestionCard';
import ResultPanel from './components/result/ResultPanel';

const bank = bankData as unknown as QuestionBank;

type Page = 'train' | 'progress' | 'interview' | 'settings';
type Phase = 'home' | 'quiz' | 'result';

const NAV_ITEMS = [
  { key: 'train', icon: <ThunderboltOutlined />, label: '训练' },
  { key: 'progress', icon: <BarChartOutlined />, label: '进度' },
  { key: 'interview', icon: <CommentOutlined />, label: '面试' },
  { key: 'settings', icon: <SettingOutlined />, label: '设置' },
];

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function App() {
  const { message } = AntdApp.useApp();
  const [config, setConfig] = useState<PiConfig>(() => loadConfig());
  const [profile, setProfile] = useState<LearnerProfile>(() => loadLearner());
  const [page, setPage] = useState<Page>('train');
  const [phase, setPhase] = useState<Phase>('home');
  const [session, setSession] = useState<InterviewSession | null>(null);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [grades, setGrades] = useState<Record<string, EvaluationResult | null>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [prevOverall, setPrevOverall] = useState<number | null>(null);

  // 用 ref 保存最新状态，供倒计时自动交卷 / 异步回调读取，避免闭包过期
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const configRef = useRef(config);
  configRef.current = config;
  const profileRef = useRef(profile);
  profileRef.current = profile;

  const questions = session?.questions ?? [];
  const configReady = isConfigValid(config);

  const answeredCount = useMemo(() => {
    return questions.filter((q) => {
      const a = answers[q.id];
      if (q.type === 'essay' || q.type === 'coding') return Boolean(a && (a as string).trim());
      return Array.isArray(a) && a.length > 0;
    }).length;
  }, [questions, answers]);

  const handleSaveConfig = (c: PiConfig) => {
    setConfig(c);
    saveConfig(c);
    message.success('设置已保存');
  };

  const handleStart = async (def: InterviewDefinition) => {
    setBusy(def.useAI ? '正在用 LLM 生成变体题目…' : '正在组卷…');
    try {
      const s = await buildSession(bank, def, configRef.current);
      const init: Record<string, AnswerValue> = {};
      s.questions.forEach((q) => {
        init[q.id] = emptyAnswer(q);
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

  const doSubmit = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;
    const cfg = configRef.current;
    const g = await evaluateSession(s, answersRef.current, cfg);
    setGrades(g);
    // 先算时长再入库（duration 在记录时即确定）
    durationRef.current = Math.round((Date.now() - startedAtRef.current) / 1000);
    const prev = profileRef.current.sessions[0]?.overall ?? null;
    const rec = sessionFromQuiz(s, g, durationRef.current);
    const next = updateLearner(profileRef.current, rec);
    saveLearner(next);
    setProfile(next);
    setPrevOverall(prev);
    setPhase('result');
  }, []);

  const durationRef = useRef<number | undefined>(undefined);
  const startedAtRef = useRef(0);
  // 进入作答阶段时记录起始时间
  useEffect(() => {
    if (phase === 'quiz' && session) {
      startedAtRef.current = Date.now();
    }
  }, [phase, session]);

  const handleAnswerChange = (id: string, v: AnswerValue) => {
    setAnswers((prev) => ({ ...prev, [id]: v }));
  };

  const handleContinue = () => {
    const def = buildCoachDefinition(profileRef.current, { title: '继续训练' });
    void handleStart(def);
  };

  const handleRestart = () => {
    setSession(null);
    setAnswers({});
    setGrades({});
    setRemaining(null);
    setPrevOverall(null);
    setPhase('home');
    setPage('train');
  };

  // 倒计时：仅在有 timeLimitSec 且处于 quiz 阶段时运行
  useEffect(() => {
    if (phase !== 'quiz' || !session?.definition.timeLimitSec) {
      setRemaining(null);
      return;
    }
    const limit = session.definition.timeLimitSec;
    const start = Date.now();
    setRemaining(limit);
    const id = setInterval(() => {
      const left = Math.max(0, Math.round((limit - (Date.now() - start)) / 1000));
      setRemaining(left);
      if (left <= 0) {
        clearInterval(id);
        message.warning('时间到，自动交卷');
        void doSubmit();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [phase, session, doSubmit, message]);

  return (
    <Layout style={{ minHeight: '100vh' }}>
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
              onClick={() => setPage('settings')}
            >
              {configReady ? 'AI ✓' : 'AI 未配置'}
            </Button>
          )}
        </Space>
      </Layout.Header>

      {phase === 'home' && (
        <Menu
          mode="horizontal"
          selectedKeys={[page]}
          items={NAV_ITEMS}
          onClick={(e) => setPage(e.key as Page)}
          style={{ justifyContent: 'center', borderBottom: '1px solid #f0f0f0' }}
        />
      )}

      <Layout.Content style={{ padding: 24, maxWidth: 980, margin: '0 auto', width: '100%' }}>
        {phase === 'home' && page === 'train' && (
          <TrainingHome
            categories={bank.categories}
            config={config}
            profile={profile}
            onStart={handleStart}
            onGoSettings={() => setPage('settings')}
          />
        )}

        {phase === 'home' && page === 'progress' && (
          <ProgressPage profile={profile} onGoTrain={() => setPage('train')} />
        )}

        {phase === 'home' && page === 'interview' && (
          <InterviewPage
            config={config}
            profile={profile}
            onStart={handleStart}
            onGoSettings={() => setPage('settings')}
          />
        )}

        {phase === 'home' && page === 'settings' && (
          <SettingsPanel config={config} onSave={handleSaveConfig} />
        )}

        {phase === 'quiz' && (
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
            {questions.map((q: Question, i) => (
              <QuestionCard
                key={q.id}
                index={i}
                question={q}
                value={answers[q.id] ?? emptyAnswer(q)}
                onChange={(v) => handleAnswerChange(q.id, v)}
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
            profile={profile}
            prevOverall={prevOverall}
            onContinue={handleContinue}
            onRestart={handleRestart}
          />
        )}
      </Layout.Content>

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
