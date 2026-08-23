import { Alert, Button, Card, Typography, Space, App as AntdApp } from 'antd';
import { UndoOutlined, SaveOutlined } from '@ant-design/icons';
import { Suspense, lazy, useEffect, useState } from 'react';
import type { AIConfig } from '../../types';
import { chromeAvailability, type ChromeAvailability } from '../../ai/chrome';
import { DEFAULT_LOCAL_BASE_URL } from '../../ai/local';
import { DEFAULT_CONFIG, parseConfigJSON, stringifyConfig } from '../../storage/settings';
import { getAIConfigJsonSchema } from '../../schemas/jsonSchema';

const LazyCodeEditor = lazy(() => import('../common/CodeEditor'));

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
}

export default function SettingsPanel({ config, onSave }: Props) {
  const { message } = AntdApp.useApp();
  const [text, setText] = useState(() => stringifyConfig(config));
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
    </Card>
  );
}
