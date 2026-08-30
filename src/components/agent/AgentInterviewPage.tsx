import { Alert, Button, Card, Divider, Space, Spin, Tag, Typography } from 'antd';
import {
  PlayCircleOutlined,
  RobotOutlined,
  SendOutlined,
  StopOutlined,
  ToolOutlined,
  UserOutlined,
} from '@ant-design/icons';
import type { AnswerValue, LLMProvider } from '../../types';
import type { AIConfig } from '../../schemas/ai-config';
import { isConfigValid } from '../../ai/provider';
import type { AgentInterviewState, TranscriptItem } from '../../hooks/useAgentInterview';
import QuestionCard from '../quiz/QuestionCard';

interface Props extends AgentInterviewState {
  config: AIConfig;
  challengerProvider?: LLMProvider | null;
  onGoSettings: () => void;
  onGoProgress: () => void;
}

/**
 * 把 transcript 中「连续同名、同状态的工具调用」合并为一条带 ×N 计数的记录，
 * 避免 agent 每轮都 searchQuestions 时刷出一长串内容相同的「搜索题目」噪声。
 * agent 文本行保持原样。
 */
type DisplayItem =
  | { kind: 'agent'; text: string }
  | { kind: 'tool'; tool: string; label: string; ok: boolean; detail?: string; count: number };

function collapseToolRuns(items: TranscriptItem[]): DisplayItem[] {
  const out: DisplayItem[] = [];
  for (const it of items) {
    if (it.kind === 'agent') {
      out.push({ kind: 'agent', text: it.text });
      continue;
    }
    const last = out[out.length - 1];
    if (
      last &&
      last.kind === 'tool' &&
      last.tool === it.tool &&
      last.ok === it.ok &&
      last.detail === it.detail
    ) {
      last.count += 1;
      continue;
    }
    out.push({ kind: 'tool', tool: it.tool, label: it.label, ok: it.ok, detail: it.detail, count: 1 });
  }
  return out;
}

function hasAnswer(v?: AnswerValue): boolean {
  if (v == null) return false;
  return typeof v === 'string' ? v.trim().length > 0 : v.length > 0;
}

/** Agent 面试页（纯展示）：会话状态由 App 层 useAgentInterview 持有，切 tab 不丢失。 */
export default function AgentInterviewPage({
  config,
  challengerProvider,
  onGoSettings,
  onGoProgress,
  phase,
  currentQuestion,
  answer,
  questions,
  transcript,
  busy,
  submitting,
  summary,
  error,
  evaluatedCount,
  setAnswer,
  start,
  submit,
  endEarly,
  restart,
}: Props) {
  const configReady = isConfigValid(config);

  // ── 开场介绍 ──
  if (phase === 'intro') {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <Typography.Title level={4} style={{ marginTop: 0 }}>
          <RobotOutlined /> Agent 面试
        </Typography.Title>
        <Card>
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Space align="center" size={12}>
              <RobotOutlined style={{ fontSize: 28, color: '#1677ff' }} />
              <div>
                <Typography.Text strong style={{ fontSize: 15 }}>
                  自主决策的 AI 面试官
                </Typography.Text>
                <br />
                <Typography.Text type="secondary">
                  由 pi-agent-core 驱动的面试运行时：自主选题、按你的表现追问或换方向、决定何时结束
                </Typography.Text>
              </div>
            </Space>
            <Space wrap>
              <Tag color="blue">观察 → 决策 → 工具 → 再观察</Tag>
              <Tag color="geekblue">选题 / 追问 / 结束 全自动</Tag>
              <Tag color="purple">结果记入学习档案</Tag>
            </Space>
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
              与「模拟面试」（规则式逐题自适应）不同，这里由 Agent 在循环中实时判断下一题问什么、是否追问、
              何时收尾；评分仍走既有确定性/LLM 评分管线，Agent 不自己打分。题库、评分与 Learner Memory 复用同一套。
            </Typography.Paragraph>
            {!configReady && (
              <Alert
                type="warning"
                showIcon
                message="AI 未配置：Agent 面试需要可用的 AI 引擎"
                action={
                  <Button size="small" onClick={onGoSettings}>
                    去设置
                  </Button>
                }
              />
            )}
            {error && (
              <Alert type="error" showIcon message={error} />
            )}
            <Button
              type="primary"
              size="large"
              icon={<PlayCircleOutlined />}
              block
              disabled={!configReady}
              onClick={() => void start()}
            >
              开始 Agent 面试
            </Button>
          </Space>
        </Card>
      </div>
    );
  }

  // ── 运行中 ──
  if (phase === 'running') {
    return (
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }} wrap>
          <Tag color="blue">
            已考察 {evaluatedCount} 题
          </Tag>
          {busy || submitting ? (
            <Tag color="processing">
              {submitting ? '正在检查回答…' : '面试官思考中…'}
            </Tag>
          ) : (
            <Tag color="default">等待你的作答</Tag>
          )}
          <Button size="small" icon={<StopOutlined />} disabled={busy} onClick={endEarly}>
            提前结束
          </Button>
        </Space>

        {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}

        <div style={{ position: 'relative' }}>
          {currentQuestion ? (
            <QuestionCard
              index={questions.findIndex((q) => q.question.id === currentQuestion.question.id)}
              question={currentQuestion.question}
              format={currentQuestion.format}
              value={answer}
              onChange={setAnswer}
              challengerEnabled={config.questionChallengerEnabled}
              challengerProvider={challengerProvider}
            />
          ) : (
            <Card size="small">
              <Typography.Text type="secondary">面试官正在选题…</Typography.Text>
            </Card>
          )}
          {(busy || submitting) && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: 'rgba(255,255,255,0.55)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 8,
              }}
            >
              <Spin tip={submitting ? '正在检查回答…' : '面试官思考中…'} />
            </div>
          )}
        </div>

        <Button
          type="primary"
          size="large"
          block
          icon={<SendOutlined />}
          style={{ marginTop: 16 }}
          disabled={!currentQuestion || !hasAnswer(answer) || busy || submitting}
          onClick={() => void submit()}
        >
          提交作答并继续
        </Button>

        {transcript.length > 0 && (
          <Card size="small" style={{ marginTop: 20 }} title="面试官的推理与决策">
            <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {collapseToolRuns(transcript).map((item, i) =>
                item.kind === 'agent' ? (
                  <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: '50%',
                        background: '#e6f4ff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <RobotOutlined style={{ color: '#1677ff', fontSize: 15 }} />
                    </div>
                    <div
                      style={{
                        flex: 1,
                        background: '#f6f8fa',
                        borderRadius: 12,
                        padding: '10px 14px',
                        border: '1px solid #e5e7eb',
                      }}
                    >
                      <Typography.Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                        {item.text}
                      </Typography.Paragraph>
                    </div>
                  </div>
                ) : (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', paddingLeft: 42 }}>
                    <Tag
                      icon={<ToolOutlined />}
                      color={item.ok ? 'success' : 'error'}
                      style={{ margin: 0, borderRadius: 10 }}
                    >
                      {item.label}
                      {item.count > 1 ? ` ×${item.count}` : ''}
                      {item.count === 1 && item.detail ? ` · ${item.detail}` : ''}
                    </Tag>
                  </div>
                )
              )}
            </div>
          </Card>
        )}
      </div>
    );
  }

  // ── 结束总结 ──
  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <Card>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            <UserOutlined /> 本轮 Agent 面试结束
          </Typography.Title>
          <Typography.Paragraph style={{ margin: 0 }}>
            共完成 <b>{summary?.asked ?? 0}</b> 道题目的作答与评估，综合得分{' '}
            <b>{summary?.overall ?? 0}</b> 分。
          </Typography.Paragraph>
          <Divider style={{ margin: '4px 0' }} />
          <Typography.Paragraph type="secondary" style={{ margin: 0, fontSize: 13 }}>
            结果已记入你的学习档案（含本轮选题与评分），「进度」页与首页建议会据此更新；
            薄弱主题会在下一轮被 Agent 优先考察。
          </Typography.Paragraph>
          <Space wrap>
            <Button type="primary" icon={<RobotOutlined />} onClick={restart}>
              再聊一轮
            </Button>
            <Button onClick={onGoProgress}>查看学习进度</Button>
          </Space>
        </Space>
      </Card>
    </div>
  );
}
