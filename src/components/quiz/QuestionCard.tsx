import { Card, Typography, Radio, Checkbox, Input, Tag, Space, Badge } from 'antd';
import type { AnswerValue, Question } from '../../types';
import { isChoice } from '../../domain/quiz';
import { categoryLabel } from '../../domain/categories';

const TYPE_LABEL: Record<Question['type'], string> = {
  single: '单选题',
  multiple: '多选题',
  essay: '问答题',
  coding: '编程题',
};

const DIFF_COLOR: Record<string, string> = {
  easy: 'green',
  medium: 'gold',
  hard: 'red',
};

interface Props {
  index: number;
  question: Question;
  value: AnswerValue;
  onChange: (v: AnswerValue) => void;
}

export default function QuestionCard({ index, question, value, onChange }: Props) {
  const options = isChoice(question) ? question.options : [];

  return (
    <Card size="small" style={{ marginBottom: 16 }}>
      <Space wrap style={{ marginBottom: 8 }}>
        <Badge count={index + 1} showZero color="#1677ff" />
        <Tag color="blue">{TYPE_LABEL[question.type]}</Tag>
        <Tag color={DIFF_COLOR[question.difficulty]}>{question.difficulty}</Tag>
        <Tag>{categoryLabel(question.category)}</Tag>
        {question.tags?.map((t) => (
          <Tag key={t} color="cyan">
            {t}
          </Tag>
        ))}
        {question.aiGenerated && <Tag color="purple">AI 变体</Tag>}
      </Space>
      <Typography.Paragraph strong style={{ fontSize: 15, whiteSpace: 'pre-wrap' }}>
        {question.question}
      </Typography.Paragraph>

      {isChoice(question) && question.type === 'single' && (
        <Radio.Group
          value={(value as number[])[0]}
          onChange={(e) => onChange([e.target.value as number])}
          options={options.map((o, i) => ({ label: o, value: i }))}
        />
      )}

      {isChoice(question) && question.type === 'multiple' && (
        <Checkbox.Group
          value={value as number[]}
          onChange={(v) => onChange(v as number[])}
          options={options.map((o, i) => ({ label: o, value: i }))}
        />
      )}

      {question.type === 'essay' && (
        <Input.TextArea
          rows={4}
          value={value as string}
          onChange={(e) => onChange(e.target.value)}
          placeholder="在此输入你的回答…"
        />
      )}

      {question.type === 'coding' && (
        <Input.TextArea
          rows={8}
          value={value as string}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`在此输入${question.language ? ` ${question.language} ` : ' '}代码…`}
          style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 }}
        />
      )}
    </Card>
  );
}
