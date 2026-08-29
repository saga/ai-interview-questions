import { useMemo, useState } from 'react';
import { Card, Typography, Progress, Tag, List, Empty, Button, Space, Tabs, Table, Segmented, Select, Statistic, Tooltip, Switch } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined, MinusOutlined, ThunderboltOutlined, ApartmentOutlined } from '@ant-design/icons';
import type { TableProps } from 'antd';
import type { LearnerProfile, SessionRecord } from '../../schemas/learner';
import type { KnowledgeNode } from '../../schemas/knowledge';
import type { KnowledgeArea } from '../../schemas/common';
import type { CoverageReport, TopicSuggestion } from '../../domain/learner';
import { WEAK_MASTERY, WEAK_AVG } from '../../domain/learner';
import { KNOWLEDGE_AREA_LABELS } from '../../domain/knowledge';
import { knowledgeNodes } from '../../data/knowledgeMap';
import { domainLabel, topicLabel } from '../../data/taxonomy';
import SessionReplayDrawer from './SessionReplayDrawer';

interface Props {
  profile: LearnerProfile;
  onGoTrain: () => void;
  coverage: CoverageReport;
  suggestions: TopicSuggestion[];
  disabledCategories: string[];
  onToggleCategory: (category: string) => void;
}

function fmtDate(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 最近 10 次会话得分的简易折线（内联 SVG，不引入图表库）。 */
function TrendSparkline({ scores }: { scores: number[] }) {
  if (scores.length < 2) return null;
  const w = 320;
  const h = 64;
  const pad = 6;
  const max = 100;
  const step = scores.length > 1 ? (w - pad * 2) / (scores.length - 1) : 0;
  const pts = scores.map((s, i) => `${pad + i * step},${h - pad - (Math.max(0, Math.min(100, s)) / max) * (h - pad * 2)}`);
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block', maxWidth: w }}>
      <polyline points={pts.join(' ')} fill="none" stroke="#1677ff" strokeWidth={2} strokeLinejoin="round" />
      {scores.map((s, i) => (
        <circle key={i} cx={pad + i * step} cy={h - pad - (Math.max(0, Math.min(100, s)) / max) * (h - pad * 2)} r={2.5} fill="#1677ff" />
      ))}
    </svg>
  );
}

function masteryColor(m: number): string {
  if (m >= 0.85) return '#52c41a';
  if (m >= 0.7) return '#1677ff';
  return '#ff4d4f';
}

const PRIORITY_RANK: Record<string, number> = { P0: 0, P1: 1, P2: 2 };

interface ChecklistRow {
  node: KnowledgeNode;
  learned: boolean;
  mastery: number;
  avgScore: number;
  weak: boolean;
  attempts: number;
}

export default function ProgressPage({ profile, onGoTrain, coverage, suggestions, disabledCategories, onToggleCategory }: Props) {
  const [replay, setReplay] = useState<SessionRecord | null>(null);
  const { sessions, topicStats, overallScore } = profile;
  const [statusFilter, setStatusFilter] = useState<'all' | 'learned' | 'unlearned'>('all');
  const [areaFilter, setAreaFilter] = useState<KnowledgeArea | 'all'>('all');

  // —— 知识点清单：把全量知识体系与画像对齐，逐节点标注学过 / 没学过 ——
  const rows = useMemo<ChecklistRow[]>(() => {
    return knowledgeNodes.map((n) => {
      const s = topicStats[n.topic];
      const attempts = s?.attempts ?? 0;
      const learned = attempts > 0;
      const mastery = s?.mastery ?? 0;
      const avgScore = s?.avgScore ?? 0;
      const mastered = learned && (mastery >= WEAK_MASTERY || avgScore >= WEAK_AVG);
      return { node: n, learned, mastery, avgScore, weak: learned && !mastered, attempts };
    });
  }, [topicStats]);

  const learnedCount = rows.filter((r) => r.learned).length;
  const unlearnedCount = rows.length - learnedCount;

  const filteredRows = useMemo<ChecklistRow[]>(() => {
    let list = rows;
    if (statusFilter === 'learned') list = list.filter((r) => r.learned);
    else if (statusFilter === 'unlearned') list = list.filter((r) => !r.learned);
    if (areaFilter !== 'all') list = list.filter((r) => r.node.area === areaFilter);
    // 未学优先 → P0 优先 → 按域 → 按名称，让"待学重点"浮到顶部
    return [...list].sort((a, b) => {
      if (a.learned !== b.learned) return a.learned ? 1 : -1;
      const pr = (PRIORITY_RANK[a.node.priority] ?? 9) - (PRIORITY_RANK[b.node.priority] ?? 9);
      if (pr !== 0) return pr;
      if (a.node.area !== b.node.area) return a.node.area.localeCompare(b.node.area);
      return a.node.name.localeCompare(b.node.name);
    });
  }, [rows, statusFilter, areaFilter]);

  const checklistColumns: TableProps<ChecklistRow>['columns'] = [
    {
      title: '知识点',
      key: 'name',
      fixed: 'left',
      render: (_v, r) => (
        <Tooltip title={r.node.summary}>
          <span>
            {r.node.name}
            <Typography.Text type="secondary" style={{ marginLeft: 6, fontSize: 12 }}>
              {r.node.id}
            </Typography.Text>
          </span>
        </Tooltip>
      ),
    },
    {
      title: '域',
      key: 'area',
      width: 150,
      render: (_v, r) => KNOWLEDGE_AREA_LABELS[r.node.area] ?? r.node.area,
    },
    {
      title: '主题',
      key: 'topic',
      width: 130,
      render: (_v, r) => topicLabel(r.node.topic),
    },
    {
      title: '优先级',
      key: 'priority',
      width: 90,
      render: (_v, r) => (
        <Tag color={r.node.priority === 'P0' ? 'red' : r.node.priority === 'P1' ? 'blue' : 'default'}>
          {r.node.priority}
        </Tag>
      ),
    },
    {
      title: '学习状态',
      key: 'status',
      width: 100,
      render: (_v, r) =>
        r.learned ? <Tag color="green">已学</Tag> : <Tag color="default">未学</Tag>,
    },
    {
      title: '掌握度',
      key: 'mastery',
      width: 140,
      render: (_v, r) =>
        r.learned ? (
          <Progress
            percent={Math.round(r.mastery * 100)}
            strokeColor={masteryColor(r.mastery)}
            size="small"
            format={(p) => `${p}%`}
          />
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: '均分',
      key: 'avg',
      width: 70,
      render: (_v, r) => (r.learned ? r.avgScore : <Typography.Text type="secondary">—</Typography.Text>),
    },
    {
      title: '薄弱',
      key: 'weak',
      width: 80,
      render: (_v, r) => (r.weak ? <Tag color="orange">薄弱</Tag> : null),
    },
  ];

  const overview = (
    <div>
      {sessions.length === 0 ? (
        <Card style={{ maxWidth: 720, margin: '0 auto' }}>
          <Empty description="还没有训练记录">
            <Button type="primary" icon={<ThunderboltOutlined />} onClick={onGoTrain}>
              去开始第一次训练
            </Button>
          </Empty>
        </Card>
      ) : (
        <>
          <Card style={{ marginBottom: 16, textAlign: 'center' }}>
            <Progress type="dashboard" percent={overallScore} />
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
              共 {profile.totalSessions} 次训练 · {profile.totalQuestions} 题
            </Typography.Paragraph>
          </Card>

          <Card size="small" style={{ marginBottom: 16 }} title="主题掌握度（按 6 域）">
            {Object.entries(topicStats)
              .filter(([, s]) => s.attempts > 0)
              .sort((a, b) => b[1].mastery - a[1].mastery)
              .map(([topic, s]) => (
                <div key={topic} style={{ marginBottom: 8 }}>
                  <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
                    <Space size={4}>
                      <Typography.Text>{topicLabel(topic)} ({topic})</Typography.Text>
                      {s.trend === 'improving' && <Tag icon={<ArrowUpOutlined />} color="success" style={{ marginInlineEnd: 0 }}>进步</Tag>}
                      {s.trend === 'declining' && <Tag icon={<ArrowDownOutlined />} color="error" style={{ marginInlineEnd: 0 }}>下滑</Tag>}
                      {s.trend === 'flat' && <Tag icon={<MinusOutlined />} color="default" style={{ marginInlineEnd: 0 }}>平稳</Tag>}
                    </Space>
                    <Typography.Text type="secondary">
                      {s.attempts} 次 · 均分 {s.avgScore}
                    </Typography.Text>
                  </Space>
                  <Progress
                    percent={Math.round(s.mastery * 100)}
                    strokeColor={masteryColor(s.mastery)}
                    size="small"
                    format={(p) => `${p}%`}
                  />
                </div>
              ))}
          </Card>

          <Card size="small" style={{ marginBottom: 16 }} title={<span><ApartmentOutlined /> 知识覆盖面 · 6 域</span>}>
            {coverage.categories.map((c) => (
              <div key={c.category} style={{ marginBottom: 8 }}>
                <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
                  <Space size={8}>
                    <Switch
                      size="small"
                      checked={!disabledCategories.includes(c.category)}
                      onChange={() => onToggleCategory(c.category)}
                      checkedChildren="出题"
                      unCheckedChildren="暂停"
                    />
                    <Typography.Text type={disabledCategories.includes(c.category) ? 'secondary' : undefined}>
                      {domainLabel(c.category as any)} ({c.category})
                    </Typography.Text>
                  </Space>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    覆盖 {c.attempted}/{c.totalTopics} 主题 · 掌握 {c.mastered}
                  </Typography.Text>
                </Space>
                <Progress
                  percent={Math.round((c.attempted / c.totalTopics) * 100)}
                  strokeColor={disabledCategories.includes(c.category) ? '#bfbfbf' : c.mastered >= c.totalTopics ? '#52c41a' : undefined}
                  size="small"
                  format={(p) => `${p}%`}
                />
              </div>
            ))}
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: '8px 0 0' }}>
              共 {coverage.unattemptedCount} 个主题未接触
              {coverage.blockedCount > 0 && `，其中 ${coverage.blockedCount} 个主题的前置知识尚未掌握`}
              。
            </Typography.Paragraph>
          </Card>

          <Card size="small" style={{ marginBottom: 16 }} title="最近趋势">
            <TrendSparkline scores={sessions.slice(0, 10).map((s) => s.overall).reverse()} />
            <List
              size="small"
              dataSource={sessions.slice(0, 5)}
              renderItem={(s) => (
                <List.Item
                  style={{ padding: '4px 0', cursor: 'pointer' }}
                  onClick={() => setReplay(s)}
                >
                  <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
                    <span>
                      {s.title}
                      <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                        {fmtDate(s.startedAt)}
                      </Typography.Text>
                    </span>
                    <Space size={4}>
                      <Tag color={s.overall >= 80 ? 'success' : s.overall >= 60 ? 'gold' : 'error'}>{s.overall} 分</Tag>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>查看 ↗</Typography.Text>
                    </Space>
                  </Space>
                </List.Item>
              )}
            />
          </Card>

          {suggestions.length > 0 && (
            <Card size="small" style={{ marginBottom: 16 }} title="建议下一步">
              <List
                size="small"
                dataSource={suggestions}
                renderItem={(s) => (
                  <List.Item style={{ padding: '4px 0' }}>
                    <Space wrap>
                      <Tag color={coverage.weakTopics.includes(s.topic) ? 'orange' : 'geekblue'}>
                        {topicLabel(s.topic)} ({s.topic})
                      </Tag>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>{s.reason}</Typography.Text>
                    </Space>
                  </List.Item>
                )}
              />
              <Button type="primary" ghost block style={{ marginTop: 8 }} onClick={onGoTrain}>
                按建议训练
              </Button>
            </Card>
          )}

          {(() => {
            const needsAttention = Object.entries(topicStats)
              .filter(([, s]) => s.attempts > 0 && s.mastery < 0.7)
              .sort((a, b) => a[1].mastery - b[1].mastery);
            if (needsAttention.length === 0) return null;
            return (
              <Card size="small" title="需要关注">
                <Space wrap>
                  {needsAttention.map(([topic, s]) => (
                    <Tag key={topic} color={masteryColor(s.mastery)}>
                      {topicLabel(topic)} · 掌握 {Math.round(s.mastery * 100)}%
                    </Tag>
                  ))}
                </Space>
                <Button type="primary" ghost block style={{ marginTop: 12 }} onClick={onGoTrain}>
                  针对薄弱项训练
                </Button>
              </Card>
            );
          })()}
        </>
      )}
    </div>
  );

  const checklist = (
    <div>
      <Space size="large" style={{ marginBottom: 12 }} wrap>
        <Statistic title="知识点总数" value={rows.length} />
        <Statistic title="已学" value={learnedCount} valueStyle={{ color: '#52c41a' }} />
        <Statistic title="未学" value={unlearnedCount} valueStyle={{ color: '#ff4d4f' }} />
      </Space>
      <Space style={{ marginBottom: 12 }} wrap>
        <Segmented
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as 'all' | 'learned' | 'unlearned')}
          options={[
            { label: `全部 (${rows.length})`, value: 'all' },
            { label: `已学 (${learnedCount})`, value: 'learned' },
            { label: `未学 (${unlearnedCount})`, value: 'unlearned' },
          ]}
        />
        <Select
          value={areaFilter}
          style={{ width: 220 }}
          onChange={(v) => setAreaFilter(v as KnowledgeArea | 'all')}
          options={[
            { label: '全部域', value: 'all' },
            ...(Object.keys(KNOWLEDGE_AREA_LABELS) as KnowledgeArea[]).map((a) => ({
              label: KNOWLEDGE_AREA_LABELS[a],
              value: a,
            })),
          ]}
        />
      </Space>
      <Table<ChecklistRow>
        rowKey={(r) => r.node.id}
        size="small"
        columns={checklistColumns}
        dataSource={filteredRows}
        pagination={{ pageSize: 15, showSizeChanger: true, showTotal: (t) => `共 ${t} 个知识点` }}
        scroll={{ x: 860 }}
      />
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8 }}>
        状态由「所属主题的练习记录」决定：主题下有作答记录即记为「已学」。新用户（无记录）会看到全部 67 个知识点为「未学」。
      </Typography.Paragraph>
    </div>
  );

  return (
    <div style={{ maxWidth: 980, margin: '0 auto' }}>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        <ThunderboltOutlined /> 我的进步
      </Typography.Title>
      <Tabs
        defaultActiveKey="overview"
        items={[
          { key: 'overview', label: '进度概览', children: overview },
          { key: 'knowledge', label: `知识点清单 (${rows.length})`, children: checklist },
        ]}
      />
      <SessionReplayDrawer record={replay} onClose={() => setReplay(null)} />
    </div>
  );
}
