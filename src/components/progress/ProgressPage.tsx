import { Card, Typography, Progress, Tag, List, Empty, Button, Space } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined, MinusOutlined, ThunderboltOutlined, ApartmentOutlined } from '@ant-design/icons';
import type { LearnerProfile } from '../../types';
import type { CoverageReport, TopicSuggestion } from '../../domain/learner';

interface Props {
  profile: LearnerProfile;
  onGoTrain: () => void;
  coverage: CoverageReport;
  suggestions: TopicSuggestion[];
}

function fmtDate(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 最近 10 次会话得分的简易折线（内联 SVG，不引入图表库）。 */
function TrendSparkline({ scores }: { scores: number[] }) {
  if (scores.length < 2) return null;
  const w = 320;
  const h = 64;
  const pad = 6;
  const max = 100;
  const step = scores.length > 1 ? (w - pad * 2) / (scores.length - 1) : 0;
  const pts = scores.map((s, i) => `${pad + i * step},${h - pad - (Math.max(0, Math.min(100, s)) / max) * (h - pad * 2)}`);
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block', maxWidth: w }}>
      <polyline points={pts.join(' ')} fill="none" stroke="#1677ff" strokeWidth={2} strokeLinejoin="round" />
      {scores.map((s, i) => (
        <circle key={i} cx={pad + i * step} cy={h - pad - (Math.max(0, Math.min(100, s)) / max) * (h - pad * 2)} r={2.5} fill="#1677ff" />
      ))}
    </svg>
  );
}

function masteryColor(m: number): string {
  if (m >= 0.85) return '#52c41a';
  if (m >= 0.7) return '#1677ff';
  return '#ff4d4f';
}

export default function ProgressPage({ profile, onGoTrain, coverage, suggestions }: Props) {
  const { sessions, topicStats, overallScore } = profile;

  if (sessions.length === 0) {
    return (
      <Card style={{ maxWidth: 720, margin: '0 auto' }}>
        <Empty description="还没有训练记录">
          <Button type="primary" icon={<ThunderboltOutlined />} onClick={onGoTrain}>
            去开始第一次训练
          </Button>
        </Empty>
      </Card>
    );
  }

  const topics = Object.entries(topicStats)
    .filter(([, s]) => s.attempts > 0)
    .sort((a, b) => b[1].mastery - a[1].mastery);
  const needsAttention = topics.filter(([, s]) => s.mastery < 0.7).sort((a, b) => a[1].mastery - b[1].mastery);
  const recentScores = sessions.slice(0, 10).map((s) => s.overall).reverse();

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        <ThunderboltOutlined /> 我的进步
      </Typography.Title>

      <Card style={{ marginBottom: 16, textAlign: 'center' }}>
        <Progress type="dashboard" percent={overallScore} />
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          共 {profile.totalSessions} 次训练 · {profile.totalQuestions} 题
        </Typography.Paragraph>
      </Card>

      <Card size="small" style={{ marginBottom: 16 }} title="主题掌握度">
        {topics.map(([topic, s]) => (
          <div key={topic} style={{ marginBottom: 8 }}>
            <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
              <Space size={4}>
                <Typography.Text>{topic}</Typography.Text>
                {s.trend === 'improving' && <Tag icon={<ArrowUpOutlined />} color="success" style={{ marginInlineEnd: 0 }}>进步</Tag>}
                {s.trend === 'declining' && <Tag icon={<ArrowDownOutlined />} color="error" style={{ marginInlineEnd: 0 }}>下滑</Tag>}
                {s.trend === 'flat' && <Tag icon={<MinusOutlined />} color="default" style={{ marginInlineEnd: 0 }}>平稳</Tag>}
              </Space>
              <Typography.Text type="secondary">
                {s.attempts} 次 · 均分 {s.avgScore}
              </Typography.Text>
            </Space>
            <Progress
              percent={Math.round(s.mastery * 100)}
              strokeColor={masteryColor(s.mastery)}
              size="small"
              format={(p) => `${p}%`}
            />
          </div>
        ))}
      </Card>

      <Card size="small" style={{ marginBottom: 16 }} title={<span><ApartmentOutlined /> 知识覆盖面</span>}>
        {coverage.categories.map((c) => (
          <div key={c.category} style={{ marginBottom: 8 }}>
            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
              <Typography.Text>{c.category}</Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                覆盖 {c.attempted}/{c.totalTopics} 主题 · 掌握 {c.mastered}
              </Typography.Text>
            </Space>
            <Progress
              percent={Math.round((c.attempted / c.totalTopics) * 100)}
              strokeColor={c.mastered >= c.totalTopics ? '#52c41a' : undefined}
              size="small"
              format={(p) => `${p}%`}
            />
          </div>
        ))}
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: '8px 0 0' }}>
          共 {coverage.unattemptedCount} 个主题未接触
          {coverage.blockedCount > 0 && `，其中 ${coverage.blockedCount} 个主题的前置知识尚未掌握`}
          。
        </Typography.Paragraph>
      </Card>

      <Card size="small" style={{ marginBottom: 16 }} title="最近趋势">
        <TrendSparkline scores={recentScores} />
        <List
          size="small"
          dataSource={sessions.slice(0, 5)}
          renderItem={(s) => (
            <List.Item style={{ padding: '4px 0' }}>
              <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
                <span>
                  {s.title}
                  <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                    {fmtDate(s.startedAt)}
                  </Typography.Text>
                </span>
                <Tag color={s.overall >= 80 ? 'success' : s.overall >= 60 ? 'gold' : 'error'}>{s.overall} 分</Tag>
              </Space>
            </List.Item>
          )}
        />
      </Card>

      {suggestions.length > 0 && (
        <Card size="small" style={{ marginBottom: 16 }} title="建议下一步">
          <List
            size="small"
            dataSource={suggestions}
            renderItem={(s) => (
              <List.Item style={{ padding: '4px 0' }}>
                <Space wrap>
                  <Tag color={coverage.weakTopics.includes(s.topic) ? 'orange' : 'geekblue'}>{s.topic}</Tag>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>{s.reason}</Typography.Text>
                </Space>
              </List.Item>
            )}
          />
          <Button type="primary" ghost block style={{ marginTop: 8 }} onClick={onGoTrain}>
            按建议训练
          </Button>
        </Card>
      )}

      {needsAttention.length > 0 && (
        <Card size="small" title="需要关注">
          <Space wrap>
            {needsAttention.map(([topic, s]) => (
              <Tag key={topic} color={masteryColor(s.mastery)}>
                {topic} · 掌握 {Math.round(s.mastery * 100)}%
              </Tag>
            ))}
          </Space>
          <Button type="primary" ghost block style={{ marginTop: 12 }} onClick={onGoTrain}>
            针对薄弱项训练
          </Button>
        </Card>
      )}
    </div>
  );
}
