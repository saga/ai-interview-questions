import { Card, Typography, Button, Tag, Space, Alert } from 'antd';
import { CommentOutlined, PlayCircleOutlined, ClockCircleOutlined } from '@ant-design/icons';
import type { InterviewDefinition, LearnerProfile } from '../../types';
import { isConfigValid } from '../../ai/provider';
import type { PiConfig } from '../../types';
import { buildCoachDefinition, recommendationText } from '../../domain/learner';

interface Props {
  config: PiConfig;
  profile: LearnerProfile;
  onStart: (def: InterviewDefinition) => void;
  onGoSettings: () => void;
}

export default function InterviewPage({ config, profile, onStart, onGoSettings }: Props) {
  const configReady = isConfigValid(config);

  const start = () => {
    onStart(
      buildCoachDefinition(profile, {
        title: '模拟面试',
        count: 10,
        timeLimitSec: 30 * 60,
        mode: 'interview',
      }),
    );
  };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        <CommentOutlined /> 模拟面试
      </Typography.Title>
      <Card>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Space align="center" size={12}>
            <CommentOutlined style={{ fontSize: 28, color: '#722ed1' }} />
            <div>
              <Typography.Text strong style={{ fontSize: 15 }}>
                AI 面试官
              </Typography.Text>
              <br />
              <Typography.Text type="secondary">30 分钟 · 10 道题 · 根据你的薄弱项出题</Typography.Text>
            </div>
          </Space>
          <Space wrap>
            <Tag icon={<ClockCircleOutlined />} color="purple">
              限时 30 分钟，到点自动交卷
            </Tag>
            <Tag color="geekblue">含选择题 / 问答 / 编程</Tag>
          </Space>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
            首版为限时综合题组（与训练共用引擎与评分）；追问式对话面试（follow-up loop）将基于
            pi-agent-core 的 Agent 陆续接入。
          </Typography.Paragraph>
          {!configReady && (
            <Alert
              type="warning"
              showIcon
              message="AI 未配置，开放题将不自动评分"
              action={
                <Button size="small" onClick={onGoSettings}>
                  去设置
                </Button>
              }
            />
          )}
          <Button
            type="primary"
            size="large"
            icon={<PlayCircleOutlined />}
            block
            disabled={!configReady}
            onClick={start}
          >
            开始模拟面试
          </Button>
        </Space>
      </Card>
      {profile.totalSessions > 0 && (
        <Card size="small" style={{ marginTop: 16 }} title="面试官视角的你的档案">
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            {recommendationText(profile)}
          </Typography.Paragraph>
        </Card>
      )}
    </div>
  );
}
