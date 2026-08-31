import { useState, type ReactNode } from 'react';
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
import type { InterviewDefinition } from './schemas/interview';
import type { LearnerProfile } from './schemas/learner';
import { emptyAnswer } from './domain/quiz';
import { collectTopicRefs } from './domain/learner';
import { computeCoverage, suggestNextTopics } from './domain/learner';
import { emptyProfile } from './domain/learner';
import { useTrainingSession, hasAnswerValue, fmt } from './hooks/useTrainingSession';
import { useAgentInterview } from './hooks/useAgentInterview';
import { useSettingsDraft } from './hooks/useSettingsDraft';
import SettingsPanel from './components/settings/SettingsPanel';
import TrainingHome from './components/home/TrainingHome';
import ProgressPage from './components/progress/ProgressPage';
import InterviewPage from './components/interview/InterviewPage';
import AgentInterviewPage from './components/agent/AgentInterviewPage';
import QuestionCard from './components/quiz/QuestionCard';
import AdaptiveQuiz from './components/quiz/AdaptiveQuiz';
import ResultPanel from './components/result/ResultPanel';
import CopilotSidebar from './components/copilot/CopilotSidebar';
import { createLLMProvider } from './ai/provider';
import { devUsageLogger } from './ai/usageTelemetry';
import { type Page, attemptNavigate, isTrainingSessionRunning } from './navigationGuard';

const VALID_PAGES: Page[] = ['train', 'progress', 'interview', 'settings', 'agent'];
/** 由 URL pathname 派生当前页面；未知路径回退训练首页。 */
function pageFromPath(pathname: string): Page {
  const seg = pathname.split('/').filter(Boolean)[0] ?? '';
  return (VALID_PAGES as string[]).includes(seg) ? (seg as Page) : 'train';
}

const NAV_ITEMS = [
  { key: 'train', icon: <ThunderboltOutlined />, label: '训练' },
  { key: 'progress', icon: <BarChartOutlined />, label: '进度' },
  { key: 'interview', icon: <CommentOutlined />, label: '面试' },
  { key: 'agent', icon: <RobotOutlined />, label: 'Agent 面试' },
  { key: 'settings', icon: <SettingOutlined />, label: '设置' },
];


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
  const location = useLocation();
  const navigate = useNavigate();
  const page = pageFromPath(location.pathname);
  // P0-1（续）：进行中的训练会话（quiz/result）锁定普通 tab 导航——离开 /train 会白屏。
  // 直接把 goPage 收敛为受守导航，所有调用点（菜单、子页回调、开局）统一受益。
  const goPage = (p: Page) =>
    attemptNavigate({ target: p, phase, navigate, warn: (m) => message.warning(m) });
  const [copilotOpen, setCopilotOpen] = useState(false);

  const {
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
    configReady,
    answeredCount,
    adaptiveCursor,
    copilotQuestion,
    resetLearnerProfile,
    handleSaveConfig,
    handleToggleCategory,
    handleStart,
    handleAdaptiveNext,
    handleFinishEarly,
    doSubmit,
    handleAnswerChange,
    handleContinue,
    handleAgentComplete,
    handleRestart,
  } = useTrainingSession(message, () => goPage('train'));
  // Agent 面试会话状态提升到 App 层（与训练同思路），切 tab（如去设置页）时不丢失。
  const agent = useAgentInterview(config, profile ?? emptyProfile(), handleAgentComplete, message);
  // 设置页未保存草稿提升到 App 层（同上思路），切到其它 tab 再切回时不丢编辑态。
  const settings = useSettingsDraft(config, handleSaveConfig, message);
  const challengerProvider = createLLMProvider(config, devUsageLogger);

  // P0-1：从非 train 页面（如 /interview「面试」页）开局时，handleStart 只 setPhase('quiz')
  // 而不导航；而 quiz / result / adaptive 渲染分支全部 gated 在 `page === 'train'`，
  // 于是 phase==='quiz' 但 page!=='train' 时四个分支全不命中 ⇒ 白屏。
  // 这里在开局时把页面收敛到 /train，让 quiz 渲染分支命中；已在 train 页则为 no-op。
  // （与 useTrainingSession 的 onRestart 同理：退出/重开都回 train 页。）
  const startSession = (def: InterviewDefinition) => {
    if (page !== 'train') goPage('train');
    void handleStart(def);
  };

  // 渲染主区：把 (phase, page) → 组件的映射收敛到单一函数，
  // 让 P0-1 的不变量（进行中会话仅 /train 渲染）在一处可读、可审计，避免分支漂移再次白屏。
  const renderContent = (p: LearnerProfile): ReactNode => {
    // 进行中的训练会话（quiz / result）只在 /train 渲染；其它页无对应分支会白屏。
    // 菜单已禁用非 train 的 tab，这里再兜底一处守卫。
    if (phase === 'quiz' || phase === 'result') {
      if (page !== 'train') return null;
      if (phase === 'result') {
        return (
          <ResultPanel
            questions={questions}
            answers={answers}
            grades={grades}
            profile={p}
            prevOverall={prevOverall}
            onContinue={handleContinue}
            onRestart={handleRestart}
          />
        );
      }
      // phase === 'quiz'
      if (session?.definition.adaptive) {
        if (questions[adaptiveCursor]) {
          return (
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
                challengerEnabled={config.questionChallengerEnabled}
                challengerProvider={challengerProvider}
              />
            </div>
          );
        }
        return (
          <div style={{ maxWidth: 820, margin: '0 auto' }}>
            <Alert
              type="success"
              showIcon
              message={`已完成 ${questions.length} 道自适应题目`}
              description="每题均已实时评分。点击下方按钮查看完整结果与薄弱项分析。"
              action={
                <Button type="primary" disabled={busy != null} onClick={() => void doSubmit()}>
                  查看训练结果
                </Button>
              }
            />
          </div>
        );
      }
      // 非自适应：完整题目列表
      return (
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
              challengerEnabled={config.questionChallengerEnabled}
              challengerProvider={challengerProvider}
            />
          ))}
          <Button type="primary" size="large" block disabled={busy != null} onClick={doSubmit}>
            提交并查看结果
          </Button>
        </div>
      );
    }

    // phase === 'home'：按当前 page 渲染首页型组件
    switch (page) {
      case 'train':
        return (
          <TrainingHome
            categories={bank.categories}
            config={config}
            profile={p}
            onStart={startSession}
            onGoSettings={() => goPage('settings')}
          />
        );
      case 'progress':
        return (
          <ProgressPage
            profile={p}
            onGoTrain={() => goPage('train')}
            coverage={computeCoverage(collectTopicRefs(bank.questions), p)}
            suggestions={suggestNextTopics(collectTopicRefs(bank.questions), p)}
            disabledCategories={config.disabledCategories ?? []}
            onToggleCategory={handleToggleCategory}
          />
        );
      case 'interview':
        return (
          <InterviewPage
            config={config}
            profile={p}
            onStart={startSession}
            onGoSettings={() => goPage('settings')}
          />
        );
      case 'settings':
        return <SettingsPanel onResetLearner={resetLearnerProfile} {...settings} />;
      case 'agent':
        return (
          <AgentInterviewPage
            config={config}
            challengerProvider={challengerProvider}
            onGoSettings={() => goPage('settings')}
            onGoProgress={() => goPage('progress')}
            {...agent}
          />
        );
      default:
        return null;
    }
  };

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

      {/* 导航菜单常驻：进入训练/面试后也允许切换 tab 再切回，进行中的会话不会丢失。
          但若训练会话进行中，非 train 的 tab 直接禁用（goPage 仍是兜底，双击/键盘不会漏） */}
      <Menu
        mode="horizontal"
        selectedKeys={[page]}
        items={NAV_ITEMS.map((it) => ({
          ...it,
          disabled: isTrainingSessionRunning(phase) && it.key !== 'train',
        }))}
        onClick={(e) => goPage(e.key as Page)}
        style={{ justifyContent: 'center', borderBottom: '1px solid #f0f0f0' }}
      />

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
          <LearnerBound profile={profile}>{(displayedProfile) => renderContent(displayedProfile)}</LearnerBound>
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
