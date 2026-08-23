import { Form, Select, Input, Alert, Button, Card, Typography } from 'antd';
import { useEffect, useState } from 'react';
import type { PiConfig, ProviderId } from '../../types';
import { chromeAvailability, type ChromeAvailability } from '../../ai/chrome';

const PROVIDER_OPTIONS: { label: string; value: ProviderId }[] = [
  { label: '本地 AI（Chrome 内置，推荐，无需密钥）', value: 'chrome' },
  { label: 'OpenRouter（CORS 友好，模型多）', value: 'openrouter' },
  { label: 'OpenAI', value: 'openai' },
  { label: 'Anthropic', value: 'anthropic' },
  { label: 'DeepSeek', value: 'deepseek' },
];

const AVAILABILITY_TEXT: Record<ChromeAvailability, { type: 'success' | 'warning' | 'error'; message: string }> = {
  available: { type: 'success', message: '本地模型已就绪：推理在本机完成，无需 API Key，答案不出设备。' },
  downloading: { type: 'warning', message: '本地模型正在下载中，完成后即可使用；也可先改用云端服务商。' },
  downloadable: {
    type: 'warning',
    message: '当前 Chrome 支持内置 AI 但模型尚未下载（设置 → 隐私和安全 → AI 实验功能，或在首次使用时自动下载）。',
  },
  unavailable: {
    type: 'error',
    message: '当前浏览器不支持 Chrome 内置 AI（需较新版 Chrome 且启用 Prompt API）。请改用下方云端服务商。',
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
};

interface Props {
  config: PiConfig;
  onSave: (c: PiConfig) => void;
}

export default function SettingsPanel({ config, onSave }: Props) {
  const [form] = Form.useForm<PiConfig>();
  const provider = Form.useWatch('provider', form) ?? config.provider;
  const isChrome = provider === 'chrome';
  const [availability, setAvailability] = useState<ChromeAvailability | null>(null);

  useEffect(() => {
    if (!isChrome) return;
    let alive = true;
    chromeAvailability().then((s) => {
      if (alive) setAvailability(s);
    });
    return () => {
      alive = false;
    };
  }, [isChrome]);

  const handleSave = async () => {
    const values = await form.validateFields();
    onSave({ ...values, model: values.model ?? '', apiKey: values.apiKey ?? '' });
  };

  return (
    <Card style={{ maxWidth: 640, margin: '0 auto' }}>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        AI 设置
      </Typography.Title>
      {isChrome ? (
        <Alert
          type={availability ? AVAILABILITY_TEXT[availability].type : 'info'}
          showIcon
          style={{ marginBottom: 16 }}
          message={availability ? AVAILABILITY_TEXT[availability].message : '正在检测本地模型可用性…'}
        />
      ) : (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="密钥仅保存在本机浏览器（localStorage），不会上传到任何服务器。本架构是 local-first 的隐私友好设计；但浏览器侧密钥并非安全机密（受 XSS / 恶意扩展威胁），请勿使用高权限生产密钥。"
        />
      )}
      <Form form={form} layout="vertical" initialValues={config}>
        <Form.Item name="provider" label="AI 引擎" rules={[{ required: true }]}>
          <Select
            options={PROVIDER_OPTIONS}
            onChange={(p) => {
              // 切换服务商时重置模型，避免保存出跨服务商的非法组合
              const first = MODEL_OPTIONS[p as ProviderId]?.[0]?.value;
              if (first) form.setFieldValue('model', first);
            }}
          />
        </Form.Item>
        {!isChrome && (
          <>
            <Form.Item name="model" label="模型" rules={[{ required: true }]}>
              <Select
                options={MODEL_OPTIONS[provider as ProviderId] ?? MODEL_OPTIONS.openrouter}
                showSearch
                placeholder="选择或输入模型 ID"
              />
            </Form.Item>
            <Form.Item name="apiKey" label="API Key" rules={[{ required: true, message: '请填写 API Key' }]}>
              <Input.Password placeholder="sk-... / 你的服务商密钥" />
            </Form.Item>
          </>
        )}
      </Form>
      {!isChrome && (
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
          浏览器直连受 CORS 限制：优先推荐 OpenRouter；OpenAI / Anthropic 直连失败时请改用 OpenRouter 或自配代理。
        </Typography.Paragraph>
      )}
      <Button type="primary" block style={{ marginTop: 16 }} onClick={handleSave}>
        保存设置
      </Button>
    </Card>
  );
}
