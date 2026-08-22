import { useState } from 'react';
import { Card, Slider, Select, Switch, Button, Typography, Space, Divider, Alert, Segmented } from 'antd';
import { ThunderboltOutlined, PlayCircleOutlined } from '@ant-design/icons';
import type { Difficulty, InterviewDefinition, QuestionType } from '../types';
import type { PiConfig } from '../lib/piClient';
import { isConfigValid } from '../lib/piClient';

interface Props {
  categories: string[];
  config: PiConfig;
  onStart: (def: InterviewDefinition) => void;
  onOpenSettings: () => void;
}

const TYPE_OPTIONS: { label: string; value: QuestionType }[] = [
  { label: '单选', value: 'single' },
  { label: '多选', value: 'multiple' },
  { label: '问答', value: 'essay' },
  { label: '编程', value: 'coding' },
];

const DIFF_OPTIONS: { label: string; value: Difficulty }[] = [
  { label: '简单', value: 'easy' },
  { label: '中等', value: 'medium' },
  { label: '困难', value: 'hard' },
];

export default function SetupPanel({ categories, config, onStart, onOpenSettings }: Props) {
  const [count, setCount] = useState(10);
  const [selectedCats, setSelectedCats] = useState<string[]>([]);
  const [difficulties, setDifficulties] = useState<Difficulty[]>([]);
  const [types, setTypes] = useState<QuestionType[]>(['single', 'multiple', 'essay', 'coding']);
  const [useAI, setUseAI] = useState(true);

  const configReady = isConfigValid(config);

  const handleStart = () => {
    onStart({
      title: 'AI 面试训练',
      categories: selectedCats,
      difficulties,
      questionTypes: types,
      count,
      useAI,
      scoringRubric: { correctness: 0.5, depth: 0.3, communication: 0.2 },
    });
  };

  return (
    <Card style={{ maxWidth: 720, margin: '0 auto' }}>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        <ThunderboltOutlined /> 配置你的训练（Interview Definition）
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        声明式定义一场面试：主题/类别、难度、题型、题量、评分权重与倒计时，由引擎据此出题与评分。
      </Typography.Paragraph>

      <Divider>题目数量</Divider>
      <Slider min={5} max={30} step={1} value={count} onChange={setCount} marks={{ 5: '5', 10: '10', 20: '20', 30: '30' }} />
      <Typography.Text type="secondary">当前：{count} 题</Typography.Text>

      <Divider>类别（留空表示全部）</Divider>
      <Select
        mode="multiple"
        allowClear
        style={{ width: '100%' }}
        placeholder="不选则涵盖所有类别"
        value={selectedCats}
        onChange={setSelectedCats}
        options={categories.map((c) => ({ label: c, value: c }))}
      />

      <Divider>难度（留空表示不限）</Divider>
      <Segmented
        options={[{ label: '全部', value: 'all' }, ...DIFF_OPTIONS]}
        value={difficulties.length === 0 ? 'all' : (difficulties[0] as string)}
        onChange={(v) => setDifficulties(v === 'all' ? [] : [v as Difficulty])}
      />

      <Divider>题型</Divider>
      <Select
        mode="multiple"
        style={{ width: '100%' }}
        placeholder="选择允许的题型"
        value={types}
        onChange={(v) => setTypes(v as QuestionType[])}
        options={TYPE_OPTIONS}
      />

      <Divider>AI 变体 / 评分</Divider>
      <Space align="center" style={{ width: '100%', justifyContent: 'space-between' }}>
        <div>
          <Typography.Text strong>启用 LLM 出题变体与开放题评分</Typography.Text>
          <br />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            关闭则仅用题库原题，问答/编程题不自动评分
          </Typography.Text>
        </div>
        <Switch checked={useAI} onChange={setUseAI} disabled={!configReady} />
      </Space>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8 }}>
        开放题评分权重：正确性 50% · 深度 30% · 表达 20%
      </Typography.Paragraph>

      {useAI && !configReady && (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 12 }}
          message="尚未配置有效的 API Key"
          description={
            <Space>
              请先
              <Button type="link" size="small" onClick={onOpenSettings} style={{ padding: 0 }}>
                打开 LLM 设置
              </Button>
              填写密钥，或在上方关闭 AI 功能。
            </Space>
          }
        />
      )}

      <Button
        type="primary"
        size="large"
        icon={<PlayCircleOutlined />}
        block
        style={{ marginTop: 24 }}
        disabled={useAI && !configReady}
        onClick={handleStart}
      >
        开始训练（{count} 题）
      </Button>
    </Card>
  );
}
