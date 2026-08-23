import { Button, Card, Tag, Typography } from 'antd';
import { ArrowRightOutlined, CheckOutlined, SendOutlined } from '@ant-design/icons';
import type { AnswerValue, SessionQuestion } from '../../types';
import { STRATEGY_LABELS, type Strategy } from '../../domain/adaptive';
import QuestionCard from '../quiz/QuestionCard';

interface Props {
  sq: SessionQuestion;
  /** 当前是第几题（0 起） */
  index: number;
  total: number;
  value: AnswerValue;
  strategy?: Strategy;
  evaluating: boolean;
  hasAnswer: boolean;
  onChange: (v: AnswerValue) => void;
  onSubmitNext: () => void;
  onFinish: () => void;
}

/** 自适应面试的逐题视图：答一题、评一题，下一题由迁移策略决定。 */
export default function AdaptiveQuiz({
  sq,
  index,
  total,
  value,
  strategy,
  evaluating,
  hasAnswer,
  onChange,
  onSubmitNext,
  onFinish,
}: Props) {
  return (
    <div>
      <Card size="small" style={{ marginBottom: 16 }}>
        <Typography.Text strong>第 {index + 1} / {total} 题</Typography.Text>
        {strategy && (
          <Tag color="geekblue" style={{ marginLeft: 12 }}>
            出题策略：{STRATEGY_LABELS[strategy]}
          </Tag>
        )}
        <Typography.Paragraph type="secondary" style={{ margin: '4px 0 0', fontSize: 12 }}>
          本场为自适应模式：每题提交后立即评分，下一题根据你的表现深入、补弱或扩展。
        </Typography.Paragraph>
      </Card>

      <QuestionCard
        index={index}
        question={sq.question}
        format={sq.format}
        value={value}
        onChange={onChange}
      />

      <Button
        type="primary"
        size="large"
        block
        icon={index + 1 >= total ? <CheckOutlined /> : <ArrowRightOutlined />}
        loading={evaluating}
        disabled={!hasAnswer || evaluating}
        onClick={onSubmitNext}
      >
        {evaluating ? '评分中…' : index + 1 >= total ? '提交本题并查看结果' : '提交本题，进入下一题'}
      </Button>
      {index > 0 && (
        <Button size="large" block style={{ marginTop: 8 }} icon={<SendOutlined />} onClick={onFinish} disabled={evaluating}>
          提前结束并查看结果
        </Button>
      )}
    </div>
  );
}
