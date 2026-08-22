import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layout, Typography, Button, Space, Spin, App as AntdApp, Progress, Tag } from 'antd';
import { SettingOutlined } from '@ant-design/icons';
import bankData from './data/questions.json';
import type {
  AnswerValue,
  EvaluationResult,
  InterviewDefinition,
  InterviewSession,
  Question,
  QuestionBank,
} from './types';
import { emptyAnswer } from './lib/quiz';
import { buildSession, evaluateSession } from './lib/interviewEngine';
import { isConfigValid } from './lib/piClient';
import type { PiConfig } from './lib/piClient';
import { loadConfig, saveConfig } from './lib/storage';
import SettingsModal from './components/SettingsModal';
import SetupPanel from './components/SetupPanel';
import QuestionCard from './components/QuestionCard';
import ResultPanel from './components/ResultPanel';

const bank = bankData as unknown as QuestionBank;

type Phase = 'setup' | 'quiz' | 'result';

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function App() {
  const { message } = AntdApp.useApp();
  const [config, setConfig] = useState<PiConfig>(() => loadConfig());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('setup');
  const [session, setSession] = useState<InterviewSession | null>(null);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [grades, setGrades] = useState<Record<string, EvaluationResult | null>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);

  // 用 ref 保存最新状态，供倒计时自动交卷读取，避免闭包过期
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const configRef = useRef(config);
  configRef.current = config;

  const questions = session?.questions ?? [];

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
      const s = await buildSession(bank, def, config);
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
    const openQs = s.questions.filter((q) => q.type === 'essay' || q.type === 'coding');
    if (openQs.length > 0 && isConfigValid(configRef.current)) {
      setBusy('正在用 LLM 评分开放题…');
      try {
        const g = await evaluateSession(s, answersRef.current, configRef.current);
        setGrades(g);
      } finally {
        setBusy(null);
      }
    } else {
      const g = await evaluateSession(s, answersRef.current, configRef.current);
      setGrades(g);
    }
    setPhase('result');
  }, []);

  const handleAnswerChange = (id: string, v: AnswerValue) => {
    setAnswers((prev) => ({ ...prev, [id]: v }));
  };

  const handleRestart = () => {
    setSession(null);
    setAnswers({});
    setGrades({});
    setRemaining(null);
    setPhase('setup');
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
        }}
      >
        <Typography.Title level={4} style={{ margin: 0 }}>
          🧠 AI 面试题训练器
        </Typography.Title>
        <Space>
          {remaining != null && (
            <Tag color={remaining <= 60 ? 'red' : 'blue'} style={{ fontSize: 14 }}>
              剩余 {fmt(remaining)}
            </Tag>
          )}
          <Button icon={<SettingOutlined />} onClick={() => setSettingsOpen(true)}>
            LLM 设置
          </Button>
        </Space>
      </Layout.Header>

      <Layout.Content style={{ padding: 24, maxWidth: 980, margin: '0 auto', width: '100%' }}>
        {phase === 'setup' && (
          <SetupPanel
            categories={bank.categories}
            config={config}
            onStart={handleStart}
            onOpenSettings={() => setSettingsOpen(true)}
          />
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
            onRestart={handleRestart}
          />
        )}
      </Layout.Content>

      <SettingsModal
        open={settingsOpen}
        config={config}
        onClose={() => setSettingsOpen(false)}
        onSave={handleSaveConfig}
      />

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
