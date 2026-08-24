import { Card, Radio, Checkbox, Input, Tag, Space, Badge, Typography } from 'antd';
import { Suspense, lazy } from 'react';
import type { AnswerValue, FormatId, Question } from '../../types';
import { categoryLabel } from '../../domain/categories';
import RichText from '../common/RichText';

const LazyCodeEditor = lazy(() => import('../common/CodeEditor'));

const DIFF_COLOR: Record<string, string> = {
  easy: 'green',
  medium: 'gold',
  hard: 'red',
};

interface Props {
  index: number;
  question: Question;
  /** 本次会话的呈现形态（同一道题可出选择也可出开放） */
  format: FormatId;
  value: AnswerValue;
  onChange: (v: AnswerValue) => void;
}

export default function QuestionCard({ index, question, format, value, onChange }: Props) {
  const cf = question.formats.choice;
  const of = question.formats.open;
  // 选择形态可携带场景化专属题干（cf.question），未给则与开放形态共用共享题干
  const stem = (format === 'choice' ? cf?.question : undefined) ?? question.question;
  const typeLabel =
    format === 'choice'
      ? cf?.type === 'multiple'
        ? '多选题'
        : '单选题'
      : of?.language
        ? `编程题 · ${of.language}`
        : '问答题';

  return (
    <Card size="small" style={{ marginBottom: 16 }}>
      <Space wrap style={{ marginBottom: 14 }}>
        <Badge count={index + 1} showZero color="#1677ff" />
        <Tag color="blue">{typeLabel}</Tag>
        <Tag color={DIFF_COLOR[question.difficulty]}>{question.difficulty}</Tag>
        <Tag>{categoryLabel(question.category)}</Tag>
        {question.tags?.map((t) => (
          <Tag key={t} color="cyan">
            {t}
          </Tag>
        ))}
        {question.aiGenerated && <Tag color="purple">AI 变体</Tag>}
      </Space>
      <div style={{ marginBottom: 18 }}>
        <RichText text={stem} strong />
      </div>

      {format === 'choice' && cf?.type === 'single' && (
        <Radio.Group
          value={(value as number[])[0]}
          onChange={(e) => onChange([e.target.value as number])}
          style={{ width: '100%' }}
        >
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {cf.options.map((o, i) => (
              <Radio key={i} value={i}>
                  <Typography.Text style={{ lineHeight: 1.8 }}>
                          {o}
                  </Typography.Text> 
              </Radio>
            ))}
          </Space>
        </Radio.Group>
      )}

      {format === 'choice' && cf?.type === 'multiple' && (
        <Checkbox.Group
          value={(value as number[]) ?? []}
          onChange={(v) => onChange(v as number[])}
          style={{ width: '100%' }}
        >
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {cf.options.map((o, i) => (
              <Checkbox key={i} value={i}>
                  <Typography.Text style={{ lineHeight: 1.8 }}>
                          {o}
                  </Typography.Text> 
              </Checkbox>
            ))}
          </Space>
        </Checkbox.Group>
      )}

      {format === 'open' && !of?.language && (
        <Input.TextArea
          rows={4}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="在此输入你的回答…"
        />
      )}

      {format === 'open' && of?.language && (
        <Suspense
          fallback={
            <Input.TextArea
              rows={8}
              disabled
              value={(value as string) ?? ''}
              placeholder="代码编辑器加载中…"
              style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 }}
            />
          }
        >
          <LazyCodeEditor
            value={(value as string) ?? ''}
            onChange={(v) => onChange(v)}
            language={of.language}
            height={320}
          />
        </Suspense>
      )}
    </Card>
  );
}
