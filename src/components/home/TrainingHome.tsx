import { useState } from 'react';
import {
  Card,
  Collapse,
  Segmented,
  Select,
  Slider,
  Switch,
  Button,
  Typography,
  Space,
  Divider,
  Tag,
  Alert,
} from 'antd';
import {
  RocketOutlined,
  ThunderboltOutlined,
  SettingOutlined,
  PlayCircleOutlined,
  HistoryOutlined,
} from '@ant-design/icons';
import type { Difficulty, FormatId } from '../../schemas/common';
import type { InterviewDefinition } from '../../schemas/interview';
import type { LearnerProfile } from '../../schemas/learner';
import type { AIConfig } from '../../schemas/ai-config';
import { isConfigValid } from '../../ai/provider';
import { buildCoachDefinition, recommendationText } from '../../domain/learner';
import { categoryLabel } from '../../domain/categories';

const FORMAT_OPTIONS: { label: string; value: FormatId }[] = [
  { label: '选择（单选/多选）', value: 'choice' },
  { label: '开放问答 / 编程', value: 'open' },
];

const DIFF_OPTIONS: { label: string; value: Difficulty }[] = [
  { label: '简单', value: 'easy' },
  { label: '中等', value: 'medium' },
  { label: '困难', value: 'hard' },
];

interface Props {
  categories: string[];
  config: AIConfig;
  profile: LearnerProfile;
  onStart: (def: InterviewDefinition) => void;
  onGoSettings: () => void;
}

function fmtDate(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const days = Math.floor((now.getTime() - ts) / 86400000);
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export default function TrainingHome({ categories, config, profile, onStart, onGoSettings }: Props) {
  const configReady = isConfigValid(config);
  const last = profile.sessions[0];

  // 自定义训练（收起的高级配置）
  const [count, setCount] = useState(10);
  const [selectedCats, setSelectedCats] = useState<string[]>([]);
  const [difficulties, setDifficulties] = useState<Difficulty[]>([]);
  const [formats, setFormats] = useState<FormatId[]>(['choice', 'open']);
  const [useAI, setUseAI] = useState(true);

  const startCustom = () => {
    onStart({
      title: '自定义训练',
      categories: selectedCats,
      difficulties,
      formats,
      count,
      useAI,
      scoringRubric: { correctness: 0.4, completeness: 0.2, architecture: 0.2, communication: 0.2 },
      mode: 'custom',
    });
  };

  const recommendation = recommendationText(profile, config.masteryThreshold);

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        <ThunderboltOutlined /> 今天练什么？
      </Typography.Title>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Space align="center" style={{ width: '100%', justifyContent: 'space-between' }} wrap>
          <div>
            <Typography.Text type="secondary">AI 能力：</Typography.Text>
            {configReady ? (
              <Tag color="success">AI ✓ 已配置</Tag>
            ) : (
              <Tag color="warning">AI 未配置</Tag>
            )}
          </div>
          <Button size="small" icon={<SettingOutlined />} onClick={onGoSettings}>
            去设置
          </Button>
        </Space>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
          AI 负责出题变体与开放题评分；未配置时选择题照常判分，开放题不自动评分。
        </Typography.Paragraph>
      </Card>

      {last && (
        <Card style={{ marginBottom: 16 }}>
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Space align="center" wrap>
              <HistoryOutlined />
              <Typography.Text strong>继续训练</Typography.Text>
              <Tag color="blue">{last.title}</Tag>
              <Typography.Text type="secondary">
                {fmtDate(last.startedAt)} · {last.overall} 分 · {last.questionResults.length} 题
              </Typography.Text>
            </Space>
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
              {recommendation}
            </Typography.Paragraph>
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              onClick={() => onStart(buildCoachDefinition(profile, { title: '继续训练', masteryThreshold: config.masteryThreshold }))}
            >
              按薄弱项继续训练
            </Button>
          </Space>
        </Card>
      )}

      <Card style={{ marginBottom: 16 }}>
        <Space align="center" size={12} style={{ marginBottom: 8 }}>
          <RocketOutlined style={{ fontSize: 20, color: '#1677ff' }} />
          <div>
            <Typography.Text strong style={{ fontSize: 15 }}>
              快速训练
            </Typography.Text>
            <br />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              根据你的学习记录，自动选择今天最值得练习的题目 · 预计 10 分钟
            </Typography.Text>
          </div>
        </Space>
        {!configReady && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 8 }}
            message="AI 未配置，开放题将不自动评分"
            action={
              <Button size="small" onClick={onGoSettings}>
                去设置
              </Button>
            }
          />
        )}
        <Button
          type="primary"
          ghost
          icon={<PlayCircleOutlined />}
          block
          onClick={() => onStart(buildCoachDefinition(profile, { title: '快速训练', timeLimitSec: 600, masteryThreshold: config.masteryThreshold }))}
        >
          开始快速训练
        </Button>
      </Card>

      <Card>
        <Collapse
          ghost
          items={[
            {
              key: 'custom',
              label: '自定义训练（主题 / 难度 / 形态 / 题数）',
              children: (
                <div>
                  <Divider style={{ margin: '4px 0' }}>类别（留空表示全部）</Divider>
                  <Select
                    mode="multiple"
                    allowClear
                    style={{ width: '100%' }}
                    placeholder="不选则涵盖所有类别"
                    value={selectedCats}
                    onChange={setSelectedCats}
                    options={categories.map((c) => ({ label: categoryLabel(c), value: c }))}
                  />
                  <Divider>难度（留空表示不限）</Divider>
                  <Segmented
                    options={[{ label: '全部', value: 'all' }, ...DIFF_OPTIONS]}
                    value={difficulties.length === 0 ? 'all' : (difficulties[0] as string)}
                    onChange={(v) => setDifficulties(v === 'all' ? [] : [v as Difficulty])}
                  />
                  <Divider>呈现形态</Divider>
                  <Select
                    mode="multiple"
                    style={{ width: '100%' }}
                    placeholder="选择允许的形态"
                    value={formats}
                    onChange={(v) => setFormats(v as FormatId[])}
                    options={FORMAT_OPTIONS}
                  />
                  <Divider>题数</Divider>
                  <Slider min={5} max={30} step={1} value={count} onChange={setCount} />
                  <Divider>AI 变体 / 评分</Divider>
                  {/* wrap：窄屏下这行文字会把 Switch 顶出容器。 */}
                  <Space align="center" style={{ width: '100%', justifyContent: 'space-between' }} wrap>
                    <Typography.Text>启用 LLM 出题变体与开放题评分</Typography.Text>
                    <Switch checked={useAI} onChange={setUseAI} disabled={!configReady} />
                  </Space>
                  <Button
                    type="primary"
                    icon={<PlayCircleOutlined />}
                    block
                    style={{ marginTop: 16 }}
                    disabled={useAI && !configReady}
                    onClick={startCustom}
                  >
                    开始自定义训练（{count} 题）
                  </Button>
                </div>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
