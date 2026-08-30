import { Card, Typography, Tag, Progress, Space, Button, Collapse, List, Alert, Divider } from 'antd';
import { Suspense, lazy } from 'react';
import {
  ReloadOutlined,
  CheckCircleTwoTone,
  CloseCircleTwoTone,
  ArrowUpOutlined,
  ArrowDownOutlined,
  PlayCircleOutlined,
  BulbOutlined,
} from '@ant-design/icons';
import type { AnswerValue } from '../../types';
import { DIMENSION_LABELS, EVAL_DIMENSIONS } from '../../types';
import type { EvaluationResult } from '../../schemas/evaluation';
import type { LearnerProfile } from '../../schemas/learner';
import type { AIConfig } from '../../schemas/ai-config';
import type { SessionQuestion } from '../../schemas/session';
import { categoryLabel } from '../../domain/categories';
import { recommendationText } from '../../domain/learner';
import RichText from '../common/RichText';
import CodeBlock from '../common/CodeBlock';

const LazyCodeDiff = lazy(() =>
  import('../common/CodeEditor').then((m) => ({ default: m.CodeDiff })),
);

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

interface Props {
  questions: SessionQuestion[];
  answers: Record<string, AnswerValue>;
  grades: Record<string, EvaluationResult | null>;
  profile: LearnerProfile;
  masteryThreshold?: AIConfig['masteryThreshold'];
  /** 上一次会话的 overall（用于对比），无则 null */
  prevOverall: number | null;
  onContinue: () => void;
  onRestart: () => void;
}

function letterList(idxs: number[]): string {
  if (!idxs || idxs.length === 0) return '（未作答）';
  return idxs.map((i) => LETTERS[i] ?? `#${i + 1}`).join('、');
}

// 序级 → 可解释文字标签（与 EVAL_SYSTEM 等级含义表对应；LLM 判级，代码只做展示）。
const LEVEL_LABELS: Record<number, string> = {
  0: '完全错误',
  1: '主要误解',
  2: '部分正确',
  3: '正确',
  4: '强/有洞见',
};

function DimensionRates({ g }: { g: EvaluationResult }) {
  return (
    <Space wrap size={[16, 4]}>
      {EVAL_DIMENSIONS.map((dim) => (
        <span key={dim}>
          <Typography.Text type="secondary">{DIMENSION_LABELS[dim]}：</Typography.Text>
          <Typography.Text strong>{LEVEL_LABELS[g.levels[dim]] ?? '—'}</Typography.Text>
          <Typography.Text type="secondary">（{g.dimensions[dim]}）</Typography.Text>
        </span>
      ))}
    </Space>
  );
}

/** 从评估结果聚合"亮点 / 待加强"清单（唯一去重，最多各 5 条）。 */
function collectSignals(
  questions: SessionQuestion[],
  grades: Record<string, EvaluationResult | null>,
): { strengths: string[]; weaknesses: string[] } {
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  for (const sq of questions) {
    const g = grades[sq.question.id];
    if (!g) continue;
    if (sq.format === 'choice') {
      if (g.dimensions.correctness === 100) {
        strengths.push(`${categoryLabel(sq.question.category)} · ${sq.question.topic}：回答正确`);
      } else {
        weaknesses.push(`${sq.question.topic}：概念或判断有误（见解析）`);
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
  sq,
  answer,
  grade,
}: {
  index: number;
  sq: SessionQuestion;
  answer: AnswerValue;
  grade?: EvaluationResult | null;
}) {
  const q = sq.question;

  if (sq.format === 'choice') {
    const cf = q.formats.choice!;
    const sel = ((answer as number[]) ?? []).slice().sort((a, b) => a - b);
    const correct = grade?.dimensions.correctness === 100;
    // 选择形态可携带场景化专属题干（cf.question），未给则与开放形态共用共享题干
    const stem = cf.question ?? q.question;
    const resultTag = correct ? (
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
          title={`第 ${index + 1} 题 · ${categoryLabel(q.category)} · ${cf.type === 'multiple' ? '多选' : '单选'}`}
          extra={resultTag}
        >
          <RichText text={stem} strong />
          <Typography.Text type="secondary">你的选择：</Typography.Text>
          <Typography.Text>{letterList(sel)}</Typography.Text>
          <br />
          <Typography.Text type="secondary">正确答案：</Typography.Text>
          <Typography.Text strong>{letterList([...cf.answer].sort((a, b) => a - b))}</Typography.Text>
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

  // 开放 / 编程形态
  const of = q.formats.open!;
  if (grade) {
    var resultTag = (
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
        title={`第 ${index + 1} 题 · ${categoryLabel(q.category)}${of.language ? ` · 编程（${of.language}）` : ''}`}
        extra={resultTag}
      >
        <RichText text={q.question} strong />

        <Typography.Text type="secondary">你的回答：</Typography.Text>
        {of.language && (answer as string)?.trim() ? (
          <CodeBlock code={answer as string} language={of.language} />
        ) : (
          <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>
            {(answer as string) || '（未作答）'}
          </Typography.Paragraph>
        )}
        <Typography.Text type="secondary">参考答案：</Typography.Text>
        {of.language ? (
          <CodeBlock code={of.referenceAnswer} language={of.language} />
        ) : (
          <RichText text={of.referenceAnswer} />
        )}

        {of.language && (answer as string)?.trim() && (
          <Collapse
            ghost
            items={[
              {
                key: 'diff',
                label: '代码对比（你的代码 vs 参考答案）',
                children: (
                  <Suspense fallback={<div style={{ height: 360 }}>对比视图加载中…</div>}>
                    <LazyCodeDiff
                      original={of.referenceAnswer}
                      modified={answer as string}
                      language={of.language}
                    />
                  </Suspense>
                ),
              },
            ]}
          />
        )}

        <Collapse
          ghost
          items={[
            {
              key: 'detail',
              label: grade ? '解析 / AI 多维反馈' : '解析',
              children: (
                <>
                  <Typography.Paragraph type="secondary">解析：</Typography.Paragraph>
                  <div style={{ marginBottom: 8 }}>
                    <RichText text={q.explanation} />
                  </div>
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

export default function ResultPanel({ questions, answers, grades, profile, masteryThreshold, prevOverall, onContinue, onRestart }: Props) {
  let earned = 0;
  const total = questions.length;

  questions.forEach((sq) => {
    const g = grades[sq.question.id];
    earned += (g ? g.overall : 0) / 100;
  });

  const percent = total > 0 ? Math.round((earned / total) * 100) : 0;
  const choiceCount = questions.filter((sq) => sq.format === 'choice').length;
  const openCount = total - choiceCount;
  const openGraded = questions.filter((sq) => sq.format !== 'choice' && grades[sq.question.id]).length;

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
        description={recommendationText(profile, masteryThreshold)}
      />

      <List
        dataSource={questions}
        renderItem={(sq, i) => <ResultItem index={i} sq={sq} answer={answers[sq.question.id]} grade={grades[sq.question.id]} />}
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
