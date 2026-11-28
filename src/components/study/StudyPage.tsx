import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
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
  SNOWFLAKE_LEARNING_ARTICLES,
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

const TOPIC_DESCRIPTIONS = new Map<string, string>(
  [
    ...TAXONOMY.flatMap((domain) => domain.topics),
    ...SNOWFLAKE_COURSE_TOPICS,
    ...SECURITY_ARCHITECTURE_COURSE_TOPICS,
    ...CAMPUS_EMPLOYMENT_COURSE_TOPICS,
    ...SAP_IT_SERVICE_COURSE_TOPICS,
    ...SAP_COURSERA_COURSE_TOPICS,
    ...SAP_JUNIOR_PRACTICE_TOPICS,
  ].flatMap((topic) =>
    'description' in topic && topic.description
      ? [[topic.id, topic.description] as [string, string]]
      : [],
  ),
);

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
            const hasArticle = isSnowflake && contentByNode.has(node.id);
            return {
              key: `node:${node.id}`,
              title: (
                <Space size={6} wrap>
                  <Typography.Text>{node.name}</Typography.Text>
                  {node.priority === 'P0' && <Tag color="red">P0</Tag>}
                  {done
                    ? <CheckCircleFilled style={{ color: '#389e0d' }} />
                    : hasArticle
                      ? <Tag color="blue">独立教程</Tag>
                      : <Tag>知识摘要</Tag>}
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
  const topicDescription = selectedNode
    ? TOPIC_DESCRIPTIONS.get(selectedNode.topic)
    : undefined;

  return (
    <div style={{ width: '100%', maxWidth: 1440, margin: '0 auto' }}>
      <Space align="center" style={{ marginBottom: 8 }} wrap>
        <BookOutlined />
        <Typography.Title level={3} style={{ margin: 0 }}>
          {track.shortTitle} · 学习
        </Typography.Title>
        <Tag color="blue">知识学习</Tag>
      </Space>
      <Typography.Paragraph type="secondary" style={{ maxWidth: 980 }}>
        {isSnowflake
          ? SNOWFLAKE_LEARNING_OVERVIEW.introduction
          : track.description}
      </Typography.Paragraph>

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Typography.Text type="secondary">知识点</Typography.Text>
            <Typography.Title level={3} style={{ margin: '4px 0 0' }}>
              {nodes.length}
            </Typography.Title>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Typography.Text type="secondary">
              {isSnowflake ? '独立教程' : '知识摘要'}
            </Typography.Text>
            <Typography.Title level={3} style={{ margin: '4px 0 0' }}>
              {isSnowflake ? SNOWFLAKE_LEARNING_ARTICLES.length : nodes.length}
            </Typography.Title>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Typography.Text type="secondary">已完成学习资料</Typography.Text>
            <Typography.Title level={3} style={{ margin: '4px 0 0' }}>
              {completedNodeCount} / {nodes.length}
            </Typography.Title>
            <Progress percent={completionPercent} size="small" showInfo={false} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Typography.Text type="secondary">关联题目</Typography.Text>
            <Typography.Title level={3} style={{ margin: '4px 0 0' }}>
              {questions.length}
            </Typography.Title>
          </Card>
        </Col>
      </Row>

      {isSnowflake && (
        <IntegratedTutorialsSection nodes={nodes} onSelectNode={setSelectedNodeId} />
      )}

      <Row gutter={[16, 16]} align="top">
        <Col xs={24} md={9} xl={7}>
          <Card
            size="small"
            title="课程知识体系"
            extra={<Typography.Text type="secondary">{nodes.length} 个节点</Typography.Text>}
            styles={{ body: { maxHeight: '68vh', overflowY: 'auto' } }}
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
          <Card size="small" title="学习目标" style={{ marginTop: 12 }}>
            {isSnowflake ? (
              <List
                size="small"
                split={false}
                dataSource={courseObjectives}
                renderItem={(item) => <List.Item style={{ paddingBlock: 4 }}>{item}</List.Item>}
              />
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
          </Card>
          {isSnowflake && (
            <Card size="small" title="学习路线" style={{ marginTop: 12 }}>
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
            </Card>
          )}
        </Col>

        <Col xs={24} md={15} xl={17}>
          {!selectedNode ? (
            <Card><Empty description="当前课程没有知识节点" /></Card>
          ) : (
            <Card
              title={
                <div>
                  <Typography.Title level={4} style={{ margin: 0 }}>
                    {selectedNode.name}
                  </Typography.Title>
                  <Space wrap size={6} style={{ marginTop: 6 }}>
                    <Tag>{labelForTopic(selectedNode.topic)}</Tag>
                    <Tag color={selectedNode.priority === 'P0' ? 'red' : 'blue'}>
                      {selectedNode.priority}
                    </Tag>
                    {selectedPack
                      ? <Tag color="success">独立教程</Tag>
                      : <Tag>知识摘要</Tag>}
                    {selectedNodeCompleted && <Tag color="success">已完成资料学习</Tag>}
                  </Space>
                </div>
              }
              extra={
                <Space wrap>
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
              <Typography.Paragraph type="secondary">
                {selectedNode.summary}
              </Typography.Paragraph>
              {topicDescription && (
                <Typography.Paragraph type="secondary">
                  {topicDescription}
                </Typography.Paragraph>
              )}

              {selectedPack && selectedArticle ? (
                <>
                  <Space wrap>
                    <Typography.Text strong>{selectedArticle.title}</Typography.Text>
                    <Tag color="blue">
                      {selectedArticle.level === 'foundation' ? '基础'
                        : selectedArticle.level === 'intermediate' ? '中级' : '进阶'}
                    </Tag>
                    <Typography.Text type="secondary">
                      <ClockCircleOutlined /> {selectedArticle.estimatedMinutes} 分钟
                    </Typography.Text>
                  </Space>
                  <Divider style={{ marginBlock: 12 }} />
                  <div className="study-article">
                    <XMarkdown
                      content={selectedArticle.content}
                      components={MARKDOWN_COMPONENTS}
                      className="x-markdown-light"
                    />
                  </div>
                  <Divider />
                  <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
                    <Typography.Text type="secondary">
                      {selectedArticleCompleted
                        ? '已标记阅读完成；这不代表已经掌握。'
                        : '阅读完成只记录学习资料进度，不会提高考试掌握度。'}
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
                  <Alert
                    type="info"
                    showIcon
                    message="当前知识点提供结构化学习摘要"
                    description="这里展示知识定义、必须掌握的内容和常见误区，不把摘要伪装成完整教材。可以让 Copilot 围绕这些材料展开讲解。"
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
                  <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
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
