import { useMemo, useState } from 'react';
import { Layout, Typography, Button, Space, Spin, App as AntdApp, Progress, Tag } from 'antd';
import { SettingOutlined } from '@ant-design/icons';
import bankData from './data/questions.json';
import type { AnswerValue, EssayGrade, EssayQuestion, Question, QuestionBank } from './types';
import { emptyAnswer, pickQuestions } from './lib/quiz';
import { gradeEssay, isConfigValid, transformQuestion } from './lib/piClient';
import type { PiConfig } from './lib/piClient';
import { loadConfig, saveConfig } from './lib/storage';
import SettingsModal from './components/SettingsModal';
import SetupPanel from './components/SetupPanel';
import QuestionCard from './components/QuestionCard';
import ResultPanel from './components/ResultPanel';

const bank = bankData as unknown as QuestionBank;

type Phase = 'setup' | 'quiz' | 'result';

export default function App() {
  const { message } = AntdApp.useApp();
  const [config, setConfig] = useState<PiConfig>(() => loadConfig());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('setup');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [grades, setGrades] = useState<Record<string, EssayGrade | null>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const answeredCount = useMemo(() => {
    return questions.filter((q) => {
      const a = answers[q.id];
      if (q.type === 'essay') return Boolean(a && (a as string).trim());
      return Array.isArray(a) && a.length > 0;
    }).length;
  }, [questions, answers]);

  const handleSaveConfig = (c: PiConfig) => {
    setConfig(c);
    saveConfig(c);
    message.success('设置已保存');
  };

  const handleStart = async (opts: { count: number; categories: string[]; useAI: boolean }) => {
    const picked = pickQuestions(bank.questions, opts.count, opts.categories);
    let active = picked;
    if (opts.useAI) {
      if (!isConfigValid(config)) {
        message.error('请先配置 API Key 或关闭 AI 功能');
        setSettingsOpen(true);
        return;
      }
      setBusy('正在用 LLM 生成变体题目…');
      try {
        active = await Promise.all(
          picked.map((q) =>
            transformQuestion(q, config).catch((err) => {
              console.warn('变体生成失败，回退原题：', err);
              return q;
            }),
          ),
        );
        message.success('已用 LLM 生成变体题目');
      } catch (e) {
        message.error('生成变体失败：' + (e as Error).message);
        active = picked;
      } finally {
        setBusy(null);
      }
    }
    const init: Record<string, AnswerValue> = {};
    picked.forEach((q) => {
      init[q.id] = emptyAnswer(q);
    });
    setQuestions(active);
    setAnswers(init);
    setGrades({});
    setPhase('quiz');
  };

  const handleAnswerChange = (id: string, v: AnswerValue) => {
    setAnswers((prev) => ({ ...prev, [id]: v }));
  };

  const handleSubmit = async () => {
    const essayQs = questions.filter((q) => q.type === 'essay');
    const newGrades: Record<string, EssayGrade | null> = {};
    if (essayQs.length > 0 && isConfigValid(config)) {
      setBusy('正在用 LLM 评分问答题…');
      try {
        await Promise.all(
          essayQs.map(async (q) => {
            const ans = (answers[q.id] as string) ?? '';
            newGrades[q.id] = await gradeEssay(q as EssayQuestion, ans, config).catch((err) => {
              console.warn('评分失败：', err);
              return null;
            });
          }),
        );
      } finally {
        setBusy(null);
      }
    }
    setGrades(newGrades);
    setPhase('result');
  };

  const handleRestart = () => {
    setQuestions([]);
    setAnswers({});
    setGrades({});
    setPhase('setup');
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fff', borderBottom: '1px solid #f0f0f0' }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          🧠 AI 面试题训练器
        </Typography.Title>
        <Button icon={<SettingOutlined />} onClick={() => setSettingsOpen(true)}>
          LLM 设置
        </Button>
      </Layout.Header>

      <Layout.Content style={{ padding: 24, maxWidth: 980, margin: '0 auto', width: '100%' }}>
        {phase === 'setup' && (
          <SetupPanel categories={bank.categories} config={config} onStart={handleStart} onOpenSettings={() => setSettingsOpen(true)} />
        )}

        {phase === 'quiz' && (
          <div>
            <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }} wrap>
              <Tag color="blue">共 {questions.length} 题</Tag>
              <span>
                已答 {answeredCount}/{questions.length}
              </span>
              <Progress percent={Math.round((answeredCount / questions.length) * 100)} size="small" style={{ width: 160 }} />
              <Button onClick={handleRestart}>退出</Button>
            </Space>
            {questions.map((q, i) => (
              <QuestionCard
                key={q.id}
                index={i}
                question={q}
                value={answers[q.id] ?? emptyAnswer(q)}
                onChange={(v) => handleAnswerChange(q.id, v)}
              />
            ))}
            <Button type="primary" size="large" block onClick={handleSubmit}>
              提交并查看结果
            </Button>
          </div>
        )}

        {phase === 'result' && (
          <ResultPanel questions={questions} answers={answers} grades={grades} onRestart={handleRestart} />
        )}
      </Layout.Content>

      <SettingsModal open={settingsOpen} config={config} onClose={() => setSettingsOpen(false)} onSave={handleSaveConfig} />

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
