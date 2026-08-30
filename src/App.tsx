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

type Page = 'train' | 'progress' | 'interview' | 'settings' | 'agent';

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
  const goPage = (p: Page) => navigate(p === 'train' ? '/train' : `/${p}`);
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

      {/* 导航菜单常驻：进入训练/面试后也允许切换 tab 再切回，进行中的会话不会丢失 */}
      <Menu
        mode="horizontal"
        selectedKeys={[page]}
        items={NAV_ITEMS}
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
                    disabledCategories={config.disabledCategories ?? []}
                    onToggleCategory={handleToggleCategory}
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
                    onResetLearner={resetLearnerProfile}
                    {...settings}
                  />
                )}

                {phase === 'home' && page === 'agent' && (
                  <AgentInterviewPage
                    config={config}
                    challengerProvider={challengerProvider}
                    onGoSettings={() => goPage('settings')}
                    onGoProgress={() => goPage('progress')}
                    {...agent}
                  />
                )}

                {phase === 'quiz' && page === 'train' && session?.definition.adaptive && questions[adaptiveCursor] && (
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
                )}

                {phase === 'quiz' && page === 'train' && session?.definition.adaptive && !questions[adaptiveCursor] && (
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
                )}

                {phase === 'quiz' && page === 'train' && !(session?.definition.adaptive && questions[adaptiveCursor]) && !(session?.definition.adaptive && !questions[adaptiveCursor]) && (
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
                )}

                {phase === 'result' && page === 'train' && (
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
