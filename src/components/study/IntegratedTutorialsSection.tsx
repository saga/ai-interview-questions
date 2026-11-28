import { isValidElement, useMemo, useState, type ReactNode } from 'react';
import { Button, Card, Collapse, Col, Divider, Modal, Row, Space, Tag, Typography } from 'antd';
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

export function IntegratedTutorialsSection({ nodes, onSelectNode }: Props) {
  const [activeId, setActiveId] = useState<string>();
  const activeTutorial = SNOWFLAKE_INTEGRATED_TUTORIALS.find((item) => item.id === activeId);
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  return (
    <>
      <Card size="small" title={<Space wrap><Typography.Text strong>综合工程教程</Typography.Text><Tag color="blue">{SNOWFLAKE_INTEGRATED_TUTORIALS.length} 篇</Tag></Space>} style={{ marginBottom: 16 }}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
          按真实工程场景串联多个知识点。综合教程独立于 KnowledgeNode，不计入 194 篇节点教材的阅读进度。
        </Typography.Paragraph>
        <Collapse ghost items={[{
          key: 'integrated-tutorials',
          label: '查看端到端实践课程',
          children: (
            <Row gutter={[12, 12]}>
              {SNOWFLAKE_INTEGRATED_TUTORIALS.map((tutorial) => (
                <Col xs={24} sm={12} xl={6} key={tutorial.id}>
                  <Card size="small" title={tutorial.title} extra={<Typography.Text type="secondary">{tutorial.estimatedMinutes} 分钟</Typography.Text>} style={{ height: '100%' }}>
                    <Typography.Paragraph type="secondary" style={{ minHeight: 72 }}>{tutorial.description}</Typography.Paragraph>
                    <Space wrap style={{ marginBottom: 10 }}>
                      <Tag>{tutorial.level === 'foundation' ? '基础' : tutorial.level === 'intermediate' ? '中级' : '进阶'}</Tag>
                      <Tag>{tutorial.linkedKnowledgeNodeIds.length} 个关联知识点</Tag>
                    </Space>
                    <Button type="primary" ghost block onClick={() => setActiveId(tutorial.id)}>阅读综合教程</Button>
                  </Card>
                </Col>
              ))}
            </Row>
          ),
        }]} />
      </Card>
      <Modal open={Boolean(activeTutorial)} title={activeTutorial?.title} onCancel={() => setActiveId(undefined)} footer={null} width={1080} styles={{ body: { maxHeight: '75vh', overflowY: 'auto' } }} destroyOnHidden>
        {activeTutorial && (
          <>
            <Space wrap style={{ marginBottom: 12 }}>
              <Tag color="blue">{activeTutorial.level === 'foundation' ? '基础' : activeTutorial.level === 'intermediate' ? '中级' : '进阶'}</Tag>
              <Tag>{activeTutorial.estimatedMinutes} 分钟</Tag>
              <Tag>{activeTutorial.linkedKnowledgeNodeIds.length} 个关联知识点</Tag>
            </Space>
            <div className="study-article">
              <XMarkdown content={activeTutorial.content} components={MARKDOWN_COMPONENTS} className="x-markdown-light" />
            </div>
            <Divider />
            <Typography.Title level={5}>继续学习关联知识点</Typography.Title>
            <Space wrap>
              {activeTutorial.linkedKnowledgeNodeIds.map((nodeId) => {
                const node = nodeById.get(nodeId);
                return node ? <Button key={nodeId} type="link" size="small" onClick={() => { onSelectNode(nodeId); setActiveId(undefined); }}>{node.name}</Button> : null;
              })}
            </Space>
          </>
        )}
      </Modal>
    </>
  );
}
