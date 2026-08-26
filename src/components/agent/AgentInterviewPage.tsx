import { useCallback, useEffect, useRef, useState } from 'react';
import { App as AntdApp, Alert, Button, Card, Divider, Space, Spin, Tag, Typography } from 'antd';
import {
  PlayCircleOutlined,
  RobotOutlined,
  SendOutlined,
  StopOutlined,
  ToolOutlined,
  UserOutlined,
} from '@ant-design/icons';
import type { AIConfig, AnswerValue, LearnerProfile, SessionQuestion, SessionRecord } from '../../types';
import { emptyAnswer } from '../../domain/quiz';
import { questionBank as bank } from '../../data/questionBank';
import { isConfigValid, isEntryValid, createLLMProvider } from '../../ai/provider';
import {
  createAgentSession,
  sessionRecordFromAgent,
  averageOverall,
  type InterviewAgentSession,
} from '../../agent/types';
import { createInterviewAgent } from '../../agent/interviewAgent';
import type { InterviewAgentHandle } from '../../agent/interviewAgent';
import QuestionCard from '../quiz/QuestionCard';

interface Props {
  config: AIConfig;
  profile: LearnerProfile;
  /** Agent 面试结束后，由 App 负责落库（updateLearner + saveLearner）。 */
  onComplete: (record: SessionRecord) => void;
  onGoSettings: () => void;
  onGoProgress: () => void;
}

type PagePhase = 'intro' | 'running' | 'done';

type TranscriptItem =
  | { kind: 'agent'; text: string }
  | { kind: 'tool'; tool: string; label: string; ok: boolean; detail?: string };

const TOOL_LABELS: Record<string, string> = {
  searchQuestions: '搜索题目',
  getQuestion: '选定题目',
  evaluateAnswer: '评估作答',
  getUserWeaknesses: '读取薄弱点',
  finishInterview: '结束面试',
};

const OPENING_INSTRUCTION = `你是一位资深 AI 技术面试官，主持一次约 6–10 题的模拟面试。流程：
1) 先调用 getUserWeaknesses 了解我的薄弱主题；
2) 用 searchQuestions 在相关主题找候选题，再用 getQuestion 选定一道题呈现给我；
3) 等我作答后，调用 evaluateAnswer 评分；
4) 根据评分决定下一步：答得好就换方向或提高难度，答不好就追问或回退前置知识；当充分考察或达到约 8 题时调用 finishInterview 结束。
注意：你不要自己打分，评分必须走 evaluateAnswer 工具；每次只呈现一道题，等我作答。`;

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

function hasAnswer(v?: AnswerValue): boolean {
  if (v == null) return false;
  return typeof v === 'string' ? v.trim().length > 0 : v.length > 0;
}

/** Agent 面试页：用 pi-agent-core 跑「选题/追问/结束」的自主决策循环，复用现有题库、评分与 Learner 管线。 */
export default function AgentInterviewPage({ config, profile, onComplete, onGoSettings, onGoProgress }: Props) {
  const { message } = AntdApp.useApp();
  const configReady = isConfigValid(config);

  const [phase, setPhase] = useState<PagePhase>('intro');
  const [currentQuestion, setCurrentQuestion] = useState<SessionQuestion | null>(null);
  const [answer, setAnswer] = useState<AnswerValue>([]);
  const [questions, setQuestions] = useState<SessionQuestion[]>([]);
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<{ asked: number; overall: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRef = useRef<InterviewAgentHandle | null>(null);
  const sessionRef = useRef<InterviewAgentSession | null>(null);
  const questionsRef = useRef<SessionQuestion[]>([]);
  const pendingTextRef = useRef('');

  const syncQuestions = useCallback((q: SessionQuestion) => {
    setQuestions((prev) => {
      if (prev.some((x) => x.question.id === q.question.id)) return prev;
      const next = [...prev, q];
      questionsRef.current = next;
      return next;
    });
  }, []);

  const finalize = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    handleRef.current?.abort();
    const asked = Object.keys(session.evaluations).length;
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

  const start = async () => {
    setError(null);
    const entry = config.providers?.find((p) => p.enabled && isEntryValid(p));
    const provider = createLLMProvider(config);
    if (!entry || !provider) {
      setError('未找到可用的 AI 引擎配置，请先在设置中配置。');
      return;
    }
    const session = createAgentSession();
    sessionRef.current = session;
    setQuestions([]);
    questionsRef.current = [];
    pendingTextRef.current = '';
    setTranscript([]);
    setCurrentQuestion(null);
    setAnswer([]);

    const handle = createInterviewAgent({
      session,
      profile,
      entry,
      bank: bank.questions,
      provider,
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
        },
        onStatus: (status) => {
          if (status === 'finished') finalize();
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
              setTranscript((prev) => [
                ...prev,
                { kind: 'tool', tool: e.toolName ?? '', label, ok: !e.isError, detail: toolDetail(e) },
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
    setPhase('running');
    try {
      await handle.start(OPENING_INSTRUCTION);
    } catch (err) {
      setBusy(false);
      setError('面试启动失败：' + (err as Error).message);
    }
  };

  const submit = async () => {
    if (!currentQuestion) return;
    if (!hasAnswer(answer)) {
      message.warning('请先作答再提交');
      return;
    }
    try {
      await handleRef.current?.submitAnswer(answer);
    } catch (err) {
      setError('提交失败：' + (err as Error).message);
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
    handleRef.current?.dispose();
    handleRef.current = null;
    sessionRef.current = null;
    setPhase('intro');
    setCurrentQuestion(null);
    setAnswer([]);
    setQuestions([]);
    questionsRef.current = [];
    setTranscript([]);
    setSummary(null);
    setError(null);
  };

  // 卸载时清理 Agent 订阅与运行。
  useEffect(() => () => handleRef.current?.dispose(), []);

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
            已考察 {Object.keys(sessionRef.current?.evaluations ?? {}).length} 题
          </Tag>
          {busy ? (
            <Tag color="processing">
              <Space size={4}>
                <Spin size="small" /> 面试官思考中…
              </Space>
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
            />
          ) : (
            <Card size="small">
              <Space>
                <Spin /> <Typography.Text type="secondary">面试官正在选题…</Typography.Text>
              </Space>
            </Card>
          )}
          {busy && (
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
              <Spin tip="面试官思考中…" />
            </div>
          )}
        </div>

        <Button
          type="primary"
          size="large"
          block
          icon={<SendOutlined />}
          style={{ marginTop: 16 }}
          disabled={!currentQuestion || !hasAnswer(answer) || busy}
          onClick={() => void submit()}
        >
          提交作答并继续
        </Button>

        {transcript.length > 0 && (
          <Card size="small" style={{ marginTop: 20 }} title="面试官的推理与决策">
            <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {transcript.map((item, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  {item.kind === 'agent' ? (
                    <>
                      <RobotOutlined style={{ color: '#1677ff', marginTop: 4 }} />
                      <Typography.Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                        {item.text}
                      </Typography.Paragraph>
                    </>
                  ) : (
                    <>
                      <ToolOutlined style={{ color: item.ok ? '#52c41a' : '#cf1322', marginTop: 4 }} />
                      <Typography.Text type={item.ok ? undefined : 'danger'}>
                        {item.label}
                        {item.detail ? ` · ${item.detail}` : ''}
                      </Typography.Text>
                    </>
                  )}
                </div>
              ))}
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
