import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Col,
  Empty,
  List,
  Progress,
  Row,
  Select,
  Space,
  Statistic,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  ApartmentOutlined,
  BookOutlined,
  ExclamationCircleOutlined,
  PlayCircleOutlined,
} from '@ant-design/icons';
import type { KnowledgeNode } from '../../schemas/knowledge';
import type { LearnerProfile } from '../../schemas/learner';
import { LEARNING_TRACKS, type LearningTrackId } from '../../data/learningTracks';
import {
  buildLearningMapReport,
  type LearningMapStatus,
  type LearningMapTopic,
} from '../../domain/learningMap';

interface Props {
  profile: LearnerProfile;
  nodes: KnowledgeNode[];
  defaultTrackId: LearningTrackId;
  onGoTrain: (trackId: LearningTrackId) => void;
  onTrackChange: (trackId: LearningTrackId) => void;
}

function statusTag(status: LearningMapStatus) {
  if (status === 'mastered') return <Tag color="success">已掌握</Tag>;
  if (status === 'weak') return <Tag color="warning">待加强</Tag>;
  return <Tag>未开始</Tag>;
}

function priorityTag(priority: KnowledgeNode['priority']) {
  return <Tag color={priority === 'P0' ? 'red' : priority === 'P1' ? 'blue' : 'default'}>{priority}</Tag>;
}

function TopicDetail({ topic, onGoTrain }: { topic: LearningMapTopic; onGoTrain: () => void }) {
  return (
    <Card
      size="small"
      title={<Space wrap>{topic.label}{statusTag(topic.status)}{priorityTag(topic.priority)}</Space>}
      extra={<Button size="small" type="primary" icon={<PlayCircleOutlined />} onClick={onGoTrain}>进入训练</Button>}
    >
      <Row gutter={[12, 12]}>
        <Col xs={12} sm={6}><Statistic title="作答次数" value={topic.attempts} /></Col>
        <Col xs={12} sm={6}><Statistic title="平均得分" value={topic.attempts ? topic.avgScore : '—'} suffix={topic.attempts ? '分' : undefined} /></Col>
        <Col xs={12} sm={6}><Statistic title="掌握度" value={topic.attempts ? Math.round(topic.mastery * 100) : '—'} suffix={topic.attempts ? '%' : undefined} /></Col>
        <Col xs={12} sm={6}><Statistic title="知识点" value={topic.conceptCount} suffix="个" /></Col>
      </Row>
      {topic.attempts > 0 && (
        <div style={{ marginTop: 12 }}>
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Typography.Text strong>主题掌握度</Typography.Text>
            <Typography.Text strong>{Math.round(topic.mastery * 100)}%</Typography.Text>
          </Space>
          <Progress percent={Math.round(topic.mastery * 100)} status={topic.status === 'weak' ? 'exception' : 'success'} />
        </div>
      )}
      {topic.concepts.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <Typography.Text strong>这个主题包含的知识点</Typography.Text>
          <List
            size="small"
            dataSource={topic.concepts}
            renderItem={(node) => {
              const statusLabel = node.status === 'mastered' ? '已掌握' : node.status === 'weak' ? '待加强' : node.status === 'learning' ? '学习中' : '未评估';
              const statusColor = node.status === 'mastered' ? 'success' : node.status === 'weak' ? 'error' : node.status === 'learning' ? 'processing' : 'default';
              return (
                <List.Item>
                  <Tooltip title={node.summary}>
                    <div style={{ width: '100%' }}>
                      <Space wrap>
                        <Typography.Text>{node.name}</Typography.Text>
                        <Tag color={statusColor}>{statusLabel}</Tag>
                        {node.attempts > 0 && <Typography.Text strong>{Math.round(node.mastery * 100)}%</Typography.Text>}
                      </Space>
                      {node.attempts > 0 && <Progress percent={Math.round(node.mastery * 100)} size="small" showInfo={false} status={node.status === 'weak' ? 'exception' : 'success'} />}
                      <Typography.Paragraph type="secondary" style={{ margin: '2px 0 0', fontSize: 12 }}>
                        {node.attempts > 0
                          ? `作答 ${node.attempts} 次 · 均分 ${node.avgScore} · 正向 ${node.positiveEvidence} · 负向 ${node.negativeEvidence}${node.lastSeenAt ? ` · 最近练习 ${new Date(node.lastSeenAt).toLocaleDateString()}` : ''}`
                          : node.required.slice(0, 3).join('；')}
                      </Typography.Paragraph>
                    </div>
                  </Tooltip>
                </List.Item>
              );
            }}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            掌握度来自明确关联到该知识点的题目表现；未评估表示目前没有可归属的答题证据，不代表零分。
          </Typography.Text>
        </div>
      )}
    </Card>
  );
}

export default function LearningMapPage({ profile, nodes, defaultTrackId, onGoTrain, onTrackChange }: Props) {
  const [trackId, setTrackId] = useState<LearningTrackId>(defaultTrackId);
  const report = useMemo(() => buildLearningMapReport(trackId, profile, nodes), [trackId, profile, nodes]);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);

  useEffect(() => {
    setTrackId(defaultTrackId);
  }, [defaultTrackId]);

  useEffect(() => {
    const first = report.recommendations[0] ?? report.branches[0]?.topics[0];
    setSelectedTopicId(first?.id ?? null);
    setSelectedBranchId(report.branches[0]?.id ?? null);
  }, [trackId, report]);

  const selectedTopic = report.branches.flatMap((branch) => branch.topics).find((topic) => topic.id === selectedTopicId);
  const selectedBranch = report.branches.find((branch) => branch.id === selectedBranchId);
  const recommendations = report.recommendations.slice(0, 6);

  return (
    <div style={{ width: '100%', maxWidth: 'none', margin: 0 }}>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }} wrap align="center">
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}><ApartmentOutlined /> 学习地图</Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            从整个知识体系查看学习覆盖、已掌握主题和需要补强的分支。
          </Typography.Text>
        </div>
        <Select
          value={trackId}
          style={{ minWidth: 190 }}
          onChange={(value) => {
            const nextTrackId = value as LearningTrackId;
            setTrackId(nextTrackId);
            onTrackChange(nextTrackId);
          }}
          options={LEARNING_TRACKS.map((track) => ({ label: track.shortTitle, value: track.id }))}
          aria-label="选择学习体系"
        />
      </Space>

      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="已接触主题" value={report.attemptedTopics} suffix={`/ ${report.totalTopics}`} />
            <Progress percent={report.coveragePercent} size="small" showInfo={false} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="已掌握主题" value={report.masteredTopics} suffix={`/ ${report.totalTopics}`} valueStyle={{ color: '#389e0d' }} />
            <Progress percent={report.masteryPercent} size="small" strokeColor="#52c41a" showInfo={false} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="待加强" value={report.weakTopics} valueStyle={{ color: report.weakTopics ? '#d48806' : undefined }} />
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>练过但尚未达到掌握线</Typography.Text>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="尚未开始" value={report.unstartedTopics} />
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>还没有相关作答记录</Typography.Text>
          </Card>
        </Col>
      </Row>

      {selectedTopic ? (
        <TopicDetail topic={selectedTopic} onGoTrain={() => onGoTrain(trackId)} />
      ) : selectedBranch ? (
        <Card size="small" title={selectedBranch.label}>
          <Typography.Text type="secondary">这个分支包含 {selectedBranch.totalTopics} 个主题。</Typography.Text>
        </Card>
      ) : (
        <Card size="small"><Empty description="当前学习体系还没有知识节点" /></Card>
      )}

      {selectedBranch && (
        <Card
          size="small"
          title={`分支主题 · ${selectedBranch.label}`}
          extra={<Typography.Text type="secondary">{selectedBranch.totalTopics} 个主题，选择后查看训练记录</Typography.Text>}
          style={{ marginTop: 12 }}
        >
          <List
            grid={{ gutter: 8, xs: 1, sm: 2, md: 3, lg: 4, xl: 4, xxl: 5 }}
            dataSource={selectedBranch.topics}
            renderItem={(topic) => (
              <List.Item>
                <Button
                  block
                  type={selectedTopicId === topic.id ? 'primary' : 'default'}
                  onClick={() => setSelectedTopicId(topic.id)}
                  style={{ height: 'auto', minHeight: 48, whiteSpace: 'normal', textAlign: 'left' }}
                >
                  <Space direction="vertical" size={2} style={{ width: '100%', alignItems: 'flex-start' }}>
                    <Typography.Text strong style={{ color: 'inherit' }}>{topic.label}</Typography.Text>
                    <Space size={4} wrap>
                      {statusTag(topic.status)}
                      {priorityTag(topic.priority)}
                      {topic.attempts > 0 && <Typography.Text style={{ color: 'inherit', fontSize: 12 }}>{Math.round(topic.mastery * 100)}%</Typography.Text>}
                    </Space>
                    <Typography.Text style={{ color: 'inherit', fontSize: 11 }}>
                      知识点已评估 {topic.assessedConcepts}/{topic.conceptCount} · 已掌握 {topic.masteredConcepts}
                    </Typography.Text>
                    {topic.attempts > 0 && (
                      <Progress percent={Math.round(topic.mastery * 100)} size="small" showInfo={false} status={topic.status === 'weak' ? 'exception' : 'success'} />
                    )}
                  </Space>
                </Button>
              </List.Item>
            )}
          />
        </Card>
      )}

      <Card size="small" title={<Space><ExclamationCircleOutlined /> 建议优先补强</Space>} style={{ marginTop: 12 }}>
        {recommendations.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前知识主题均达到掌握线。可以继续复习，保持知识新鲜度。" />
        ) : (
          <List
            size="small"
            dataSource={recommendations}
            renderItem={(topic) => (
              <List.Item
                actions={[
                  <Button key="detail" type="link" size="small" onClick={() => { setSelectedTopicId(topic.id); }}>
                    查看
                  </Button>,
                  <Button key="train" type="link" size="small" onClick={() => onGoTrain(trackId)}>
                    训练
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  avatar={topic.status === 'weak' ? <ExclamationCircleOutlined style={{ color: '#d48806' }} /> : <BookOutlined />}
                  title={<Space wrap>{topic.label}{statusTag(topic.status)}{priorityTag(topic.priority)}</Space>}
                  description={topic.status === 'weak' ? `已作答 ${topic.attempts} 次 · 平均 ${topic.avgScore} 分` : '尚未开始 · 建议安排首次学习和训练'}
                />
              </List.Item>
            )}
          />
        )}
      </Card>

      <Card size="small" title="分支进度" style={{ marginTop: 12 }}>
        <List
          size="small"
          dataSource={report.branches}
          renderItem={(branch) => (
            <List.Item
              style={{ cursor: 'pointer' }}
              onClick={() => {
                setSelectedBranchId(branch.id);
                setSelectedTopicId(branch.topics[0]?.id ?? null);
              }}
            >
              <div style={{ width: '100%' }}>
                <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
                  <Typography.Text strong>{branch.label}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    已掌握 {branch.masteredTopics}/{branch.totalTopics} · {branch.masteryPercent}% · 待加强 {branch.weakTopics} · 未开始 {branch.unstartedTopics}
                  </Typography.Text>
                </Space>
                <Progress percent={branch.masteryPercent} size="small" strokeColor="#52c41a" />
              </div>
            </List.Item>
          )}
        />
      </Card>
      <Typography.Paragraph type="secondary" style={{ marginTop: 10, fontSize: 12 }}>
        学习状态来自本机已保存的训练记录，不会因打开地图而修改成绩。统计按主题（topic）计算；同一主题下的多个知识点会合并，避免重复计数。
      </Typography.Paragraph>
    </div>
  );
}
