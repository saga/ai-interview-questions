import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
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
  buildLearningMapGraphData,
  buildLearningMapReport,
  type LearningMapGraphData,
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

interface G6LiteNodeClickEvent {
  nodeId: string;
}

interface G6LiteGraphInstance {
  on: (event: 'node:click', handler: (event: G6LiteNodeClickEvent) => void) => void;
  render: () => Promise<void>;
  destroy: () => void;
}

interface G6LiteApi {
  Graph: new (options: Record<string, unknown>) => G6LiteGraphInstance;
}

declare global {
  interface Window {
    G6Lite?: G6LiteApi;
  }
}

const G6LITE_VERSION = '0.1.0';
const G6LITE_CDN = `https://cdn.jsdelivr.net/npm/@antv/g6-lite@${G6LITE_VERSION}/dist/g6-lite.min.js`;
let g6LitePromise: Promise<G6LiteApi> | null = null;

function loadG6Lite(): Promise<G6LiteApi> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('当前环境不支持浏览器画布'));
  }
  if (window.G6Lite?.Graph) return Promise.resolve(window.G6Lite);
  if (g6LitePromise) return g6LitePromise;

  g6LitePromise = new Promise<G6LiteApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = G6LITE_CDN;
    script.async = true;
    script.onload = () => {
      if (window.G6Lite?.Graph) resolve(window.G6Lite);
      else reject(new Error('G6Lite 脚本已加载，但没有找到 Graph API'));
    };
    script.onerror = () => reject(new Error('G6Lite 图形库加载失败，请检查网络或 CDN 访问'));
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    g6LitePromise = null;
    throw error;
  });

  return g6LitePromise;
}

function statusColor(status: LearningMapStatus): string {
  if (status === 'mastered') return '#52c41a';
  if (status === 'weak') return '#faad14';
  return '#bfbfbf';
}

function statusTag(status: LearningMapStatus) {
  if (status === 'mastered') return <Tag color="success">已掌握</Tag>;
  if (status === 'weak') return <Tag color="warning">待加强</Tag>;
  return <Tag>未开始</Tag>;
}

function priorityTag(priority: KnowledgeNode['priority']) {
  return <Tag color={priority === 'P0' ? 'red' : priority === 'P1' ? 'blue' : 'default'}>{priority}</Tag>;
}

function G6LiteCanvas({
  data,
  onSelectNode,
}: {
  data: LearningMapGraphData;
  onSelectNode: (nodeId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const serializedData = useMemo(() => {
    const nodes = data.nodes.filter((node) => node.data.kind !== 'topic');
    const nodeIds = new Set(nodes.map((node) => node.id));
    return {
      nodes,
      edges: data.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)),
    };
  }, [data]);

  useEffect(() => {
    let disposed = false;
    let graph: G6LiteGraphInstance | null = null;
    setLoading(true);
    setError(null);

    void loadG6Lite()
      .then(async (api) => {
        if (disposed || !containerRef.current) return;
        const graphData = serializedData as unknown as Record<string, unknown>;
        graph = new api.Graph({
          container: containerRef.current,
          data: graphData,
          layout: { type: 'dagre', rankdir: 'LR', ranksep: 76, nodesep: 28, nodeSize: 160 },
          node: {
            type: 'rect',
            style: {
              width: (item: { data?: { kind?: string } }) => item.data?.kind === 'root' ? 232 : item.data?.kind === 'branch' ? 224 : 220,
              height: (item: { data?: { kind?: string } }) => item.data?.kind === 'root' ? 58 : item.data?.kind === 'branch' ? 52 : 46,
              borderRadius: 9,
              fill: (item: { data?: { kind?: string; status?: LearningMapStatus } }) =>
                item.data?.kind === 'root' ? '#1677ff' : item.data?.kind === 'branch' ? '#e6f4ff' : statusColor(item.data?.status ?? 'unstarted'),
              stroke: (item: { data?: { kind?: string; status?: LearningMapStatus } }) =>
                item.data?.kind === 'root' ? '#0958d9' : item.data?.kind === 'branch' ? '#91caff' : item.data?.status === 'mastered' ? '#389e0d' : item.data?.status === 'weak' ? '#d48806' : '#d9d9d9',
              strokeWidth: 1.5,
              label: (item: { name?: string; id: string }) => item.name ?? item.id,
              labelPlacement: 'center',
              labelFontSize: (item: { data?: { kind?: string } }) => item.data?.kind === 'topic' ? 11 : 13,
              labelFontWeight: (item: { data?: { kind?: string } }) => item.data?.kind === 'root' ? '600' : '500',
              labelColor: (item: { data?: { kind?: string } }) => item.data?.kind === 'root' ? '#fff' : '#1f2937',
              labelMaxWidth: 205,
            },
            stateStyles: { selected: { stroke: '#722ed1', strokeWidth: 3 } },
          },
          edge: { style: { stroke: '#cbd5e1', lineWidth: 1.5, endArrow: true } },
          label: { hideOnLowZoom: false, scaleWithZoom: false },
          behaviors: ['drag-canvas', 'zoom-canvas', 'click-select', 'hover-highlight'],
          autoFit: { padding: 36 },
        });
        graph.on('node:click', ({ nodeId }) => {
          if (!disposed) onSelectNode(nodeId);
        });
        await graph.render();
        if (disposed) {
          graph.destroy();
          graph = null;
        } else {
          setLoading(false);
        }
      })
      .catch((reason: unknown) => {
        if (disposed) return;
        graph?.destroy();
        graph = null;
        setLoading(false);
        setError(reason instanceof Error ? reason.message : String(reason));
      });

    return () => {
      disposed = true;
      graph?.destroy();
      graph = null;
    };
  }, [serializedData, onSelectNode]);

  return (
    <div>
      {loading && <Typography.Text type="secondary">正在加载 G6Lite 学习地图…</Typography.Text>}
      {error && (
        <Alert
          type="warning"
          showIcon
          message="图形视图暂不可用"
          description={error}
          style={{ marginBottom: 12 }}
        />
      )}
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: 760,
          minHeight: 560,
          border: '1px solid #f0f0f0',
          borderRadius: 8,
          background: '#fff',
          display: error ? 'none' : 'block',
        }}
      />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        可拖动画布、滚轮缩放；点击主题节点查看学习记录。颜色代表当前学习状态。
      </Typography.Text>
    </div>
  );
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
      {topic.concepts.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <Typography.Text strong>这个主题包含的知识点</Typography.Text>
          <List
            size="small"
            dataSource={topic.concepts}
            renderItem={(node) => (
              <List.Item>
                <Tooltip title={node.summary}>
                  <div style={{ width: '100%' }}>
                    <Typography.Text>{node.name}</Typography.Text>
                    <Typography.Paragraph type="secondary" style={{ margin: '2px 0 0', fontSize: 12 }}>
                      {node.required.slice(0, 3).join('；')}
                    </Typography.Paragraph>
                  </div>
                </Tooltip>
              </List.Item>
            )}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            详细知识点按课程定义列出；掌握度按整个主题的训练结果统计，不会把主题下的知识点重复计数。
          </Typography.Text>
        </div>
      )}
    </Card>
  );
}

export default function LearningMapPage({ profile, nodes, defaultTrackId, onGoTrain, onTrackChange }: Props) {
  const [trackId, setTrackId] = useState<LearningTrackId>(defaultTrackId);
  const report = useMemo(() => buildLearningMapReport(trackId, profile, nodes), [trackId, profile, nodes]);
  const graphData = useMemo(() => buildLearningMapGraphData(report), [report]);
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

  const handleSelectNode = useCallback((nodeId: string) => {
    if (nodeId.startsWith('topic:')) {
      const topicId = nodeId.slice('topic:'.length);
      setSelectedTopicId(topicId);
      const branch = report.branches.find((item) => item.topics.some((topic) => topic.id === topicId));
      setSelectedBranchId(branch?.id ?? null);
      return;
    }
    if (nodeId.startsWith('branch:')) {
      const branchId = nodeId.slice('branch:'.length);
      setSelectedBranchId(branchId);
      const branch = report.branches.find((item) => item.id === branchId);
      setSelectedTopicId(branch?.topics[0]?.id ?? null);
    }
  }, [report]);

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

      <Card
        size="small"
        title={<Space><ApartmentOutlined /> 知识体系结构</Space>}
        extra={
          <Space size={6} wrap>
            <Tag color="success">已掌握</Tag>
            <Tag color="warning">待加强</Tag>
            <Tag>未开始</Tag>
          </Space>
        }
        style={{ marginBottom: 12 }}
      >
        <G6LiteCanvas data={graphData} onSelectNode={handleSelectNode} />
      </Card>

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
                    </Space>
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
                    已掌握 {branch.masteredTopics}/{branch.totalTopics} · 待加强 {branch.weakTopics} · 未开始 {branch.unstartedTopics}
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
