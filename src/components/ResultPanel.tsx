import { Card, Typography, Tag, Progress, Space, Button, Collapse, List, Alert, Divider } from 'antd';
import { ReloadOutlined, CheckCircleTwoTone, CloseCircleTwoTone } from '@ant-design/icons';
import type { AnswerValue, ChoiceQuestion, EssayGrade, EssayQuestion, Question } from '../types';
import { isChoiceCorrect } from '../lib/quiz';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

interface Props {
  questions: Question[];
  answers: Record<string, AnswerValue>;
  grades: Record<string, EssayGrade | null>;
  onRestart: () => void;
}

function letterList(idxs: number[]): string {
  if (!idxs || idxs.length === 0) return '（未作答）';
  return idxs.map((i) => LETTERS[i] ?? `#${i + 1}`).join('、');
}

function ResultItem({
  index,
  q,
  answer,
  grade,
}: {
  index: number;
  q: Question;
  answer: AnswerValue;
  grade?: EssayGrade | null;
}) {
  let correct = false;
  let resultTag: React.ReactNode = null;

  if (q.type !== 'essay') {
    const cq = q as ChoiceQuestion;
    const sel = (answer as number[]) ?? [];
    correct = isChoiceCorrect(cq, sel);
    resultTag = correct ? (
      <Tag color="success" icon={<CheckCircleTwoTone twoToneColor="#52c41a" />}>
        正确
      </Tag>
    ) : (
      <Tag color="error" icon={<CloseCircleTwoTone twoToneColor="#ff4d4f" />}>
        错误
      </Tag>
    );
  } else {
    if (grade) {
      correct = grade.score >= 60;
      resultTag = (
        <Tag color={grade.score >= 80 ? 'success' : grade.score >= 60 ? 'gold' : 'error'}>
          得分 {grade.score}/100
        </Tag>
      );
    } else {
      resultTag = <Tag color="default">未评分</Tag>;
    }
  }

  return (
    <List.Item>
      <Card size="small" style={{ width: '100%' }} title={`第 ${index + 1} 题 · ${q.category}`} extra={resultTag}>
        <Typography.Paragraph strong style={{ whiteSpace: 'pre-wrap' }}>
          {q.question}
        </Typography.Paragraph>

        {q.type !== 'essay' && (
          <>
            <Typography.Text type="secondary">你的选择：</Typography.Text>
            <Typography.Text>{letterList((answer as number[]) ?? [])}</Typography.Text>
            <br />
            <Typography.Text type="secondary">正确答案：</Typography.Text>
            <Typography.Text strong>{letterList((q as ChoiceQuestion).answer)}</Typography.Text>
          </>
        )}

        {q.type === 'essay' && (
          <>
            <Typography.Text type="secondary">你的回答：</Typography.Text>
            <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>
              {(answer as string) || '（未作答）'}
            </Typography.Paragraph>
            <Typography.Text type="secondary">参考答案：</Typography.Text>
            <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>
              {(q as EssayQuestion).referenceAnswer}
            </Typography.Paragraph>
          </>
        )}

        <Collapse
          ghost
          items={[
            {
              key: 'detail',
              label: q.type === 'essay' && grade ? '解析 / AI 反馈' : '解析',
              children: (
                <>
                  <Typography.Paragraph type="secondary">解析：{q.explanation}</Typography.Paragraph>
                  {q.type === 'essay' && grade && (
                    <>
                      <Divider style={{ margin: '8px 0' }} />
                      <Typography.Paragraph>AI 总体反馈：{grade.feedback}</Typography.Paragraph>
                      {grade.strengths.length > 0 && (
                        <div>
                          <Typography.Text strong>亮点：</Typography.Text>
                          <ul style={{ margin: '4px 0' }}>
                            {grade.strengths.map((s, i) => (
                              <li key={i}>{s}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {grade.missed.length > 0 && (
                        <div>
                          <Typography.Text strong>遗漏/错误：</Typography.Text>
                          <ul style={{ margin: '4px 0' }}>
                            {grade.missed.map((m, i) => (
                              <li key={i}>{m}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  )}
                </>
              ),
            },
          ]}
        />
      </Card>
    </List.Item>
  );
}

export default function ResultPanel({ questions, answers, grades, onRestart }: Props) {
  let earned = 0;
  const total = questions.length;

  questions.forEach((q) => {
    const a = answers[q.id];
    if (q.type !== 'essay') {
      if (a && isChoiceCorrect(q as ChoiceQuestion, a as number[])) earned += 1;
    } else {
      const g = grades[q.id];
      if (g) earned += g.score / 100;
    }
  });

  const percent = total > 0 ? Math.round((earned / total) * 100) : 0;
  const choiceCount = questions.filter((q) => q.type !== 'essay').length;
  const essayCount = questions.length - choiceCount;

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      <Card style={{ marginBottom: 16, textAlign: 'center' }}>
        <Progress type="dashboard" percent={percent} />
        <Typography.Title level={4} style={{ marginTop: 8 }}>
          {earned.toFixed(1)} / {total} 分
        </Typography.Title>
        <Space wrap>
          <Tag>选择题 {choiceCount}</Tag>
          <Tag>问答题 {essayCount}</Tag>
          {essayCount > 0 && !Object.values(grades).some(Boolean) && (
            <Tag color="default">问答题未评分</Tag>
          )}
        </Space>
      </Card>

      {essayCount > 0 && !Object.values(grades).some(Boolean) && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="问答题未自动评分：未启用 AI 功能或评分失败。可参考上方参考答案自评。"
        />
      )}

      <List
        dataSource={questions}
        renderItem={(q, i) => (
          <ResultItem index={i} q={q} answer={answers[q.id]} grade={grades[q.id]} />
        )}
      />

      <Button type="primary" icon={<ReloadOutlined />} block size="large" style={{ marginTop: 16 }} onClick={onRestart}>
        再来一组
      </Button>
    </div>
  );
}
