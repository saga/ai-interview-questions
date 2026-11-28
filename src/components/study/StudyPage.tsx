import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Collapse,
  Col,
  Divider,
  Empty,
  List,
  Progress,
  Row,
  Space,
  Tag,
  Tree,
  Typography,
} from 'antd';
import type { DataNode } from 'antd/es/tree';
import {
  BookOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  ReadOutlined,
  RocketOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import { XMarkdown } from '@ant-design/x-markdown';
import '@ant-design/x-markdown/themes/light.css';
import type { KnowledgeNode } from '../../schemas/knowledge';
import type { Question } from '../../schemas/question';
import {
  CAMPUS_EMPLOYMENT_COURSE_TOPICS,
  SAP_COURSERA_COURSE_TOPICS,
  SAP_IT_SERVICE_COURSE_TOPICS,
  SAP_JUNIOR_PRACTICE_TOPICS,
  SECURITY_ARCHITECTURE_COURSE_TOPICS,
  SNOWFLAKE_COURSE_TOPICS,
  getLearningTrack,
  type LearningTrackId,
} from '../../data/learningTracks';
import { TAXONOMY, topicLabel as taxonomyTopicLabel } from '../../data/taxonomy';
import { IntegratedTutorialsSection, MARKDOWN_COMPONENTS } from './IntegratedTutorialsSection';
import {
  SNOWFLAKE_LEARNING_CONTENT,
  SNOWFLAKE_LEARNING_OVERVIEW,
} from '../../data/learning/snowflake';
import {
  getStudyProgress,
  markArticleCompleted,
  markNodeReviewed,
  recordArticleOpened,
} from '../../storage/study';
import type { StoredStudyProgress } from '../../storage/db';
import { questionsForKnowledgeNode } from '../../domain/learningTracks';

interface Props {
  trackId: LearningTrackId;
  nodes: KnowledgeNode[];
  questions: Question[];
  onGoTrain: (nodeId: string) => void;
  onAskTutor: (node: KnowledgeNode, articleContent?: string) => void;
}

const TOPIC_LABELS = new Map<string, string>([
  ...TAXONOMY.flatMap((domain) => domain.topics),
  ...SNOWFLAKE_COURSE_TOPICS,
  ...SECURITY_ARCHITECTURE_COURSE_TOPICS,
  ...CAMPUS_EMPLOYMENT_COURSE_TOPICS,
  ...SAP_IT_SERVICE_COURSE_TOPICS,
  ...SAP_COURSERA_COURSE_TOPICS,
  ...SAP_JUNIOR_PRACTICE_TOPICS,
].map(({ id, label }) => [id, label]));

function labelForTopic(topicId: string): string {
  return TOPIC_LABELS.get(topicId) ?? taxonomyTopicLabel(topicId);
}

function referenceTypeLabel(type: string): string {
  switch (type) {
    case 'official': return '官方文档';
    case 'paper': return '论文';
    case 'standard': return '标准';
    case 'engineering': return '工程实践';
    case 'case': return '案例';
    case 'book': return '书籍';
    default: return type;
  }
}

export default function StudyPage({ trackId, nodes, questions, onGoTrain, onAskTutor }: Props) {
  const track = getLearningTrack(trackId);
  const [selectedNodeId, setSelectedNodeId] = useState(nodes[0]?.id ?? '');
  const [progress, setProgress] = useState<StoredStudyProgress[]>([]);
  const [loadingProgress, setLoadingProgress] = useState(true);

  const isSnowflake = trackId === 'snowflake';
  const contentByNode = useMemo(
    () => new Map(SNOWFLAKE_LEARNING_CONTENT.map((pack) => [pack.nodeId, pack])),
    [],
  );
  const progressByNode = useMemo(
    () => new Map(progress.map((item) => [item.nodeId, item])),
    [progress],
  );

  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? nodes[0];
  const selectedPack = isSnowflake && selectedNode
    ? contentByNode.get(selectedNode.id)
    : undefined;
  const selectedArticle = selectedPack?.articles[0];
  const selectedProgress = selectedNode
    ? progressByNode.get(selectedNode.id)
    : undefined;
  const selectedArticleCompleted = Boolean(
    selectedArticle && selectedProgress?.completedArticleIds.includes(selectedArticle.id),
  );

  const completedNode = (nodeId: string): boolean => {
    const row = progressByNode.get(nodeId);
    if (row?.completedNode) return true;
    const pack = isSnowflake ? contentByNode.get(nodeId) : undefined;
    return Boolean(
      pack?.articles.length &&
      pack.articles.every((article) => row?.completedArticleIds.includes(article.id)),
    );
  };

  const completedNodeCount = nodes.filter((node) => completedNode(node.id)).length;
  const completionPercent = nodes.length
    ? Math.round((completedNodeCount / nodes.length) * 100)
    : 0;
  const questionCount = selectedNode
    ? questionsForKnowledgeNode(questions, selectedNode.id).length
    : 0;

  useEffect(() => {
    let active = true;
    setLoadingProgress(true);
    setProgress([]);
    void getStudyProgress(trackId).then((rows) => {
      if (!active) return;
      setProgress(rows);
      setLoadingProgress(false);
    });
    return () => { active = false; };
  }, [trackId]);

  useEffect(() => {
    if (!nodes.length) {
      setSelectedNodeId('');
      return;
    }
    if (!nodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(nodes[0].id);
    }
  }, [nodes, selectedNodeId]);

  useEffect(() => {
    if (loadingProgress || !selectedNode || !selectedArticle) return;
    void recordArticleOpened(trackId, selectedNode.id, selectedArticle.id).then((updated) => {
      if (!updated) return;
      setProgress((current) => [
        ...current.filter((item) => item.nodeId !== updated.nodeId),
        updated,
      ]);
    });
  }, [trackId, selectedNode?.id, selectedArticle?.id, loadingProgress]);

  const treeData = useMemo<DataNode[]>(() => {
    const grouped = new Map<string, KnowledgeNode[]>();
    for (const node of nodes) {
      const group = grouped.get(node.topic) ?? [];
      group.push(node);
      grouped.set(node.topic, group);
    }
    return [...grouped.entries()]
      .sort(([a], [b]) =>
        labelForTopic(a).localeCompare(labelForTopic(b), 'zh-CN'),
      )
      .map(([topicId, topicNodes]) => ({
        key: `topic:${topicId}`,
        title: (
          <Space size={6}>
            <Typography.Text strong>{labelForTopic(topicId)}</Typography.Text>
            <Typography.Text type="secondary">{topicNodes.length}</Typography.Text>
          </Space>
        ),
        selectable: false,
        children: topicNodes
          .slice()
          .sort((a, b) =>
            a.priority === b.priority
              ? a.name.localeCompare(b.name, 'zh-CN')
              : a.priority === 'P0' ? -1
                : b.priority === 'P0' ? 1
                  : a.priority === 'P1' ? -1 : 1,
          )
          .map((node) => {
            const done = completedNode(node.id);
            return {
              key: `node:${node.id}`,
              title: (
                <Space size={6} wrap>
                  <Typography.Text>{node.name}</Typography.Text>
                  {node.priority === 'P0' && <Tag color="red">P0</Tag>}
                  {done && (
                    <CheckCircleFilled
                      style={{ color: '#389e0d' }}
                      title="已完成学习资料"
                    />
                  )}
                </Space>
              ),
            };
          }),
      }));
  }, [nodes, progressByNode, trackId, contentByNode]);

  const handleComplete = async () => {
    if (!selectedNode) return;
    const updated = selectedArticle
      ? await markArticleCompleted(trackId, selectedNode.id, selectedArticle.id)
      : await markNodeReviewed(trackId, selectedNode.id);
    if (updated) {
      setProgress((current) => [
        ...current.filter((item) => item.nodeId !== updated.nodeId),
        updated,
      ]);
    }
  };

  const selectedNodeCompleted = selectedNode ? completedNode(selectedNode.id) : false;
  const courseObjectives = isSnowflake ? SNOWFLAKE_LEARNING_OVERVIEW.objectives : [];
  const courseRoadmap = isSnowflake ? SNOWFLAKE_LEARNING_OVERVIEW.roadmap : [];
  const articleBody = useMemo(
    () => selectedArticle?.content.replace(/^#\s+[^\r\n]+(?:\r?\n)+/, '') ?? '',
    [selectedArticle?.content],
  );

  return (
    <div className="study-page">
      <div className="study-toolbar">
        <Space align="center" size={10}>
          <BookOutlined />
          <Typography.Text strong>{track.shortTitle}</Typography.Text>
          <Typography.Text type="secondary">{nodes.length} 个知识点</Typography.Text>
        </Space>
        <Space align="center" size={12} wrap className="study-toolbar-tools">
          <Typography.Text type="secondary" className="study-progress-label">
            阅读进度 {completedNodeCount}/{nodes.length}
          </Typography.Text>
          <Progress
            percent={completionPercent}
            size="small"
            showInfo={false}
            style={{ width: 112, margin: 0 }}
          />
          {isSnowflake && (
            <IntegratedTutorialsSection nodes={nodes} onSelectNode={setSelectedNodeId} />
          )}
        </Space>
      </div>

      <Row gutter={[16, 16]} align="top" className="study-layout">
        <Col xs={24} md={8} xl={5}>
          <div className="study-directory">
            <Card
              size="small"
              title="课程目录"
              extra={<Typography.Text type="secondary">{nodes.length} 项</Typography.Text>}
              className="study-directory-card"
              styles={{ body: { maxHeight: 'calc(100dvh - 220px)', overflowY: 'auto' } }}
            >
              {loadingProgress ? (
                <Typography.Text type="secondary">正在加载学习进度…</Typography.Text>
              ) : (
                <Tree
                  blockNode
                  defaultExpandAll={false}
                  defaultExpandedKeys={nodes[0] ? [`topic:${nodes[0].topic}`] : []}
                  selectedKeys={selectedNode ? [`node:${selectedNode.id}`] : []}
                  treeData={treeData}
                  onSelect={(keys) => {
                    const key = String(keys[0] ?? '');
                    if (key.startsWith('node:')) setSelectedNodeId(key.slice(5));
                  }}
                />
              )}
            </Card>

            <Collapse
              ghost
              size="small"
              className="study-course-outline"
              items={[{
                key: 'outline',
                label: '课程目标与学习路线',
                children: (
                  <>
                    {isSnowflake ? (
                      <>
                        <Typography.Paragraph type="secondary">
                          {SNOWFLAKE_LEARNING_OVERVIEW.introduction}
                        </Typography.Paragraph>
                        <List
                          size="small"
                          split={false}
                          dataSource={courseObjectives}
                          renderItem={(item) => <List.Item style={{ paddingBlock: 4 }}>{item}</List.Item>}
                        />
                        <Divider style={{ marginBlock: 8 }} />
                        <List
                          size="small"
                          split={false}
                          dataSource={courseRoadmap}
                          renderItem={(item, index) => (
                            <List.Item style={{ paddingBlock: 4 }}>
                              <Typography.Text type="secondary" style={{ marginRight: 8 }}>
                                {index + 1}.
                              </Typography.Text>
                              {item}
                            </List.Item>
                          )}
                        />
                      </>
                    ) : (
                      <>
                        <Typography.Paragraph>{track.description}</Typography.Paragraph>
                        {'learningPathUrl' in track && (
                          <Typography.Link href={track.learningPathUrl} target="_blank" rel="noreferrer">
                            查看课程路线与资料
                          </Typography.Link>
                        )}
                      </>
                    )}
                  </>
                ),
              }]}
            />
          </div>
        </Col>

        <Col xs={24} md={16} xl={19}>
          {!selectedNode ? (
            <Card><Empty description="当前课程没有知识节点" /></Card>
          ) : (
            <Card
              className="study-reader-card"
              title={
                <div className="study-reader-heading">
                  <Typography.Title level={4} style={{ margin: 0 }}>
                    {selectedNode.name}
                  </Typography.Title>
                  <Space wrap size={6} style={{ marginTop: 6 }}>
                    <Tag>{labelForTopic(selectedNode.topic)}</Tag>
                    <Tag color={selectedNode.priority === 'P0' ? 'red' : 'blue'}>
                      {selectedNode.priority}
                    </Tag>
                    {selectedArticle && (
                      <>
                        <Tag color="success">完整教程</Tag>
                        <Typography.Text type="secondary" className="study-reading-time">
                          <ClockCircleOutlined /> {selectedArticle.estimatedMinutes} 分钟
                        </Typography.Text>
                      </>
                    )}
                    {!selectedPack && <Tag>知识摘要</Tag>}
                    {selectedNodeCompleted && <Tag color="success">已完成资料学习</Tag>}
                  </Space>
                </div>
              }
              extra={
                <Space wrap className="study-reader-actions">
                  <Button
                    icon={<RobotOutlined />}
                    onClick={() => onAskTutor(selectedNode, selectedArticle?.content)}
                  >
                    向 Copilot 学习
                  </Button>
                  <Button
                    type="primary"
                    icon={<RocketOutlined />}
                    disabled={questionCount === 0}
                    onClick={() => onGoTrain(selectedNode.id)}
                  >
                    知识点检测{questionCount ? ` · ${questionCount} 题` : ''}
                  </Button>
                </Space>
              }
            >
              {selectedPack && selectedArticle ? (
                <>
                  <div className="study-article">
                    <XMarkdown
                      content={articleBody}
                      components={MARKDOWN_COMPONENTS}
                      className="x-markdown-light"
                    />
                  </div>
                  <Divider />
                  <Space className="study-completion-row" style={{ width: '100%', justifyContent: 'space-between' }} wrap>
                    <Typography.Text type="secondary">
                      {selectedArticleCompleted
                        ? '已标记阅读完成；这不代表已经掌握。'
                        : '读完后标记进度；掌握程度以独立检测结果为准。'}
                    </Typography.Text>
                    <Button
                      type={selectedArticleCompleted ? 'default' : 'primary'}
                      icon={selectedArticleCompleted ? <CheckCircleFilled /> : <ReadOutlined />}
                      disabled={selectedArticleCompleted || loadingProgress}
                      onClick={() => void handleComplete()}
                    >
                      {selectedArticleCompleted ? '已完成阅读' : '标记为已读'}
                    </Button>
                  </Space>
                  <Divider />
                  <Typography.Title level={5}>参考资料</Typography.Title>
                  <List
                    size="small"
                    dataSource={selectedPack.references}
                    renderItem={(reference) => (
                      <List.Item>
                        <Space direction="vertical" size={2} style={{ width: '100%' }}>
                          <Space wrap>
                            <Tag>{referenceTypeLabel(reference.type)}</Tag>
                            <Typography.Link href={reference.url} target="_blank" rel="noreferrer">
                              {reference.title}
                            </Typography.Link>
                          </Space>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            {reference.publisher} · {reference.verifiedAt === '待核验'
                              ? '来源待复核'
                              : `核对日期 ${reference.verifiedAt}`}
                          </Typography.Text>
                          <Typography.Text type="secondary">
                            {reference.relevance}
                          </Typography.Text>
                        </Space>
                      </List.Item>
                    )}
                  />
                </>
              ) : (
                <>
                  <Typography.Paragraph className="study-node-summary">
                    {selectedNode.summary}
                  </Typography.Paragraph>
                  <Alert
                    type="info"
                    showIcon
                    message="当前节点提供的是学习摘要"
                    description="摘要用于建立知识地图和复习重点，不等同于完整教材。可以继续向 Copilot 追问，也可以使用知识点检测检查理解。"
                    style={{ marginBottom: 16 }}
                  />
                  <Typography.Title level={5}>需要掌握</Typography.Title>
                  <List
                    size="small"
                    dataSource={selectedNode.required}
                    renderItem={(item) => <List.Item>{item}</List.Item>}
                  />
                  {selectedNode.misconceptions.length > 0 && (
                    <>
                      <Typography.Title level={5}>常见误区</Typography.Title>
                      <List
                        size="small"
                        dataSource={selectedNode.misconceptions}
                        renderItem={(item) => <List.Item>{item}</List.Item>}
                      />
                    </>
                  )}
                  <Divider />
                  <Space className="study-completion-row" style={{ width: '100%', justifyContent: 'space-between' }} wrap>
                    <Typography.Text type="secondary">
                      {selectedNodeCompleted
                        ? '已完成学习摘要复习；不代表知识掌握。'
                        : '查看摘要后可以标记已复习。'}
                    </Typography.Text>
                    <Button
                      type={selectedNodeCompleted ? 'default' : 'primary'}
                      icon={selectedNodeCompleted ? <CheckCircleFilled /> : <ReadOutlined />}
                      disabled={selectedNodeCompleted || loadingProgress}
                      onClick={() => void handleComplete()}
                    >
                      {selectedNodeCompleted ? '已完成复习' : '标记为已复习'}
                    </Button>
                  </Space>
                </>
              )}
            </Card>
          )}
        </Col>
      </Row>
    </div>
  );
}
