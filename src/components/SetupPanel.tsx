import { useState } from 'react';
import { Card, Slider, Select, Switch, Button, Typography, Tag, Space, Divider, Alert } from 'antd';
import { ThunderboltOutlined, PlayCircleOutlined } from '@ant-design/icons';
import type { PiConfig } from '../lib/piClient';
import { isConfigValid } from '../lib/piClient';

interface Props {
  categories: string[];
  config: PiConfig;
  onStart: (opts: { count: number; categories: string[]; useAI: boolean }) => void;
  onOpenSettings: () => void;
}

export default function SetupPanel({ categories, config, onStart, onOpenSettings }: Props) {
  const [count, setCount] = useState(10);
  const [selected, setSelected] = useState<string[]>([]);
  const [useAI, setUseAI] = useState(true);

  const configReady = isConfigValid(config);

  return (
    <Card style={{ maxWidth: 720, margin: '0 auto' }}>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        <ThunderboltOutlined /> 配置你的训练
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        每次从题库随机抽取题目，可选择让 LLM 对题目做"变体变换"（重新措辞、打乱选项）并用于问答题智能评分。
      </Typography.Paragraph>

      <Divider>题目数量</Divider>
      <Slider min={5} max={30} step={1} value={count} onChange={setCount} marks={{ 5: '5', 10: '10', 20: '20', 30: '30' }} />
      <Typography.Text type="secondary">当前：{count} 题</Typography.Text>

      <Divider>题目类别（留空表示全部）</Divider>
      <Select
        mode="multiple"
        allowClear
        style={{ width: '100%' }}
        placeholder="不选则涵盖所有类别"
        value={selected}
        onChange={setSelected}
        options={categories.map((c) => ({ label: c, value: c }))}
      />
      <div style={{ marginTop: 8 }}>
        {selected.length === 0 && <Tag>全部类别</Tag>}
        {selected.map((c) => (
          <Tag key={c} color="blue">
            {c}
          </Tag>
        ))}
      </div>

      <Divider>AI 变体 / 评分</Divider>
      <Space align="center" style={{ width: '100%', justifyContent: 'space-between' }}>
        <div>
          <Typography.Text strong>启用 LLM 出题变体与问答题评分</Typography.Text>
          <br />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            关闭则仅使用题库原题，问答题不自动评分
          </Typography.Text>
        </div>
        <Switch checked={useAI} onChange={setUseAI} disabled={!configReady} />
      </Space>

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
        onClick={() => onStart({ count, categories: selected, useAI })}
      >
        开始训练（{count} 题）
      </Button>
    </Card>
  );
}
