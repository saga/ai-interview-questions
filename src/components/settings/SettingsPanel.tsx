import { Form, Select, Input, Alert, Button, Card, Typography } from 'antd';
import type { PiConfig, ProviderId } from '../../types';

const PROVIDER_OPTIONS: { label: string; value: ProviderId }[] = [
  { label: 'OpenRouter（推荐，CORS 友好，模型多）', value: 'openrouter' },
  { label: 'OpenAI', value: 'openai' },
  { label: 'Anthropic', value: 'anthropic' },
  { label: 'DeepSeek', value: 'deepseek' },
];

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
};

interface Props {
  config: PiConfig;
  onSave: (c: PiConfig) => void;
}

export default function SettingsPanel({ config, onSave }: Props) {
  const [form] = Form.useForm<PiConfig>();
  const provider = Form.useWatch('provider', form) ?? config.provider;

  const handleSave = async () => {
    const values = await form.validateFields();
    onSave(values);
  };

  return (
    <Card style={{ maxWidth: 640, margin: '0 auto' }}>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        AI 设置
      </Typography.Title>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="密钥仅保存在本机浏览器（localStorage），不会上传到任何服务器。本架构是 local-first 的隐私友好设计；但浏览器侧密钥并非安全机密（受 XSS / 恶意扩展威胁），请勿使用高权限生产密钥。"
      />
      <Form form={form} layout="vertical" initialValues={config}>
        <Form.Item name="provider" label="服务商" rules={[{ required: true }]}>
          <Select
            options={PROVIDER_OPTIONS}
            onChange={(p) => {
              // 切换服务商时重置模型，避免保存出跨服务商的非法组合
              const first = MODEL_OPTIONS[p as ProviderId]?.[0]?.value;
              if (first) form.setFieldValue('model', first);
            }}
          />
        </Form.Item>
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
      </Form>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
        浏览器直连受 CORS 限制：优先推荐 OpenRouter；OpenAI / Anthropic 直连失败时请改用 OpenRouter 或自配代理。
      </Typography.Paragraph>
      <Button type="primary" block style={{ marginTop: 16 }} onClick={handleSave}>
        保存设置
      </Button>
    </Card>
  );
}
