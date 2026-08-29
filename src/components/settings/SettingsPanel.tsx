import { Alert, Button, Card, Collapse, Divider, Empty, Input, InputNumber, List, Popconfirm, Switch, Tabs, Tag, Typography, Space, App as AntdApp } from 'antd';
import { UndoOutlined, SaveOutlined, DeleteOutlined, ClearOutlined, ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';
import { Suspense, lazy, useEffect, useState } from 'react';
import type { AIConfig } from '../../schemas/ai-config';
import { chromeAvailability, type ChromeAvailability } from '../../ai/chrome';
import { DEFAULT_LOCAL_BASE_URL } from '../../ai/local';
import { DEFAULT_CONFIG, parseConfigJSON, stringifyConfig } from '../../storage/settings';
import { getAIConfigJsonSchema } from '../../schemas/jsonSchema';
import { getErrorLogs, clearErrorLogs, type ErrorLogEntry } from '../../storage/db';
import { resetLearnerData } from '../../storage/learner';
import { INTERVIEW_AGENT_SYSTEM_PROMPT } from '../../agent/prompt';
import { EVAL_SYSTEM } from '../../ai/evaluate';
import { VARIANT_SYSTEM } from '../../ai/variant';

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

interface Props {
  config: AIConfig;
  onSave: (c: AIConfig) => void;
  /** 重置学习数据后回调，用于父组件把内存中的画像同步回空画像。 */
  onResetLearner?: () => void;
}

export default function SettingsPanel({ config, onSave, onResetLearner }: Props) {
  const { message } = AntdApp.useApp();
  const [text, setText] = useState(() => stringifyConfig(config));
  const [draft, setDraft] = useState<AIConfig>(config);
  const [promptDraft, setPromptDraft] = useState(() => ({
    agentSystem: config.prompts?.agentSystem ?? INTERVIEW_AGENT_SYSTEM_PROMPT,
    evaluationSystem: config.prompts?.evaluationSystem ?? EVAL_SYSTEM,
    variantSystem: config.prompts?.variantSystem ?? VARIANT_SYSTEM,
  }));
  const [activeTab, setActiveTab] = useState('settings');
  const [availability, setAvailability] = useState<ChromeAvailability | null>(null);
  const [logs, setLogs] = useState<ErrorLogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  const loadLogs = async () => {
    setLogsLoading(true);
    try {
      setLogs(await getErrorLogs(100));
    } finally {
      setLogsLoading(false);
    }
  };

  useEffect(() => {
    setDraft(config);
    setText(stringifyConfig(config));
    setPromptDraft({
      agentSystem: config.prompts?.agentSystem ?? INTERVIEW_AGENT_SYSTEM_PROMPT,
      evaluationSystem: config.prompts?.evaluationSystem ?? EVAL_SYSTEM,
      variantSystem: config.prompts?.variantSystem ?? VARIANT_SYSTEM,
    });
  }, [config]);

  useEffect(() => {
    let alive = true;
    chromeAvailability().then((s) => {
      if (alive) setAvailability(s);
    });
    return () => {
      alive = false;
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

  const handleSave = () => {
    const res = parseConfigJSON(text);
    if (!res.ok) {
      message.error(res.error);
      return;
    }
    onSave(res.config);
    setDraft(res.config);
  };

  const updateProvider = (index: number, patch: Partial<AIConfig['providers'][number]>) => {
    setDraft((current) => ({
      ...current,
      providers: current.providers.map((provider, i) => (i === index ? { ...provider, ...patch } : provider)),
    }));
  };

  const moveProvider = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= draft.providers.length) return;
    setDraft((current) => {
      const providers = [...current.providers];
      [providers[index], providers[target]] = [providers[target], providers[index]];
      return { ...current, providers };
    });
  };

  const handleFormSave = () => {
    const next = { ...draft, masteryThreshold: draft.masteryThreshold ?? 75 };
    setDraft(next);
    setText(stringifyConfig(next));
    onSave(next);
    message.success('设置已保存');
  };

  const handlePromptSave = () => {
    const prompts = {
      agentSystem: promptDraft.agentSystem.trim() || undefined,
      evaluationSystem: promptDraft.evaluationSystem.trim() || undefined,
      variantSystem: promptDraft.variantSystem.trim() || undefined,
    };
    const next = { ...draft, prompts };
    setDraft(next);
    setText(stringifyConfig(next));
    onSave(next);
    message.success('提示词已保存');
  };

  return (
    <Card style={{ maxWidth: 860, margin: '0 auto' }}>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        AI 设置
      </Typography.Title>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="直接编辑 config.json"
        description={
          <>
            引擎配置就是一份 JSON：<code>providers</code> 数组即多引擎降级链，
            按顺序从上到下尝试，失败的引擎自动切到下一个。可用引擎：
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
            布尔字段 <code>generateOpenQuestions</code> 控制是否生成开放题（默认 false：纯开放题不入卷，
            双形态题一律出选择；改为 true 恢复开放题）。
            数字字段 <code>masteryThreshold</code> 控制主题达标线（0-100，默认 75）；主题平均分达到该值后不再作为薄弱项推荐。
            配置仅保存在本机浏览器（localStorage），不会上传；但浏览器侧密钥并非安全机密，请勿使用高权限生产密钥。
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
        onChange={setActiveTab}
        items={[{ key: 'settings', label: '基础配置' }, { key: 'prompts', label: '提示词' }]}
        style={{ marginBottom: 16 }}
      />
      {activeTab === 'prompts' ? (
        <Space direction="vertical" style={{ width: '100%' }} size={16}>
          <Alert
            type="info"
            showIcon
            message="提示词覆盖"
            description="这里修改的内容会在下一次 AI 调用时生效；恢复为默认文本即可删除自定义覆盖。提示词仅保存在本机。"
          />
          <div>
            <Typography.Text strong>Agent 系统提示词</Typography.Text>
            <Input.TextArea autoSize={{ minRows: 10, maxRows: 24 }} value={promptDraft.agentSystem} onChange={(event) => setPromptDraft((current) => ({ ...current, agentSystem: event.target.value }))} />
          </div>
          <div>
            <Typography.Text strong>开放题评分系统提示词</Typography.Text>
            <Input.TextArea autoSize={{ minRows: 5, maxRows: 16 }} value={promptDraft.evaluationSystem} onChange={(event) => setPromptDraft((current) => ({ ...current, evaluationSystem: event.target.value }))} />
          </div>
          <div>
            <Typography.Text strong>题目变体系统提示词</Typography.Text>
            <Input.TextArea autoSize={{ minRows: 10, maxRows: 28 }} value={promptDraft.variantSystem} onChange={(event) => setPromptDraft((current) => ({ ...current, variantSystem: event.target.value }))} />
          </div>
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button onClick={() => setPromptDraft({ agentSystem: INTERVIEW_AGENT_SYSTEM_PROMPT, evaluationSystem: EVAL_SYSTEM, variantSystem: VARIANT_SYSTEM })}>恢复提示词默认值</Button>
            <Button type="primary" icon={<SaveOutlined />} onClick={handlePromptSave}>保存提示词</Button>
          </Space>
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
              {provider.id !== 'chrome' && (
                <Input
                  addonBefore="Base URL"
                  value={provider.baseUrl ?? ''}
                  onChange={(event) => updateProvider(index, { baseUrl: event.target.value })}
                  placeholder={provider.id === 'local' ? DEFAULT_LOCAL_BASE_URL : '可选'}
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
      <Divider />
      <Typography.Title level={5}>高级 JSON 编辑</Typography.Title>
      <Suspense fallback={null}>
        <LazyCodeEditor value={text} onChange={setText} language="json" height={420} />
      </Suspense>
      <Space style={{ marginTop: 16, width: '100%', justifyContent: 'flex-end' }}>
        <Button icon={<UndoOutlined />} onClick={() => setText(stringifyConfig(DEFAULT_CONFIG))}>
          恢复默认
        </Button>
        <Button type="primary" icon={<SaveOutlined />} onClick={handleSave}>
          保存设置
        </Button>
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
            onResetLearner?.();
            message.success('学习数据已重置');
          }}
        >
          <Button danger icon={<ClearOutlined />}>
            重置学习数据
          </Button>
        </Popconfirm>
      </Space>
      <Collapse
        style={{ marginTop: 16 }}
        items={[
          {
            key: 'diag',
            label: `错误日志（诊断回溯，仅本机）${logs.length ? ` · ${logs.length} 条` : ''}`,
            children: (
              <div>
                <Space style={{ marginBottom: 12 }}>
                  <Button
                    size="small"
                    onClick={async () => {
                      await loadLogs();
                      message.success('已刷新');
                    }}
                  >
                    刷新
                  </Button>
                  <Button
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={async () => {
                      await clearErrorLogs();
                      setLogs([]);
                      message.success('已清空错误日志');
                    }}
                  >
                    清空
                  </Button>
                </Space>
                {logsLoading ? (
                  <Typography.Text type="secondary">加载中…</Typography.Text>
                ) : logs.length === 0 ? (
                  <Empty description="暂无记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                ) : (
                  <List
                    size="small"
                    dataSource={logs}
                    renderItem={(item) => (
                      <List.Item style={{ display: 'block' }}>
                        <Space size={8} wrap>
                          <Tag color="red">{item.scope}</Tag>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            {new Date(item.createdAt).toLocaleString()}
                          </Typography.Text>
                        </Space>
                        <div style={{ marginTop: 4 }}>{item.message}</div>
                        {item.detail != null && (
                          <pre
                            style={{
                              margin: '6px 0 0',
                              padding: 8,
                              background: '#f5f5f5',
                              borderRadius: 6,
                              fontSize: 12,
                              maxHeight: 200,
                              overflow: 'auto',
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                            }}
                          >
                            {JSON.stringify(item.detail, null, 2)}
                          </pre>
                        )}
                      </List.Item>
                    )}
                  />
                )}
              </div>
            ),
          },
        ]}
        onChange={(keys) => {
          if (Array.isArray(keys) && keys.includes('diag')) void loadLogs();
        }}
      />
    </Card>
  );
}
