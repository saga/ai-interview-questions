import { Card, Typography, Tag, Progress, Space, Button, Collapse, List, Alert, Divider } from 'antd';
import {
  ReloadOutlined,
  CheckCircleTwoTone,
  CloseCircleTwoTone,
  ArrowUpOutlined,
  ArrowDownOutlined,
  PlayCircleOutlined,
  BulbOutlined,
} from '@ant-design/icons';
import type { AnswerValue, ChoiceQuestion, EvaluationResult, LearnerProfile, OpenQuestion, Question } from '../../types';
import { isChoice } from '../../domain/quiz';
import { DIMENSION_LABELS, EVAL_DIMENSIONS } from '../../types';
import { categoryLabel } from '../../domain/categories';
import { recommendationText } from '../../domain/learner';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

interface Props {
  questions: Question[];
  answers: Record<string, AnswerValue>;
  grades: Record<string, EvaluationResult | null>;
  profile: LearnerProfile;
  /** 上一次会话的 overall（用于对比），无则 null */
  prevOverall: number | null;
  onContinue: () => void;
  onRestart: () => void;
}

function letterList(idxs: number[]): string {
  if (!idxs || idxs.length === 0) return '（未作答）';
  return idxs.map((i) => LETTERS[i] ?? `#${i + 1}`).join('、');
}

function DimensionRates({ g }: { g: EvaluationResult }) {
  return (
    <Space wrap size={[16, 4]}>
      {EVAL_DIMENSIONS.map((dim) => (
        <span key={dim}>
          <Typography.Text type="secondary">{DIMENSION_LABELS[dim]}：</Typography.Text>
          <Typography.Text strong>{g.dimensions[dim]}</Typography.Text>
        </span>
      ))}
    </Space>
  );
}

/** 从评估结果聚合"亮点 / 待加强"清单（唯一去重，最多各 5 条）。 */
function collectSignals(
  questions: Question[],
  grades: Record<string, EvaluationResult | null>,
): { strengths: string[]; weaknesses: string[] } {
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  for (const q of questions) {
    const g = grades[q.id];
    if (!g) continue;
    if (isChoice(q)) {
      if (g.dimensions.correctness === 100) {
        strengths.push(`${categoryLabel(q.category)} · ${q.topic}：回答正确`);
      } else {
        weaknesses.push(`${q.topic}：概念或判断有误（见解析）`);
      }
    } else {
      for (const s of g.strengths) if (s && !strengths.includes(s)) strengths.push(s);
      for (const m of g.gaps) if (m && !weaknesses.includes(m)) weaknesses.push(m);
    }
  }
  return { strengths: strengths.slice(0, 5), weaknesses: weaknesses.slice(0, 5) };
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
  grade?: EvaluationResult | null;
}) {
  let resultTag: React.ReactNode = null;

  if (isChoice(q)) {
    const cq = q as ChoiceQuestion;
    const sel = (answer as number[]) ?? [];
    const correct = grade?.dimensions.correctness === 100;
    resultTag = correct ? (
      <Tag color="success" icon={<CheckCircleTwoTone twoToneColor="#52c41a" />}>
        正确
      </Tag>
    ) : (
      <Tag color="error" icon={<CloseCircleTwoTone twoToneColor="#ff4d4f" />}>
        错误
      </Tag>
    );

    return (
      <List.Item>
        <Card
          size="small"
          style={{ width: '100%' }}
          title={`第 ${index + 1} 题 · ${categoryLabel(q.category)}`}
          extra={resultTag}
        >
          <Typography.Paragraph strong style={{ whiteSpace: 'pre-wrap' }}>
            {q.question}
          </Typography.Paragraph>
          <Typography.Text type="secondary">你的选择：</Typography.Text>
          <Typography.Text>{letterList(sel)}</Typography.Text>
          <br />
          <Typography.Text type="secondary">正确答案：</Typography.Text>
          <Typography.Text strong>{letterList(cq.answer)}</Typography.Text>
          <Collapse
            ghost
            items={[
              { key: 'd', label: '解析', children: <Typography.Paragraph type="secondary">解析：{q.explanation}</Typography.Paragraph> },
            ]}
          />
        </Card>
      </List.Item>
    );
  }

  // 开放 / 编程题
  const oq = q as OpenQuestion;
  if (grade) {
    resultTag = (
      <Tag color={grade.overall >= 80 ? 'success' : grade.overall >= 60 ? 'gold' : 'error'}>
        得分 {grade.overall}/100
      </Tag>
    );
  } else {
    resultTag = <Tag color="default">未评分</Tag>;
  }

  return (
    <List.Item>
      <Card
        size="small"
        style={{ width: '100%' }}
        title={`第 ${index + 1} 题 · ${categoryLabel(q.category)}`}
        extra={resultTag}
      >
        <Typography.Paragraph strong style={{ whiteSpace: 'pre-wrap' }}>
          {q.question}
        </Typography.Paragraph>

        <Typography.Text type="secondary">你的回答：</Typography.Text>
        <Typography.Paragraph
          style={{ whiteSpace: 'pre-wrap', fontFamily: oq.type === 'coding' ? 'ui-monospace, monospace' : undefined }}
        >
          {(answer as string) || '（未作答）'}
        </Typography.Paragraph>
        <Typography.Text type="secondary">参考答案：</Typography.Text>
        <Typography.Paragraph
          style={{ whiteSpace: 'pre-wrap', fontFamily: oq.type === 'coding' ? 'ui-monospace, monospace' : undefined }}
        >
          {oq.referenceAnswer}
        </Typography.Paragraph>

        <Collapse
          ghost
          items={[
            {
              key: 'detail',
              label: grade ? '解析 / AI 多维反馈' : '解析',
              children: (
                <>
                  <Typography.Paragraph type="secondary">解析：{q.explanation}</Typography.Paragraph>
                  {grade && (
                    <>
                      <Divider style={{ margin: '8px 0' }} />
                      <DimensionRates g={grade} />
                      <div style={{ marginTop: 8 }}>
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
                        {grade.gaps.length > 0 && (
                          <div>
                            <Typography.Text strong>遗漏/错误：</Typography.Text>
                            <ul style={{ margin: '4px 0' }}>
                              {grade.gaps.map((m, i) => (
                                <li key={i}>{m}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
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

export default function ResultPanel({ questions, answers, grades, profile, prevOverall, onContinue, onRestart }: Props) {
  let earned = 0;
  const total = questions.length;

  questions.forEach((q) => {
    const g = grades[q.id];
    earned += (g ? g.overall : 0) / 100;
  });

  const percent = total > 0 ? Math.round((earned / total) * 100) : 0;
  const choiceCount = questions.filter(isChoice).length;
  const openCount = total - choiceCount;
  const openGraded = questions.filter((q) => !isChoice(q) && grades[q.id]).length;

  const { strengths, weaknesses } = collectSignals(questions, grades);
  const delta = prevOverall == null ? null : percent - prevOverall;

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      <Card style={{ marginBottom: 16, textAlign: 'center' }}>
        <Progress type="dashboard" percent={percent} />
        <Typography.Title level={4} style={{ marginTop: 8 }}>
          {earned.toFixed(1)} / {total} 分
        </Typography.Title>
        <Space wrap>
          {delta != null && (
            <Tag color={delta >= 0 ? 'success' : 'error'} icon={delta >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />}>
              比上次 {delta >= 0 ? '+' : ''}
              {delta}
            </Tag>
          )}
          <Tag>选择题 {choiceCount}</Tag>
          <Tag>开放/编程 {openCount}</Tag>
          {openCount > 0 && openGraded === 0 && <Tag color="default">开放题未评分</Tag>}
        </Space>
      </Card>

      {openCount > 0 && openGraded === 0 && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="开放/编程题未自动评分：未启用 AI 功能或评分失败。可参考上方参考答案自评。"
        />
      )}

      {(strengths.length > 0 || weaknesses.length > 0) && (
        <Card size="small" style={{ marginBottom: 16 }}>
          {strengths.length > 0 && (
            <div style={{ marginBottom: weaknesses.length > 0 ? 12 : 0 }}>
              <Typography.Text strong style={{ color: '#52c41a' }}>
                ✓ 表现不错
              </Typography.Text>
              <ul style={{ margin: '4px 0' }}>
                {strengths.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          {weaknesses.length > 0 && (
            <div>
              <Typography.Text strong style={{ color: '#fa541c' }}>
                △ 需要加强
              </Typography.Text>
              <ul style={{ margin: '4px 0' }}>
                {weaknesses.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      <Alert
        type="info"
        showIcon
        icon={<BulbOutlined />}
        style={{ marginBottom: 16 }}
        message="AI 训练建议"
        description={recommendationText(profile)}
      />

      <List
        dataSource={questions}
        renderItem={(q, i) => <ResultItem index={i} q={q} answer={answers[q.id]} grade={grades[q.id]} />}
      />

      <Space style={{ width: '100%', marginTop: 16 }} direction="vertical">
        <Button type="primary" size="large" block icon={<PlayCircleOutlined />} onClick={onContinue}>
          按薄弱项继续训练
        </Button>
        <Button size="large" block icon={<ReloadOutlined />} onClick={onRestart}>
          再来一组
        </Button>
      </Space>
    </div>
  );
}
