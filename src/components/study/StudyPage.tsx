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
} from '@ant-design/icons';
import { Mermaid } from '@ant-design/x';
import { XMarkdown } from '@ant-design/x-markdown';
import '@ant-design/x-markdown/themes/light.css';
import type { KnowledgeNode } from '../../schemas/knowledge';
import type { Question } from '../../schemas/question';
import { SNOWFLAKE_COURSE_TOPICS } from '../../data/learningTracks';
import { IntegratedTutorialsSection } from './IntegratedTutorialsSection';
import {
  SNOWFLAKE_LEARNING_ARTICLES,
  SNOWFLAKE_LEARNING_CONTENT,
  SNOWFLAKE_LEARNING_OVERVIEW,
} from '../../data/learning/snowflake';
import {
  getStudyProgress,
  markArticleCompleted,
  recordArticleOpened,
} from '../../storage/study';
import type { StoredStudyProgress } from '../../storage/db';

const MARKDOWN_COMPONENTS = { mermaid: Mermaid };

interface Props {
  nodes: KnowledgeNode[];
  questions: Question[];
  onGoTrain: (nodeId: string) => void;
}

function labelForTopic(topicId: string): string {
  return SNOWFLAKE_COURSE_TOPICS.find((topic) => topic.id === topicId)?.label ?? topicId;
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

export default function StudyPage({ nodes, questions, onGoTrain }: Props) {
  const [selectedNodeId, setSelectedNodeId] = useState('snowflake-architecture');
  const [selectedArticleId, setSelectedArticleId] = useState<string | undefined>();
  const [progress, setProgress] = useState<StoredStudyProgress[]>([]);
  const [loadingProgress, setLoadingProgress] = useState(true);

  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const contentByNode = useMemo(
    () => new Map(SNOWFLAKE_LEARNING_CONTENT.map((pack) => [pack.nodeId, pack])),
    [],
  );
  const progressByNode = useMemo(
    () => new Map(progress.map((item) => [item.nodeId, item])),
    [progress],
  );
  const selectedNode = nodeById.get(selectedNodeId) ?? nodes[0];
  const selectedPack = selectedNode ? contentByNode.get(selectedNode.id) : undefined;
  const selectedTopic = selectedNode
    ? SNOWFLAKE_COURSE_TOPICS.find((topic) => topic.id === selectedNode.topic)
    : undefined;
  const selectedTopicDescription = selectedTopic && 'description' in selectedTopic
    ? selectedTopic.description
    : undefined;
  const selectedProgress = selectedNode ? progressByNode.get(selectedNode.id) : undefined;
  const selectedArticle =
    selectedPack?.articles.find((article) => article.id === selectedArticleId) ??
    selectedPack?.articles.find((article) => article.id === selectedProgress?.lastArticleId) ??
    selectedPack?.articles[0];
  const articleCount = SNOWFLAKE_LEARNING_ARTICLES.length;
  const completedArticleIds = new Set(progress.flatMap((item) => item.completedArticleIds));
  const completedArticleCount = SNOWFLAKE_LEARNING_ARTICLES.filter((article) => completedArticleIds.has(article.id)).length;
  const articleProgress = articleCount ? Math.round((completedArticleCount / articleCount) * 100) : 0;

  useEffect(() => {
    let active = true;
    setLoadingProgress(true);
    void getStudyProgress('snowflake').then((rows) => {
      if (active) {
        setProgress(rows);
        setLoadingProgress(false);
      }
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (loadingProgress) return;
    if (!selectedNode || !selectedPack?.articles.length) {
      setSelectedArticleId(undefined);
      return;
    }
    const preferred = selectedPack.articles.find(
      (article) => article.id === progressByNode.get(selectedNode.id)?.lastArticleId,
    ) ?? selectedPack.articles[0];
    setSelectedArticleId(preferred.id);
    void recordArticleOpened('snowflake', selectedNode.id, preferred.id).then((updated) => {
      if (!updated) return;
      setProgress((current) => [
        ...current.filter((item) => item.nodeId !== updated.nodeId),
        updated,
      ]);
    });
  }, [selectedNode?.id, selectedPack, selectedProgress?.lastArticleId, loadingProgress]);

  const treeData = useMemo<DataNode[]>(() => {
    const knownTopics = new Set(SNOWFLAKE_COURSE_TOPICS.map((topic) => topic.id));
    const grouped: DataNode[] = SNOWFLAKE_COURSE_TOPICS.map((topic) => {
      const topicNodes = nodes
        .filter((node) => node.topic === topic.id)
        .sort((a, b) => (a.priority === b.priority ? a.name.localeCompare(b.name) : a.priority === 'P0' ? -1 : b.priority === 'P0' ? 1 : a.priority === 'P1' ? -1 : 1));
      return {
        key: `topic:${topic.id}`,
        title: (
          <Space size={6}>
            <Typography.Text strong>{topic.label}</Typography.Text>
            <Typography.Text type="secondary">{topicNodes.length}</Typography.Text>
          </Space>
        ),
        selectable: false,
        children: topicNodes.map((node) => {
          const pack = contentByNode.get(node.id);
          const item = progressByNode.get(node.id);
          const completed = Boolean(pack?.articles.length) &&
            pack!.articles.every((article) => item?.completedArticleIds.includes(article.id));
          const hasContent = Boolean(pack?.articles.length);
          return {
            key: `node:${node.id}`,
            title: (
              <Space size={6} wrap>
                <Typography.Text>{node.name}</Typography.Text>
                {node.priority === 'P0' && <Tag color="red">P0</Tag>}
                {completed
                  ? <CheckCircleFilled style={{ color: '#389e0d' }} />
                  : hasContent
                    ? <Tag color="blue">有教材</Tag>
                    : <Tag>待建设</Tag>}
              </Space>
            ),
          };
        }),
      };
    }).filter((item) => Boolean(item.children?.length));
    const unregistered = nodes.filter((node) => !knownTopics.has(node.topic));
    if (unregistered.length) {
      grouped.push({
        key: 'topic:other',
        title: <Typography.Text strong>其他课程节点</Typography.Text>,
        selectable: false,
        children: unregistered.map((node) => ({
          key: `node:${node.id}`,
          title: <Typography.Text>{node.name}</Typography.Text>,
        })),
      });
    }
    return grouped;
  }, [nodes, contentByNode, progressByNode]);

  const questionCount = selectedNode
    ? questions.filter((question) => question.topic === selectedNode.id).length
    : 0;

  const handleComplete = async () => {
    if (!selectedNode || !selectedArticle) return;
    const updated = await markArticleCompleted('snowflake', selectedNode.id, selectedArticle.id);
    if (updated) {
      setProgress((current) => [
        ...current.filter((item) => item.nodeId !== updated.nodeId),
        updated,
      ]);
    }
  };

  const completedIds = selectedProgress?.completedArticleIds ?? [];
  const selectedArticleCompleted = selectedArticle
    ? completedIds.includes(selectedArticle.id)
    : false;

  return (
    <div style={{ width: '100%', maxWidth: 1440, margin: '0 auto' }}>
      <Space align="center" style={{ marginBottom: 8 }} wrap>
        <BookOutlined />
        <Typography.Title level={3} style={{ margin: 0 }}>Snowflake 学习</Typography.Title>
        <Tag color="blue">课程教材</Tag>
      </Space>
      <Typography.Paragraph type="secondary" style={{ maxWidth: 980 }}>
        {SNOWFLAKE_LEARNING_OVERVIEW.introduction}
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary" style={{ maxWidth: 980 }}>
        <Typography.Text strong>适合人群：</Typography.Text> {SNOWFLAKE_LEARNING_OVERVIEW.audience}
      </Typography.Paragraph>

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Typography.Text type="secondary">知识节点</Typography.Text>
            <Typography.Title level={3} style={{ margin: '4px 0 0' }}>{nodes.length}</Typography.Title>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Typography.Text type="secondary">课程教程</Typography.Text>
            <Typography.Title level={3} style={{ margin: '4px 0 0' }}>{SNOWFLAKE_LEARNING_CONTENT.length}</Typography.Title>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Typography.Text type="secondary">教材完成</Typography.Text>
            <Typography.Title level={3} style={{ margin: '4px 0 0' }}>{completedArticleCount} / {articleCount}</Typography.Title>
            <Progress percent={articleProgress} size="small" showInfo={false} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Typography.Text type="secondary">题库题目</Typography.Text>
            <Typography.Title level={3} style={{ margin: '4px 0 0' }}>{questions.length}</Typography.Title>
          </Card>
        </Col>
      </Row>

      <IntegratedTutorialsSection nodes={nodes} onSelectNode={setSelectedNodeId} />

      <Row gutter={[16, 16]} align="top">
        <Col xs={24} md={9} xl={7}>
          <Card
            size="small"
            title="课程知识体系"
            extra={<Typography.Text type="secondary">{nodes.length} 个节点</Typography.Text>}
            styles={{ body: { maxHeight: '68vh', overflowY: 'auto' } }}
          >
            <Tree
              blockNode
              defaultExpandAll={false}
              defaultExpandedKeys={['topic:snowflake']}
              selectedKeys={selectedNode ? [`node:${selectedNode.id}`] : []}
              treeData={treeData}
              onSelect={(keys) => {
                const key = String(keys[0] ?? '');
                if (key.startsWith('node:')) setSelectedNodeId(key.slice(5));
              }}
            />
          </Card>
          <Card size="small" title="学习目标" style={{ marginTop: 12 }}>
            <List
              size="small"
              split={false}
              dataSource={SNOWFLAKE_LEARNING_OVERVIEW.objectives}
              renderItem={(item) => <List.Item style={{ paddingBlock: 4 }}>{item}</List.Item>}
            />
          </Card>
          <Card size="small" title="学习路线" style={{ marginTop: 12 }}>
            <List
              size="small"
              split={false}
              dataSource={SNOWFLAKE_LEARNING_OVERVIEW.roadmap}
              renderItem={(item, index) => (
                <List.Item style={{ paddingBlock: 4 }}>
                  <Typography.Text type="secondary" style={{ marginRight: 8 }}>{index + 1}.</Typography.Text>
                  {item}
                </List.Item>
              )}
            />
          </Card>
        </Col>

        <Col xs={24} md={15} xl={17}>
          {!selectedNode ? (
            <Card><Empty description="当前课程没有知识节点" /></Card>
          ) : (
            <Card
              title={
                <div>
                  <Typography.Title level={4} style={{ margin: 0 }}>{selectedNode.name}</Typography.Title>
                  <Space wrap size={6} style={{ marginTop: 6 }}>
                    <Tag>{labelForTopic(selectedNode.topic)}</Tag>
                    <Tag color={selectedNode.priority === 'P0' ? 'red' : 'blue'}>{selectedNode.priority}</Tag>
                    {selectedPack ? <Tag color="success">教材已建立</Tag> : <Tag>教材待建设</Tag>}
                  </Space>
                </div>
              }
              extra={
                <Button
                  type="primary"
                  icon={<RocketOutlined />}
                  disabled={questionCount === 0}
                  onClick={() => onGoTrain(selectedNode.id)}
                >
                  专项训练{questionCount ? ` · ${questionCount} 题` : ''}
                </Button>
              }
            >
              <Typography.Paragraph type="secondary">{selectedNode.summary}</Typography.Paragraph>
              {selectedTopicDescription && (
                <Typography.Paragraph type="secondary">{selectedTopicDescription}</Typography.Paragraph>
              )}

              {selectedPack && selectedArticle ? (
                <>
                  <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
                    <Space wrap>
                      <Typography.Text strong>{selectedArticle.title}</Typography.Text>
                      <Tag color="blue">{selectedArticle.level === 'foundation' ? '基础' : selectedArticle.level === 'intermediate' ? '中级' : '进阶'}</Tag>
                      <Typography.Text type="secondary"><ClockCircleOutlined /> {selectedArticle.estimatedMinutes} 分钟</Typography.Text>
                    </Space>
                    {selectedPack.articles.length > 1 && (
                      <Collapse
                        ghost
                        size="small"
                        items={[{
                          key: 'articles',
                          label: `本知识点的文章（${selectedPack.articles.length}）`,
                          children: selectedPack.articles.map((article) => (
                            <Button
                              key={article.id}
                              type={article.id === selectedArticle.id ? 'primary' : 'text'}
                              block
                              onClick={() => setSelectedArticleId(article.id)}
                            >
                              {article.title}
                            </Button>
                          )),
                        }]}
                      />
                    )}
                  </Space>
                  <Divider style={{ marginBlock: 12 }} />
                  <div className="study-article">
                    <XMarkdown content={selectedArticle.content} components={MARKDOWN_COMPONENTS} className="x-markdown-light" />
                  </div>
                  <Divider />
                  <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
                    <Typography.Text type="secondary">
                      {selectedArticleCompleted ? '已标记完成' : '阅读后可标记完成；阅读完成不等于考试掌握。'}
                    </Typography.Text>
                    <Button
                      type={selectedArticleCompleted ? 'default' : 'primary'}
                      icon={selectedArticleCompleted ? <CheckCircleFilled /> : <ReadOutlined />}
                      disabled={selectedArticleCompleted || loadingProgress}
                      onClick={() => void handleComplete()}
                    >
                      {selectedArticleCompleted ? '已完成' : '标记为已读'}
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
                            {reference.publisher} · {reference.verifiedAt === '待核验' ? '来源待复核' : `核对日期 ${reference.verifiedAt}`}
                          </Typography.Text>
                          <Typography.Text type="secondary">{reference.relevance}</Typography.Text>
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
                    message="该知识点的核心教材正在建设"
                    description="知识点定义、学习要点和常见误解已经纳入知识体系；后续会补充系统教材、官方资料与工程案例。"
                    style={{ marginBottom: 16 }}
                  />
                  <Typography.Title level={5}>需要掌握</Typography.Title>
                  <List size="small" dataSource={selectedNode.required} renderItem={(item) => <List.Item>{item}</List.Item>} />
                  {selectedNode.misconceptions.length > 0 && (
                    <>
                      <Typography.Title level={5}>常见误区</Typography.Title>
                      <List size="small" dataSource={selectedNode.misconceptions} renderItem={(item) => <List.Item>{item}</List.Item>} />
                    </>
                  )}
                </>
              )}
            </Card>
          )}
        </Col>
      </Row>
      <Typography.Paragraph type="secondary" style={{ marginTop: 12, fontSize: 12 }}>
        {SNOWFLAKE_LEARNING_OVERVIEW.notes}
      </Typography.Paragraph>
    </div>
  );
}
