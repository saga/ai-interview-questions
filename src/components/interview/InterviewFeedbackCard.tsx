// 逐题反馈卡（共享组件）。
//
// 为什么必须是**共享**组件：immediate 模式下有两处 UI 要展示同一份逐题反馈——
// 独立 Agent 面试页 与 Copilot 侧栏。若各自实现，两份文案/分档/维度呈现必然漂移，
// 用户在不同入口看到不同的「同一场面试」。故此处只接收领域投影 `InterviewFeedback`，
// 不感知任何会话/运行时状态（谁渲染它、怎么推进下一题由调用方决定）。
//
// 边界：纯展示 + 两个可选回调；不读 store、不调 LLM、不写会话。

import { useState } from 'react';
import { Alert, Button, Card, Collapse, Divider, Progress, Space, Tag, Typography } from 'antd';
import { BulbOutlined, CheckCircleOutlined, CloseCircleOutlined, MessageOutlined, RightOutlined } from '@ant-design/icons';
import type { InterviewFeedback, FeedbackTone } from '../../domain/interviewFeedback';

interface Props {
  feedback: InterviewFeedback;
  /**
   * 用户点「继续」：由调用方推进下一题（immediate 模式的核心动作）。
   * 省略时不渲染该按钮（如只读回看 / 已结束的复盘场景）。
   */
  onContinue?: () => void;
  /** 「继续」按钮 loading（正在向 Agent 请求下一题）。 */
  continuing?: boolean;
  /** 本题已是最后一题（无下一题）→ 按钮文案改为「查看本轮结果」。 */
  isLast?: boolean;
  /**
   * 「让 Copilot 详细解释」：调用方把**结构化**反馈作为 AnswerContext 交给侧栏，
   * 而不是在此处手拼一段 prompt 文本（避免第二套上下文格式）。
   */
  onAskCopilot?: () => void;
}

/** 分档 → antd 语义色。刻意避开「红=涨/绿=跌」的价格语义：这里是评级，不是涨跌。 */
const TONE_COLOR: Record<FeedbackTone, string> = {
  strong: 'success',
  fair: 'processing',
  weak: 'warning',
};

/** 分档 → 进度条描边色（与 TONE_COLOR 语义一致）。 */
const TONE_STROKE: Record<FeedbackTone, string> = {
  strong: '#52c41a',
  fair: '#1677ff',
  weak: '#faad14',
};

export default function InterviewFeedbackCard({
  feedback,
  onContinue,
  continuing = false,
  isLast = false,
  onAskCopilot,
}: Props) {
  // 参考答案默认收起：用户还没进入下一题就先看到标准答案，会把「逐题反馈」变成「背答案」。
  const [showReference, setShowReference] = useState(false);

  const hasStrengths = feedback.strengths.length > 0;
  const hasGaps = feedback.gaps.length > 0;
  const hasKeyPoints = feedback.keyPoints.length > 0;

  return (
    <Card
      size="small"
      style={{ marginTop: 16, borderColor: '#d9d9d9' }}
      title={
        <Space wrap size={8}>
          <MessageOutlined style={{ color: '#1677ff' }} />
          <Typography.Text strong>本题反馈</Typography.Text>
          <Tag color={TONE_COLOR[feedback.band.tone]} style={{ margin: 0 }}>
            {feedback.band.label}
          </Tag>
          <Typography.Text strong style={{ fontSize: 18, color: TONE_STROKE[feedback.band.tone] }}>
            {feedback.overall}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            分
          </Typography.Text>
        </Space>
      }
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        {/* 题干 + 用户作答：回显「刚答的是哪道题、答了什么」，避免暂停后失去上下文 */}
        <div>
          <Typography.Paragraph style={{ margin: 0, fontWeight: 500 }}>{feedback.questionText}</Typography.Paragraph>
          <Typography.Paragraph type="secondary" style={{ margin: '6px 0 0', fontSize: 13, whiteSpace: 'pre-wrap' }}>
            你的作答：{feedback.answerText || '（未作答）'}
          </Typography.Paragraph>
        </div>

        <Divider style={{ margin: 0 }} />

        {/* 四维评分 */}
        <div>
          <Typography.Text strong style={{ fontSize: 13 }}>
            维度评分
          </Typography.Text>
          <div style={{ marginTop: 8 }}>
            {feedback.dimensions.map((d) => (
              <div key={d.key} style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <Typography.Text style={{ fontSize: 13 }}>{d.label}</Typography.Text>
                  {d.applicable ? (
                    <Typography.Text style={{ fontSize: 13 }}>{d.score}</Typography.Text>
                  ) : (
                    // 不适用维度必须显式标注：显示 0 分会被误读为「该能力为零」
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      本题不适用
                    </Typography.Text>
                  )}
                </div>
                <Progress
                  percent={d.applicable ? d.score : 0}
                  showInfo={false}
                  size="small"
                  strokeColor={d.applicable ? TONE_STROKE[feedback.band.tone] : '#d9d9d9'}
                  trailColor="#f0f0f0"
                />
                {d.applicable && d.evidence && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {d.evidence}
                  </Typography.Text>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 关键知识点：来自知识点层（required），缺失时回落题目 tags */}
        {hasKeyPoints && (
          <div>
            <Typography.Text strong style={{ fontSize: 13 }}>
              关键知识点
            </Typography.Text>
            <div style={{ marginTop: 6 }}>
              <Space wrap size={[6, 6]}>
                {feedback.keyPoints.map((p, i) => (
                  <Tag key={i} style={{ margin: 0, whiteSpace: 'normal' }}>
                    {p}
                  </Tag>
                ))}
              </Space>
            </div>
          </div>
        )}

        {/* 命中误解（选择题反证证据）：与「需加强」并列展示，明确告知错在哪 */}
        {feedback.misconceptionIds.length > 0 && (
          <Alert
            type="warning"
            showIcon
            message="命中的认知误区"
            description={
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {feedback.misconceptionIds.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            }
          />
        )}

        {/* 做得好 / 需加强 */}
        {(hasStrengths || hasGaps) && (
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {hasStrengths && (
              <div style={{ flex: '1 1 220px' }}>
                <Typography.Text strong style={{ fontSize: 13 }}>
                  <CheckCircleOutlined style={{ color: '#52c41a', marginRight: 6 }} />
                  做得好
                </Typography.Text>
                <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
                  {feedback.strengths.map((s, i) => (
                    <li key={i}>
                      <Typography.Text style={{ fontSize: 13 }}>{s}</Typography.Text>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {hasGaps && (
              <div style={{ flex: '1 1 220px' }}>
                <Typography.Text strong style={{ fontSize: 13 }}>
                  <CloseCircleOutlined style={{ color: '#faad14', marginRight: 6 }} />
                  需加强
                </Typography.Text>
                <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
                  {feedback.gaps.map((g, i) => (
                    <li key={i}>
                      <Typography.Text style={{ fontSize: 13 }}>{g}</Typography.Text>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* 面试官评语 */}
        {feedback.comment && (
          <div style={{ background: '#f6f8fa', borderRadius: 8, padding: '10px 12px', border: '1px solid #e5e7eb' }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              面试官评语
            </Typography.Text>
            <Typography.Paragraph style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>
              {feedback.comment}
            </Typography.Paragraph>
          </div>
        )}

        {/* 参考答案：默认折叠，需用户主动展开 */}
        {feedback.referenceAnswer && (
          <Collapse
            ghost
            size="small"
            activeKey={showReference ? ['ref'] : []}
            onChange={(keys) => setShowReference(keys.length > 0)}
            items={[
              {
                key: 'ref',
                label: (
                  <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                    <BulbOutlined style={{ marginRight: 6 }} />
                    查看参考答案
                  </Typography.Text>
                ),
                children: (
                  <Typography.Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 13 }}>
                    {feedback.referenceAnswer}
                  </Typography.Paragraph>
                ),
              },
            ]}
          />
        )}

        {(onContinue || onAskCopilot) && (
          <>
            <Divider style={{ margin: 0 }} />
            <Space wrap>
              {onContinue && (
                <Button
                  type="primary"
                  icon={<RightOutlined />}
                  loading={continuing}
                  onClick={onContinue}
                >
                  {isLast ? '查看本轮结果' : '继续下一题'}
                </Button>
              )}
              {onAskCopilot && (
                <Button icon={<MessageOutlined />} onClick={onAskCopilot} disabled={continuing}>
                  让 Copilot 详细解释
                </Button>
              )}
            </Space>
          </>
        )}
      </Space>
    </Card>
  );
}
