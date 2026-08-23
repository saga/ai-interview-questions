import { Select, Input, Alert, Button, Card, Typography, Switch, Space, App as AntdApp } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import type { AIConfig, ProviderEntry, ProviderId } from '../../types';
import { chromeAvailability, type ChromeAvailability } from '../../ai/chrome';
import { DEFAULT_LOCAL_BASE_URL } from '../../ai/local';
import { isEntryValid } from '../../ai/provider';

const PROVIDER_OPTIONS: { label: string; value: ProviderId }[] = [
  { label: '本地 AI（Chrome 内置，推荐，无需密钥）', value: 'chrome' },
  { label: '本地 API（OpenAI 兼容，如 Unsloth / vLLM / Ollama）', value: 'local' },
  { label: 'OpenRouter（CORS 友好，模型多）', value: 'openrouter' },
  { label: 'OpenAI', value: 'openai' },
  { label: 'Anthropic', value: 'anthropic' },
  { label: 'DeepSeek', value: 'deepseek' },
];

const PROVIDER_LABELS: Record<ProviderId, string> = Object.fromEntries(
  PROVIDER_OPTIONS.map((o) => [o.value, o.label]),
) as Record<ProviderId, string>;

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

export const MODEL_OPTIONS: Record<ProviderId, { label: string; value: string }[]> = {
  openrouter: [
    { label: 'OpenAI GPT-4o mini', value: 'openai/gpt-4o-mini' },
    { label: 'OpenAI GPT-4o', value: 'openai/gpt-4o' },
    { label: 'Anthropic Claude 3.5 Sonnet', value: 'anthropic/claude-3.5-sonnet' },
    { label: 'Google Gemini 2.0 Flash', value: 'google/gemini-2.0-flash-001' },
    { label: 'DeepSeek V3', value: 'deepseek/deepseek-chat' },
  ],
  openai: [
    { label: 'GPT-4o mini', value: 'gpt-4o-mini' },
    { label: 'GPT-4o', value: 'gpt-4o' },
    { label: 'GPT-4.1', value: 'gpt-4.1' },
  ],
  anthropic: [
    { label: 'Claude Sonnet 4.5', value: 'claude-sonnet-4-5' },
    { label: 'Claude 3.5 Sonnet', value: 'claude-3-5-sonnet' },
    { label: 'Claude 3.5 Haiku', value: 'claude-3-5-haiku' },
  ],
  deepseek: [{ label: 'DeepSeek V4 Flash', value: 'deepseek-v4-flash' }],
  chrome: [], // 本地内置模型，无模型 ID 可选
  local: [], // 本地 API 模型由服务端决定，自由输入（如 unsloth/Qwen3-VL-8B-Instruct）
};

/** 新增引擎通道时的默认配置：云端取该服务商首个预设模型。 */
function defaultEntry(id: ProviderId): ProviderEntry {
  return { id, enabled: true, model: MODEL_OPTIONS[id][0]?.value ?? '', apiKey: '', baseUrl: '' };
}

function isCloud(id: ProviderId): boolean {
  return id !== 'chrome' && id !== 'local';
}

interface Props {
  config: AIConfig;
  onSave: (c: AIConfig) => void;
}

export default function SettingsPanel({ config, onSave }: Props) {
  const { message } = AntdApp.useApp();
  const [entries, setEntries] = useState<ProviderEntry[]>(() => config.providers.map((e) => ({ ...e })));
  const [availability, setAvailability] = useState<ChromeAvailability | null>(null);

  useEffect(() => {
    let alive = true;
    chromeAvailability().then((s) => {
      if (alive) setAvailability(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  const update = (idx: number, patch: Partial<ProviderEntry>) =>
    setEntries((prev) => prev.map((e, i) => (i === idx ? { ...e, ...patch } : e)));

  const move = (idx: number, dir: -1 | 1) =>
    setEntries((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });

  const remove = (idx: number) => setEntries((prev) => prev.filter((_, i) => i !== idx));

  const add = () => {
    const unused = PROVIDER_OPTIONS.find((o) => !entries.some((e) => e.id === o.value));
    if (!unused) return;
    setEntries((prev) => [...prev, defaultEntry(unused.value)]);
  };

  const handleSave = () => {
    if (entries.length === 0) {
      message.error('请至少添加一个 AI 引擎');
      return;
    }
    const invalid = entries.filter((e) => e.enabled && !isEntryValid(e)).map((e) => PROVIDER_LABELS[e.id]);
    if (invalid.length > 0) {
      message.error(`以下启用的引擎配置不完整：${invalid.join('、')}`);
      return;
    }
    onSave({ providers: entries });
  };

  return (
    <Card style={{ maxWidth: 720, margin: '0 auto' }}>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        AI 设置
      </Typography.Title>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="多引擎降级链"
        description="可同时启用多个 AI 引擎并排定优先级（从上到下）。调用时先尝试靠前的引擎（如免费的 Chrome 内置模型 / 本地 Unsloth），失败或不可用时自动切换到下一个引擎——建议把云端强模型放在最后兜底。密钥仅保存在本机浏览器（localStorage），不会上传到任何服务器；但浏览器侧密钥并非安全机密，请勿使用高权限生产密钥。"
      />
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        {entries.map((entry, idx) => {
          const isChrome = entry.id === 'chrome';
          const isLocal = entry.id === 'local';
          return (
            <Card
              key={entry.id}
              size="small"
              type="inner"
              title={
                <Space>
                  <Switch checked={entry.enabled} onChange={(v) => update(idx, { enabled: v })} />
                  <span>{PROVIDER_LABELS[entry.id]}</span>
                  {!entry.enabled && <Typography.Text type="secondary">已停用</Typography.Text>}
                </Space>
              }
              extra={
                <Space>
                  <Button type="text" size="small" icon={<ArrowUpOutlined />} disabled={idx === 0} onClick={() => move(idx, -1)} />
                  <Button
                    type="text"
                    size="small"
                    icon={<ArrowDownOutlined />}
                    disabled={idx === entries.length - 1}
                    onClick={() => move(idx, 1)}
                  />
                  <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => remove(idx)} />
                </Space>
              }
            >
              {isChrome ? (
                entry.enabled && (
                  <Alert
                    type={availability ? AVAILABILITY_TEXT[availability].type : 'info'}
                    showIcon
                    message={availability ? AVAILABILITY_TEXT[availability].message : '正在检测本地模型可用性…'}
                  />
                )
              ) : (
                <>
                  {isLocal && (
                    <Alert
                      type="info"
                      showIcon
                      style={{ marginBottom: 12 }}
                      message={`直连本机运行的 OpenAI 兼容服务（默认 ${DEFAULT_LOCAL_BASE_URL} 即 Unsloth Studio）。推理与数据全部留在本机，无需 API Key；请确认服务已启动并允许浏览器跨域（CORS）访问。`}
                    />
                  )}
                  <Typography.Paragraph style={{ marginBottom: 4 }}>{isLocal ? '模型 ID' : '模型'}</Typography.Paragraph>
                  {isLocal ? (
                    <Input
                      placeholder="如 unsloth/Qwen3-VL-8B-Instruct（以本地服务的 /v1/models 为准）"
                      value={entry.model}
                      onChange={(e) => update(idx, { model: e.target.value })}
                    />
                  ) : (
                    <Select
                      style={{ width: '100%' }}
                      options={MODEL_OPTIONS[entry.id]}
                      showSearch
                      placeholder="选择或输入模型 ID"
                      value={entry.model || undefined}
                      onChange={(v) => update(idx, { model: v })}
                    />
                  )}
                  {isLocal ? (
                    <>
                      <Typography.Paragraph style={{ margin: '12px 0 4px' }}>服务地址</Typography.Paragraph>
                      <Input
                        placeholder={DEFAULT_LOCAL_BASE_URL}
                        value={entry.baseUrl ?? ''}
                        onChange={(e) => update(idx, { baseUrl: e.target.value })}
                      />
                    </>
                  ) : (
                    <>
                      <Typography.Paragraph style={{ margin: '12px 0 4px' }}>API Key</Typography.Paragraph>
                      <Input.Password
                        placeholder="sk-... / 你的服务商密钥"
                        value={entry.apiKey}
                        onChange={(e) => update(idx, { apiKey: e.target.value })}
                      />
                    </>
                  )}
                </>
              )}
            </Card>
          );
        })}
      </Space>
      <Button
        block
        style={{ marginTop: 16 }}
        icon={<PlusOutlined />}
        disabled={entries.length >= PROVIDER_OPTIONS.length}
        onClick={add}
      >
        添加引擎
      </Button>
      {entries.some((e) => isCloud(e.id)) && (
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: '12px 0 0' }}>
          浏览器直连受 CORS 限制：优先推荐 OpenRouter；OpenAI / Anthropic 直连失败时请改用 OpenRouter 或自配代理。
        </Typography.Paragraph>
      )}
      <Button type="primary" block style={{ marginTop: 16 }} onClick={handleSave}>
        保存设置
      </Button>
    </Card>
  );
}
