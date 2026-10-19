import { Button, Card, Col, Empty, Row, Space, Tag, Typography } from 'antd';
import { ArrowRightOutlined, BookOutlined, DatabaseOutlined, RobotOutlined } from '@ant-design/icons';
import { LEARNING_TRACKS, type LearningTrackId } from '../../data/learningTracks';
import { questionBank } from '../../data/questionBank';
import { knowledgeNodes } from '../../data/knowledgeMap';
import { knowledgeForTrack, questionBankForTrack } from '../../domain/learningTracks';

interface Props {
  onSelect: (trackId: LearningTrackId) => void;
}

export default function LearningTrackSelector({ onSelect }: Props) {
  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <Typography.Title level={3} style={{ marginTop: 0 }}>先选择学习体系</Typography.Title>
      <Typography.Paragraph type="secondary">
        每个学习体系有独立的课程主题、知识点、题库和训练进度。切换体系不会把一种知识的练习记录用于另一种体系的推荐。
      </Typography.Paragraph>
      <Row gutter={[16, 16]}>
        {LEARNING_TRACKS.map((track) => {
          const bank = questionBankForTrack(questionBank, track.id, knowledgeNodes);
          const nodes = knowledgeForTrack(knowledgeNodes, track.id);
          const isSnowflake = track.id === 'snowflake';
          return (
            <Col xs={24} md={12} key={track.id}>
              <Card style={{ height: '100%' }} title={
                <Space>
                  {isSnowflake ? <DatabaseOutlined /> : <RobotOutlined />}
                  <span>{track.title}</span>
                </Space>
              }>
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  <Typography.Paragraph>{track.description}</Typography.Paragraph>
                  <Space wrap>
                    <Tag color="blue">{nodes.length} 个知识点</Tag>
                    <Tag color="geekblue">{bank.questions.length} 道题目</Tag>
                    <Tag>{bank.categories.length} 个课程主题</Tag>
                  </Space>
                  {'learningPathUrl' in track && (
                    <Typography.Link href={track.learningPathUrl} target="_blank" rel="noreferrer">
                      <BookOutlined /> 学习路线与官方文档
                    </Typography.Link>
                  )}
                  <Button type="primary" block icon={<ArrowRightOutlined />} onClick={() => onSelect(track.id)}>
                    {track.actionLabel}
                  </Button>
                </Space>
              </Card>
            </Col>
          );
        })}
        <Col xs={24} md={12}>
          <Card title={<Space><BookOutlined /><span>其他知识体系</span></Space>} style={{ height: '100%' }}>
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Typography.Paragraph type="secondary">
                可以继续增加独立课程，例如 PostgreSQL、数据工程或其他专业领域；每门课程使用自己的 courseId、知识点、题库和进度边界。
              </Typography.Paragraph>
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="目前还没有注册其他课程" />
            </Space>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
