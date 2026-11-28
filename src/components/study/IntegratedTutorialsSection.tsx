import { isValidElement, useMemo, useState, type ReactNode } from 'react';
import { BookOutlined, LeftOutlined, ReadOutlined } from '@ant-design/icons';
import { Button, Divider, List, Modal, Space, Tag, Typography } from 'antd';
import { Mermaid } from '@ant-design/x';
import { XMarkdown, type ComponentProps as MarkdownComponentProps } from '@ant-design/x-markdown';
import '@ant-design/x-markdown/themes/light.css';
import type { KnowledgeNode } from '../../schemas/knowledge';
import { SNOWFLAKE_INTEGRATED_TUTORIALS } from '../../data/learning/snowflake';

function mermaidSource(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(mermaidSource).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return mermaidSource(node.props.children);
  return '';
}

function MarkdownMermaid({ children, className, style }: MarkdownComponentProps) {
  return <Mermaid className={className} style={style}>{mermaidSource(children)}</Mermaid>;
}

export const MARKDOWN_COMPONENTS = { mermaid: MarkdownMermaid };

interface Props {
  nodes: KnowledgeNode[];
  onSelectNode: (nodeId: string) => void;
}

function levelLabel(level: string): string {
  return level === 'foundation' ? '基础' : level === 'intermediate' ? '中级' : '进阶';
}

export function IntegratedTutorialsSection({ nodes, onSelectNode }: Props) {
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string>();
  const activeTutorial = SNOWFLAKE_INTEGRATED_TUTORIALS.find((item) => item.id === activeId);
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  const close = () => {
    setOpen(false);
    setActiveId(undefined);
  };

  return (
    <>
      <Button
        size="middle"
        icon={<BookOutlined />}
        onClick={() => { setActiveId(undefined); setOpen(true); }}
      >
        端到端教程 · {SNOWFLAKE_INTEGRATED_TUTORIALS.length} 篇
      </Button>

      <Modal
        open={open}
        title={activeTutorial?.title ?? '端到端工程教程'}
        onCancel={close}
        footer={null}
        width={1040}
        styles={{ body: { maxHeight: '78vh', overflowY: 'auto' } }}
        destroyOnHidden
      >
        {activeTutorial ? (
          <>
            <Button
              type="link"
              icon={<LeftOutlined />}
              onClick={() => setActiveId(undefined)}
              style={{ paddingInline: 0, marginBottom: 12 }}
            >
              返回教程目录
            </Button>
            <Space wrap style={{ marginBottom: 12 }}>
              <Tag color="blue">{levelLabel(activeTutorial.level)}</Tag>
              <Tag>{activeTutorial.estimatedMinutes} 分钟</Tag>
              <Tag>{activeTutorial.linkedKnowledgeNodeIds.length} 个关联知识点</Tag>
            </Space>
            <Typography.Paragraph className="study-tutorial-intro">
              {activeTutorial.description}
            </Typography.Paragraph>
            <div className="study-article">
              <XMarkdown
                content={activeTutorial.content.replace(/^#\s+[^\r\n]+(?:\r?\n)+/, '')}
                components={MARKDOWN_COMPONENTS}
                className="x-markdown-light"
              />
            </div>
            <Divider />
            <Typography.Title level={5}>继续学习关联知识点</Typography.Title>
            <Space wrap>
              {activeTutorial.linkedKnowledgeNodeIds.map((nodeId) => {
                const node = nodeById.get(nodeId);
                return node ? (
                  <Button
                    key={nodeId}
                    type="link"
                    size="small"
                    onClick={() => { onSelectNode(nodeId); close(); }}
                  >
                    {node.name}
                  </Button>
                ) : null;
              })}
            </Space>
            {activeTutorial.references.length > 0 && (
              <>
                <Divider />
                <Typography.Title level={5}>参考资料</Typography.Title>
                <List
                  size="small"
                  dataSource={activeTutorial.references}
                  renderItem={(reference) => (
                    <List.Item>
                      <Typography.Link href={reference.url} target="_blank" rel="noreferrer">
                        {reference.title}
                      </Typography.Link>
                      <Typography.Text type="secondary">{reference.publisher}</Typography.Text>
                    </List.Item>
                  )}
                />
              </>
            )}
          </>
        ) : (
          <>
            <Typography.Paragraph type="secondary">
              从完整工程场景出发，按设计、实施、验证和运行维护串起相关知识点。
            </Typography.Paragraph>
            <List
              itemLayout="vertical"
              dataSource={SNOWFLAKE_INTEGRATED_TUTORIALS}
              renderItem={(tutorial) => (
                <List.Item
                  actions={[
                    <Button
                      key="read"
                      type="link"
                      icon={<ReadOutlined />}
                      onClick={() => setActiveId(tutorial.id)}
                    >
                      阅读教程
                    </Button>,
                  ]}
                >
                  <List.Item.Meta
                    title={
                      <Space wrap size={8}>
                        <Typography.Text strong>{tutorial.title}</Typography.Text>
                        <Tag>{levelLabel(tutorial.level)}</Tag>
                      </Space>
                    }
                    description={
                      <>
                        <Typography.Paragraph style={{ marginBottom: 4 }}>
                          {tutorial.description}
                        </Typography.Paragraph>
                        <Typography.Text type="secondary">
                          {tutorial.estimatedMinutes} 分钟 · {tutorial.linkedKnowledgeNodeIds.length} 个关联知识点
                        </Typography.Text>
                      </>
                    }
                  />
                </List.Item>
              )}
            />
          </>
        )}
      </Modal>
    </>
  );
}
