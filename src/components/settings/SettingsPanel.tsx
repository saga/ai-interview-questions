import { Alert, Button, Card, Collapse, Divider, Empty, Input, InputNumber, Popconfirm, Select, Switch, Tabs, Tag, Typography, Space, App as AntdApp, Table } from 'antd';
import type { TableColumnsType } from 'antd';
import { UndoOutlined, SaveOutlined, DeleteOutlined, ClearOutlined, ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';
import { Suspense, lazy, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { AIConfig } from '../../schemas/ai-config';
import { chromeAvailability, type ChromeAvailability } from '../../ai/chrome';
import { DEFAULT_LOCAL_BASE_URL } from '../../ai/local';
import { DEFAULT_CONFIG, stringifyConfig } from '../../storage/settings';
import { getAIConfigJsonSchema } from '../../schemas/jsonSchema';
import { getErrorLogs, clearErrorLogs, recordLog, type ErrorLogEntry } from '../../storage/db';
import { resetLearnerData } from '../../storage/learner';
import { INTERVIEW_AGENT_OPENING_INSTRUCTION, USER_CUSTOM_PROMPT_MAX } from '../../agent/prompt';
import { MAX_AGENT_QUESTIONS } from '../../agent/interviewAgent';
import type { PromptDraft } from '../../hooks/useSettingsDraft';

const LazyCodeEditor = lazy(() => import('../common/CodeEditor'));

const PROVIDER_LABELS: Record<string, string> = {
  chrome: 'Chrome 内置 AI',
  local: '本地 OpenAI 兼容服务',
  deepseek: 'DeepSeek',
  openrouter: 'OpenRouter',
  google: 'Google Gemini',
  'cloudflare-workers-ai': 'Cloudflare Workers AI',
};

const AVAILABILITY_TEXT: Record<ChromeAvailability, { type: 'success' | 'warning' | 'error'; message: string }> = {
  available: { type: 'success', message: '本地模型已就绪：推理在本机完成，无需 API Key，答案不出设备。' },
  downloading: { type: 'warning', message: '本地模型正在下载中，完成后即可使用；期间会自动降级到降级链中的下一个引擎。' },
  downloadable: {
    type: 'warning',
    message:
      '当前 Chrome 支持内置 AI 但模型尚未下载（设置 → 隐私和安全 → AI 实验功能，或在首次使用时自动下载）；未就绪时该引擎调用失败会自动降级。',
  },
  unavailable: {
    type: 'error',
    message: '当前浏览器不支持 Chrome 内置 AI（需较新版 Chrome 且启用 Prompt API）；该引擎会被自动跳过。',
  },
};

/** 日志类型展示元信息（错误 / 审计 / 运行）。 */
const LOG_KIND_META: Record<string, { label: string; color: string }> = {
  error: { label: '错误', color: 'red' },
  audit: { label: '审计', color: 'blue' },
  runtime: { label: '运行', color: 'green' },
};

/** 日志级别 → Tag 颜色。 */
const LOG_LEVEL_COLOR: Record<string, string> = {
  error: 'red',
  warning: 'orange',
  info: 'default',
};

/** 诊断日志表格列定义（设置 → 日志），用 antd Table 呈现，错误日志按类型 / 级别着色。 */
const LOG_TABLE_COLUMNS: TableColumnsType<ErrorLogEntry> = [
  {
    title: '时间',
    dataIndex: 'createdAt',
    key: 'createdAt',
    width: 180,
    sorter: (a, b) => a.createdAt - b.createdAt,
    defaultSortOrder: 'descend',
    render: (createdAt: number) => (
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {new Date(createdAt).toLocaleString()}
      </Typography.Text>
    ),
  },
  {
    title: '类型',
    key: 'kind',
    width: 90,
    render: (_: unknown, record) => {
      const kind = record.kind ?? 'error';
      const meta = LOG_KIND_META[kind] ?? { label: kind, color: 'default' };
      return <Tag color={meta.color}>{meta.label}</Tag>;
    },
  },
  {
    title: '级别',
    dataIndex: 'level',
    key: 'level',
    width: 90,
    render: (level?: string) => {
      const lv = level ?? 'info';
      return <Tag color={LOG_LEVEL_COLOR[lv] ?? 'default'}>{lv}</Tag>;
    },
  },
  {
    title: '模块',
    dataIndex: 'scope',
    key: 'scope',
    width: 120,
    render: (scope: string) => <Tag>{scope}</Tag>,
  },
  {
    title: '事件',
    dataIndex: 'event',
    key: 'event',
    width: 150,
    render: (event?: string) => <Typography.Text type="secondary">{event ?? '—'}</Typography.Text>,
  },
  {
    title: '信息',
    dataIndex: 'message',
    key: 'message',
    ellipsis: true,
  },
];

interface Props {
  /** 重置学习数据后回调，用于父组件把内存中的画像同步回空画像。 */
  onResetLearner?: () => void;
  // 以下编辑态由 App 层 useSettingsDraft 提升，切 tab 再切回时保留未保存草稿
  draft: AIConfig;
  setDraft: Dispatch<SetStateAction<AIConfig>>;
  text: string;
  setText: Dispatch<SetStateAction<string>>;
  promptDraft: PromptDraft;
  setPromptDraft: Dispatch<SetStateAction<PromptDraft>>;
  activeTab: string;
  setActiveTab: Dispatch<SetStateAction<string>>;
  updateProvider: (index: number, patch: Partial<AIConfig['providers'][number]>) => void;
  moveProvider: (index: number, direction: -1 | 1) => void;
  updateProficiency: (key: keyof AIConfig['proficiency'], value: number | null) => void;
  handleFormSave: () => void;
  handlePromptSave: () => void;
  handleSave: () => void;
}

export default function SettingsPanel({
  onResetLearner,
  draft,
  setDraft,
  text,
  setText,
  promptDraft,
  setPromptDraft,
  activeTab,
  setActiveTab,
  updateProvider,
  moveProvider,
  updateProficiency,
  handleFormSave,
  handlePromptSave,
  handleSave,
}: Props) {
  const { message } = AntdApp.useApp();
  const [availability, setAvailability] = useState<ChromeAvailability | null>(null);
  const [logs, setLogs] = useState<ErrorLogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logKind, setLogKind] = useState<'all' | 'error' | 'audit' | 'runtime'>('all');

  const loadLogs = async () => {
    setLogsLoading(true);
    try {
      setLogs(await getErrorLogs(100));
    } finally {
      setLogsLoading(false);
    }
  };

  // 初始检测 + 轮询：Chrome Prompt API 在模型刚下载完时 often 仍返回 `downloading`，
  // 故状态为 downloading 时每 4s 复查，直到变为 available / unavailable / downloadable 才停。
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | undefined;

    const check = async () => {
      const s = await chromeAvailability();
      if (!alive) return;
      setAvailability(s);
      if (s === 'downloading') {
        if (!timer) timer = setInterval(check, 4000);
      } else if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
    };

    void check();
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, []);

  // Monaco JSON Schema：由 Zod 单一来源派生，提供校验/补全/悬停（z.toJSONSchema）
  useEffect(() => {
    let cancelled = false;
    import('monaco-editor').then((monaco) => {
      if (cancelled) return;
      const schema = getAIConfigJsonSchema() as Record<string, unknown>;
      // monaco 的 json 语言服务在首次加载 json worker 后生效；此处配置全局诊断
      const jsonDefaults = (monaco.languages as unknown as { json?: { jsonDefaults?: { setDiagnosticsOptions: (opts: unknown) => void } } }).json
        ?.jsonDefaults;
      if (jsonDefaults) {
        jsonDefaults.setDiagnosticsOptions({
          validate: true,
          allowComments: false,
          schemas: [
            {
              uri: 'http://ai-interview-trainer/ai-config.json',
              // fileMatch 匹配 Monaco 模型的 uri；CodeEditor 未指定 uri 时默认为内存模型，'*' 可覆盖
              fileMatch: ['*'],
              schema,
            },
          ],
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleLogs = logs.filter((item) => logKind === 'all' || (item.kind ?? 'error') === logKind);

  return (
    <Card style={{ maxWidth: 860, margin: '0 auto' }}>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        AI 设置
      </Typography.Title>
      <Alert
        type="info"
        showIcon
        closable
        style={{ marginBottom: 16 }}
        message="配置分为四部分"
        description={
          <>
            基础配置管理出题开关和 AI 引擎，熟练度管理学习算法，提示词管理 AI 指令；
            需要批量修改或导入导出完整配置时，再使用“高级 JSON”。所有配置仅保存在本机浏览器。
            <br />
            AI 引擎按列表顺序组成降级链，失败时自动尝试下一个。可用引擎：
            <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
              <li>
                <code>chrome</code> —— 浏览器内置 AI，无需密钥；
              </li>
              <li>
                <code>local</code> —— 本机 OpenAI 兼容服务（默认 {DEFAULT_LOCAL_BASE_URL}），无需密钥；
              </li>
              <li>
                <code>deepseek</code> / <code>openrouter</code> / <code>google</code>（Gemini）—— 云端直连，需 API Key；
              </li>
              <li>
                <code>cloudflare-workers-ai</code> —— Cloudflare Workers AI，需 API Token + Account ID。
              </li>
            </ul>
            浏览器侧密钥并非安全机密，请勿使用高权限生产密钥。
          </>
        }
      />
      {availability && (
        <Alert
          type={AVAILABILITY_TEXT[availability].type}
          showIcon
          style={{ marginBottom: 16 }}
          message={`Chrome 内置 AI 状态：${AVAILABILITY_TEXT[availability].message}`}
        />
      )}
      <Tabs
        activeKey={activeTab}
        items={[
          { key: 'settings', label: '基础配置' },
          { key: 'proficiency', label: '熟练度' },
          { key: 'prompts', label: '提示词' },
          { key: 'json', label: '高级 JSON' },
          { key: 'logs', label: '日志' },
        ]}
        style={{ marginBottom: 16 }}
        onChange={(key) => {
          setActiveTab(key);
          if (key === 'logs') void loadLogs();
        }}
      />
      {activeTab === 'prompts' ? (
        <Space direction="vertical" style={{ width: '100%' }} size={16}>
          <Alert
            type="info"
            showIcon
            message="提示词分层（不可覆盖的安全层 + 可配置偏好层）"
            description="内置的「安全策略」与「面试官契约」系统提示词始终生效且不可修改——它们负责安全边界与评分/题库完整性协议。你只能配置下方的「Agent 自定义指令」（目标 / 风格 / 偏好），它只追加在安全层之后，无法覆盖它们。配置仅保存在本机，下次 AI 调用时生效。"
          />
          <div>
            <Typography.Text strong>Agent 自定义指令</Typography.Text>
            <div style={{ marginBottom: 4 }}>
              <Typography.Text type="secondary">
                描述你希望这场面试怎样进行（考察重点、提问风格、语气、偏好等）。它不是系统提示词、不能改写安全边界，模型会把它作为偏好参考。最多 {USER_CUSTOM_PROMPT_MAX} 字符，超出部分会截断。
              </Typography.Text>
            </div>
            <Input.TextArea
              autoSize={{ minRows: 6, maxRows: 16 }}
              maxLength={USER_CUSTOM_PROMPT_MAX}
              showCount
              value={promptDraft.agentInstructions}
              onChange={(event) => setPromptDraft((current) => ({ ...current, agentInstructions: event.target.value }))}
              placeholder="例如：多考察系统设计，少问纯记忆题；用中文回答；语气更严厉一些。"
            />
          </div>
          <div>
            <Typography.Text strong>Agent 开场指令</Typography.Text>
            <div style={{ marginBottom: 4 }}>
              <Typography.Text type="secondary">
                面试第一轮发给模型的指令，决定本轮流程（题数、顺序）。题数硬上限由代码控制（{MAX_AGENT_QUESTIONS} 题），此处只是给模型的软目标。
              </Typography.Text>
            </div>
            <Input.TextArea autoSize={{ minRows: 5, maxRows: 16 }} value={promptDraft.agentOpening} onChange={(event) => setPromptDraft((current) => ({ ...current, agentOpening: event.target.value }))} />
          </div>
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button onClick={() => setPromptDraft({ agentInstructions: '', agentOpening: INTERVIEW_AGENT_OPENING_INSTRUCTION })}>恢复提示词默认值</Button>
            <Button type="primary" icon={<SaveOutlined />} onClick={handlePromptSave}>保存提示词</Button>
          </Space>
        </Space>
      ) : activeTab === 'proficiency' ? (
        <Space direction="vertical" style={{ width: '100%' }} size={16}>
          <Alert
            type="info"
            showIcon
            message="熟练度算法"
            description="熟练度由得分、题目数量和跨训练会话的练习次数共同决定。开放题和选择题使用各自的评分权重；调整后会影响后续训练以及重新加载时的历史画像计算。"
          />
          <Typography.Title level={5} style={{ margin: 0 }}>题型权重</Typography.Title>
          <Space wrap>
            <Typography.Text>选择题权重</Typography.Text>
            <InputNumber min={0.1} step={0.5} value={draft.proficiency.choiceWeight} onChange={(value) => updateProficiency('choiceWeight', value)} />
            <Typography.Text>开放题权重</Typography.Text>
            <InputNumber min={0.1} step={0.5} value={draft.proficiency.openWeight} onChange={(value) => updateProficiency('openWeight', value)} />
          </Space>
          <Typography.Title level={5} style={{ margin: 0 }}>熟练度构成</Typography.Title>
          <Space wrap>
            <Typography.Text>基础系数</Typography.Text>
            <InputNumber min={0} max={1} step={0.05} value={draft.proficiency.baseCoefficient} onChange={(value) => updateProficiency('baseCoefficient', value)} />
            <Typography.Text>题量系数</Typography.Text>
            <InputNumber min={0} max={1} step={0.05} value={draft.proficiency.questionCoefficient} onChange={(value) => updateProficiency('questionCoefficient', value)} />
            <Typography.Text>训练次数系数</Typography.Text>
            <InputNumber min={0} max={1} step={0.05} value={draft.proficiency.practiceCoefficient} onChange={(value) => updateProficiency('practiceCoefficient', value)} />
          </Space>
          <Typography.Text type="secondary">三个构成系数建议总和为 1，实际结果会限制在 0-100%。</Typography.Text>
          <Typography.Title level={5} style={{ margin: 0 }}>证据置信度</Typography.Title>
          <Space wrap>
            <Typography.Text>题量平滑值</Typography.Text>
            <InputNumber min={0.1} step={1} value={draft.proficiency.questionConfidenceSmoothing} onChange={(value) => updateProficiency('questionConfidenceSmoothing', value)} />
            <Typography.Text>训练次数平滑值</Typography.Text>
            <InputNumber min={0.1} step={1} value={draft.proficiency.practiceConfidenceSmoothing} onChange={(value) => updateProficiency('practiceConfidenceSmoothing', value)} />
          </Space>
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button type="primary" icon={<SaveOutlined />} onClick={handleFormSave}>保存熟练度设置</Button>
          </Space>
        </Space>
      ) : activeTab === 'json' ? (
        <Space direction="vertical" style={{ width: '100%' }} size={16}>
          <Alert
            type="warning"
            showIcon
            message="高级 JSON 编辑"
            description="这里编辑完整配置。保存时会进行结构校验、引擎清洗和重复引擎检查；校验失败不会覆盖当前配置。"
          />
          <Suspense fallback={null}>
            <LazyCodeEditor value={text} onChange={setText} language="json" height={520} />
          </Suspense>
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button icon={<UndoOutlined />} onClick={() => setText(stringifyConfig(DEFAULT_CONFIG))}>
              恢复默认文本
            </Button>
            <Button type="primary" icon={<SaveOutlined />} onClick={handleSave}>
              保存 JSON 配置
            </Button>
          </Space>
        </Space>
      ) : activeTab === 'logs' ? (
        <Space direction="vertical" style={{ width: '100%' }} size={16}>
          <Alert
            type="info"
            showIcon
            message="本地日志"
            description="这里记录配置审计、运行事件和错误诊断，仅保存在当前浏览器。日志只保留安全摘要，不包含 API Key、提示词正文或用户答案。"
          />
          <Space wrap>
            <Select
              value={logKind}
              style={{ width: 140 }}
              options={[
                { value: 'all', label: '全部日志' },
                { value: 'error', label: '错误' },
                { value: 'audit', label: '审计' },
                { value: 'runtime', label: '运行' },
              ]}
              onChange={setLogKind}
            />
            <Button size="small" onClick={async () => { await loadLogs(); message.success('已刷新日志'); }}>刷新</Button>
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={async () => { await clearErrorLogs(); setLogs([]); message.success('日志已清空'); }}
            >
              清空日志
            </Button>
          </Space>
          {logsLoading ? (
            <Typography.Text type="secondary">加载中…</Typography.Text>
          ) : visibleLogs.length === 0 ? (
            <Empty description="暂无日志" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            <Table<ErrorLogEntry>
              rowKey={(record) => record.id ?? record.createdAt}
              columns={LOG_TABLE_COLUMNS}
              dataSource={visibleLogs}
              size="small"
              scroll={{ x: 780, y: 420 }}
              pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }}
              expandable={{
                rowExpandable: (record) => record.detail != null,
                expandedRowRender: (record) =>
                  record.detail != null ? (
                    <pre
                      style={{
                        margin: 0,
                        padding: 8,
                        background: '#f5f5f5',
                        borderRadius: 6,
                        fontSize: 12,
                        maxHeight: 240,
                        overflow: 'auto',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}
                    >
                      {JSON.stringify(record.detail, null, 2)}
                    </pre>
                  ) : null,
              }}
            />
          )}
        </Space>
      ) : (
        <>
      <Typography.Title level={5}>基础设置</Typography.Title>
      <Space direction="vertical" style={{ width: '100%', marginBottom: 20 }} size={12}>
        <Space align="center" wrap>
          <Switch
            checked={draft.generateOpenQuestions}
            onChange={(checked) => setDraft((current) => ({ ...current, generateOpenQuestions: checked }))}
          />
          <Typography.Text>允许生成开放题</Typography.Text>
          <Typography.Text type="secondary">需要可用 AI 引擎，关闭时只出选择题</Typography.Text>
        </Space>
        <Space align="center" wrap>
          <Switch
            checked={draft.questionChallengerEnabled}
            onChange={(checked) => setDraft((current) => ({ ...current, questionChallengerEnabled: checked }))}
          />
          <Typography.Text>启用题目质疑者</Typography.Text>
          <Typography.Text type="secondary">使用当前配置的 AI 引擎，关闭时不调用质疑模型</Typography.Text>
        </Space>
        <Space align="center" wrap>
          <Switch
            checked={draft.runtimeVariantEnabled}
            onChange={(checked) => setDraft((current) => ({ ...current, runtimeVariantEnabled: checked }))}
          />
          <Typography.Text>使用 AI 实时生成题目变体</Typography.Text>
          <Typography.Text type="secondary">
            默认关闭：优先用离线变体池（零 LLM 落地）；开启后仅在池未命中时回退到 1 次 LLM 生成，且结果不写回题库
          </Typography.Text>
        </Space>
        <Space align="center" wrap>
          <Typography.Text>主题达标线</Typography.Text>
          <InputNumber
            min={0}
            max={100}
            precision={0}
            value={draft.masteryThreshold}
            addonAfter="分"
            onChange={(value) => setDraft((current) => ({ ...current, masteryThreshold: value ?? 75 }))}
          />
          <Typography.Text type="secondary">主题平均分达到此分数后不再推荐为薄弱项</Typography.Text>
        </Space>
      </Space>
      <Typography.Title level={5}>AI 引擎</Typography.Title>
      <Collapse
        style={{ marginBottom: 16 }}
        items={draft.providers.map((provider, index) => ({
          key: provider.id,
          label: (
            <Space>
              <Switch checked={provider.enabled} onChange={(checked) => updateProvider(index, { enabled: checked })} />
              <span>{PROVIDER_LABELS[provider.id] ?? provider.id}</span>
              <Tag color={provider.enabled ? 'green' : 'default'}>{provider.enabled ? '启用' : '停用'}</Tag>
              <Button
                size="small"
                type="text"
                icon={<ArrowUpOutlined />}
                disabled={index === 0}
                aria-label="上移引擎"
                onClick={(event) => { event.stopPropagation(); moveProvider(index, -1); }}
              />
              <Button
                size="small"
                type="text"
                icon={<ArrowDownOutlined />}
                disabled={index === draft.providers.length - 1}
                aria-label="下移引擎"
                onClick={(event) => { event.stopPropagation(); moveProvider(index, 1); }}
              />
            </Space>
          ),
          children: (
            <Space direction="vertical" style={{ width: '100%' }}>
              <Input
                addonBefore="模型"
                value={provider.model}
                onChange={(event) => updateProvider(index, { model: event.target.value })}
                placeholder={provider.id === 'chrome' ? 'Chrome 内置模型，无需填写' : '模型 ID'}
              />
              {provider.id !== 'chrome' && (
                <Input.Password
                  addonBefore={provider.id === 'cloudflare-workers-ai' ? 'API Token' : 'API Key'}
                  value={provider.apiKey}
                  onChange={(event) => updateProvider(index, { apiKey: event.target.value })}
                  placeholder="可留空（该引擎停用时不影响保存）"
                />
              )}
              {provider.id === 'local' && (
                <Input
                  addonBefore="Base URL"
                  value={provider.baseUrl ?? ''}
                  onChange={(event) => updateProvider(index, { baseUrl: event.target.value })}
                  placeholder={DEFAULT_LOCAL_BASE_URL}
                />
              )}
              {provider.id === 'cloudflare-workers-ai' && (
                <Input
                  addonBefore="Account ID"
                  value={provider.accountId ?? ''}
                  onChange={(event) => updateProvider(index, { accountId: event.target.value })}
                />
              )}
            </Space>
          ),
        }))}
      />
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'flex-end' }}>
        <Button type="primary" icon={<SaveOutlined />} onClick={handleFormSave}>保存可视化设置</Button>
      </Space>
        </>
      )}
      <Divider />
      <Space style={{ width: '100%', justifyContent: 'space-between', alignItems: 'center' }} wrap>
        <div>
          <Typography.Text strong>学习数据</Typography.Text>
          <div>
            <Typography.Text type="secondary">
              清空所有练习记录、掌握度与薄弱项，回到首次使用的干净状态（Agent 面试将重新随机探索）。不可撤销。
            </Typography.Text>
          </div>
        </div>
        <Popconfirm
          title="确认清空全部学习数据？"
          description="将删除所有练习记录、掌握度与薄弱项，无法恢复。"
          okText="清空"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          onConfirm={async () => {
            await resetLearnerData();
            await recordLog({
              kind: 'audit',
              event: 'learner_data_reset',
              level: 'warning',
              scope: 'settings',
              message: '学习数据已重置',
            });
            onResetLearner?.();
            message.success('学习数据已重置');
          }}
        >
          <Button danger icon={<ClearOutlined />}>
            重置学习数据
          </Button>
        </Popconfirm>
      </Space>
    </Card>
  );
}
