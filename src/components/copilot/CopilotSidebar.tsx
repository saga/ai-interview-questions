import {
  CloseOutlined,
  CommentOutlined,
  CopyOutlined,
  DislikeOutlined,
  LikeOutlined,
  ProductOutlined,
  ReloadOutlined,
  ScheduleOutlined,
} from '@ant-design/icons';
import { Bubble, Prompts, Sender, Welcome } from '@ant-design/x';
import type { BubbleListProps } from '@ant-design/x';
import { Button, Flex, Space, Typography, message as antMessage } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { buildModels, getModel } from '../../ai/pi';
import { isConfigValid } from '../../ai/provider';
import { recordErrorLog } from '../../storage/db';
import type { AIConfig, InterviewSession, LearnerProfile, Question } from '../../types';

// ---------- Chat helper: multi-turn via pi-ai ----------
/** 结构化记录一条 Copilot 失败：控制台 + 本地 errorLog 表（fire-and-forget）。 */
function logCopilotFailure(message: string, detail: Record<string, unknown>): void {
  console.error('[Copilot] 调用失败：', message, detail);
  void recordErrorLog('copilot', message, detail);
}

/** 记录并抛出（供 chatCopilot 内部统一失败处理）。 */
function fail(message: string, detail: Record<string, unknown>): never {
  logCopilotFailure(message, detail);
  throw new Error(message);
}

async function chatCopilot(
  config: AIConfig,
  system: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  newContent: string,
): Promise<string> {
  const valid = config.providers.filter((p) => p.enabled && p.model && p.model.trim());
  const candidates = valid.filter((p) => {
    if (p.id === 'chrome') return true;
    if (p.id === 'local') return Boolean(p.model);
    if (p.id === 'cloudflare-workers-ai') return Boolean(p.apiKey && p.accountId);
    return Boolean(p.apiKey);
  });
  if (candidates.length === 0) {
    fail('未配置可用的 AI 引擎，请先在设置中配置', {
      providers: config.providers.map((p) => ({ id: p.id, enabled: p.enabled, model: p.model })),
    });
  }
  let lastErr: unknown;
  for (const entry of candidates) {
    try {
      const entryCtx = {
        provider: entry.id,
        model: entry.model,
        hasApiKey: Boolean(entry.apiKey && entry.apiKey.trim()),
        systemLen: system.length,
        promptLen: newContent.length,
        historyLen: history.length,
      };
      if (entry.id === 'chrome') {
        // Chrome provider not yet exposed as chat; skip to next
        fail('Chrome 内置模型暂不支持 Copilot 对话，请配置云端或本地引擎', entryCtx);
      }
      const models = buildModels(entry);
      const model = getModel(models, entry.id, entry.model);
      if (!model) fail(`未找到模型 ${entry.model}`, entryCtx);
      const msgs = [...history.map((h) => ({ role: h.role, content: h.content })), { role: 'user', content: newContent }] as any;
      // pi-ai Context expects { systemPrompt, messages }
      const ctx: any = { systemPrompt: system, messages: msgs.map((m: any) => ({ role: m.role, content: m.content, timestamp: Date.now() })) };
      const res: any = await models.complete(model, ctx, entry.apiKey?.trim() ? { apiKey: entry.apiKey } : {});
      // pi-ai 会把传输/鉴权错误吞成 stopReason='error' 并返回空 content（见 ARCHITECTURE 技术栈注意点），
      // 必须先看 stopReason，避免把真实错误掩盖成「模型未返回文本」。
      if (res?.stopReason === 'error') {
        fail(res?.errorMessage ? `模型调用失败：${res.errorMessage}` : '模型调用返回错误（stopReason=error），请检查引擎配置或网络', {
          ...entryCtx,
          stopReason: res?.stopReason,
          errorMessage: res?.errorMessage,
        });
      }
      const blocks: any[] = Array.isArray(res?.content)
        ? res.content
        : typeof res?.content === 'string'
          ? [{ type: 'text', text: res.content }]
          : [];
      const textBlock = blocks.find((b: any) => b?.type === 'text');
      const text = textBlock && 'text' in textBlock ? textBlock.text : '';
      if (text) return text;
      // 推理模型可能只返回了思考过程（thinking）而无正文
      const hasThinking = blocks.some((b: any) => b?.type === 'thinking');
      fail(hasThinking ? '模型仅返回了思考过程、未生成正文（可能是 max_tokens 被推理 token 消耗完）' : '模型未返回文本', {
        ...entryCtx,
        stopReason: res?.stopReason,
        blockTypes: blocks.map((b: any) => b?.type),
        textLen: text.length,
      });
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('所有 AI 引擎均调用失败');
}

// ---------- UI ----------
interface CopilotSidebarProps {
  open: boolean;
  onClose: () => void;
  config: AIConfig;
  profile: LearnerProfile | null;
  session: InterviewSession | null;
  currentQuestion?: Question | null;
}

const role: BubbleListProps['role'] = {
  assistant: {
    placement: 'start',
    style: { width: '100%', margin: '0 0 8px', boxShadow: 'none' },
    styles: { content: { boxShadow: 'none', padding: '10px 12px', width: '100%', maxWidth: '100%' } },
    footer: (
      <Space size={0}>
        <Button type="text" size="small" icon={<ReloadOutlined />} />
        <Button type="text" size="small" icon={<CopyOutlined />} />
        <Button type="text" size="small" icon={<LikeOutlined />} />
        <Button type="text" size="small" icon={<DislikeOutlined />} />
      </Space>
    ),
  },
  user: {
    placement: 'end',
    style: { margin: '0 0 8px' },
    styles: { content: { boxShadow: '0 1px 4px rgba(0,0,0,0.12)' } },
  },
};

export default function CopilotSidebar({ open, onClose, config, profile, session, currentQuestion }: CopilotSidebarProps) {
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string; key: string }[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [width, setWidth] = useState(380);
  const [dragging, setDragging] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);

  const configReady = isConfigValid(config);

  // auto scroll to bottom
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, loading]);

  // draggable resizer
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const newWidth = Math.round(window.innerWidth - e.clientX);
      setWidth(Math.min(600, Math.max(300, newWidth)));
    };
    const onUp = () => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [dragging]);

  const buildSystemPrompt = () => {
    const weak = profile ? profile.topicStats ? Object.entries(profile.topicStats as any).filter(([, s]: any) => s.mastery < 0.85).slice(0,3).map(([k])=>k).join(', ') : '' : '';
    const qInfo = currentQuestion ? `当前题目：${currentQuestion.question.slice(0,200)}\n类别：${currentQuestion.category} 主题：${currentQuestion.topic} 难度：${currentQuestion.difficulty}` : session ? `当前训练：${session.definition.title} 共${session.questions.length}题` : '用户尚未开始训练';
    return `你是 AI 面试训练器的 Copilot 侧边助手，基于 ant-design/x 的 Copilot 交互范式。
职责：解释题目知识点、给出不直接泄露答案的提示、梳理薄弱项、推荐下一步训练。严禁直接替用户作答选择题的正确选项，可引导思考。
当前上下文：
${qInfo}
${weak ? `薄弱主题：${weak}` : ''}
若用户未配置 AI，请引导去设置页配置。回答使用中文，条理清晰，必要时用 Markdown 列表。`;
  };

  const handleSend = async (val: string) => {
    const content = val.trim();
    if (!content) return;
    if (!configReady) {
      antMessage.warning('请先在设置中配置 AI 引擎');
      return;
    }
    if (loadingRef.current) return;
    loadingRef.current = true;
    const userMsg = { role: 'user' as const, content, key: `${Date.now()}-u` };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    try {
      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      const system = buildSystemPrompt();
      const reply = await chatCopilot(config, system, history, content);
      setMessages((prev) => [...prev, { role: 'assistant', content: reply, key: `${Date.now()}-a` }]);
    } catch (e) {
      const msg = (e as Error).message || '请求失败';
      console.error('[Copilot] 对话失败（已记录到 errorLog）：', msg, { lastErr: e });
      setMessages((prev) => [...prev, { role: 'assistant', content: `⚠️ ${msg}`, key: `${Date.now()}-e` }]);
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  };

  const quickPrompts = [
    { key: 'explain', label: '解释当前题目涉及的知识点' },
    { key: 'hint', label: '给一点提示，但不要直接给答案' },
    { key: 'weak', label: '分析我的薄弱项并推荐下一步' },
    { key: 'mock', label: '模拟追问：基于我的回答继续提问' },
  ];

  return (
    <div
      ref={sidebarRef}
      style={{
        width: open ? width : 0,
        minWidth: open ? 300 : 0,
        flexShrink: 0,
        borderLeft: open ? '1px solid #f0f0f0' : 'none',
        background: '#fff',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        transition: dragging ? 'none' : 'width 0.25s ease',
        alignSelf: 'stretch',
        minHeight: 0,
        position: 'relative',
      }}
    >
      {/* 拖拽手柄 */}
      {open && (
        <div
          onMouseDown={() => setDragging(true)}
          onDoubleClick={() => setWidth(380)}
          title="拖拽调整宽度，双击重置"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 6,
            cursor: 'col-resize',
            zIndex: 10,
            background: dragging ? 'rgba(22,119,255,0.15)' : 'transparent',
          }}
        />
      )}
      {open && (
        <>
          {/* header */}
          <div
            style={{
              height: 52,
              borderBottom: '1px solid #f0f0f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 12px 0 16px',
              flexShrink: 0,
            }}
          >
            <Space>
              <CommentOutlined style={{ color: '#1677ff' }} />
              <Typography.Text strong>✨ AI Copilot</Typography.Text>
            </Space>
            <Button type="text" icon={<CloseOutlined />} onClick={onClose} />
          </div>

          {/* chat list */}
          <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {messages.length === 0 ? (
              <>
                <Welcome
                  variant="borderless"
                  title="👋 你好，我是面试 Copilot"
                  description="我可以解释题目、给提示、分析薄弱项、规划下一步。基于 ant-design/x 的 Copilot 范式构建。"
                  style={{ background: '#f5f5ff', borderRadius: 12, marginBottom: 8 }}
                />
                <Prompts
                  vertical
                  title="试试这样问："
                  items={quickPrompts.map((p) => ({ key: p.key, description: p.label }))}
                  onItemClick={(info) => handleSend(info?.data?.description as string)}
                />
                {!configReady && (
                  <Typography.Text type="warning" style={{ fontSize: 12 }}>
                    尚未配置 AI 引擎，Copilot 将无法联网作答。请先在“设置”中配置 DeepSeek / OpenRouter / Gemini / 本地模型等。
                  </Typography.Text>
                )}
              </>
            ) : (
              <Bubble.List
                items={messages.map((m) => ({
                  key: m.key,
                  role: m.role,
                  content: m.content,
                  loading: false,
                }))}
                role={role}
                autoScroll
              />
            )}
            {loading && (
              <Bubble
                placement="start"
                content="思考中…"
                loading
              />
            )}
          </div>

          {/* quick actions */}
          <Flex gap={8} wrap="wrap" style={{ padding: '0 12px' }}>
            <Button size="small" icon={<ScheduleOutlined />} onClick={() => handleSend('请解释当前题目的核心知识点和考察角度')}>
              讲考点
            </Button>
            <Button size="small" icon={<ProductOutlined />} onClick={() => handleSend('请给我一点解题提示，不要直接给答案')}>
              给提示
            </Button>
          </Flex>

          {/* sender */}
          <div style={{ padding: 12, borderTop: '1px solid #f0f0f0' }}>
            <Sender
              value={input}
              onChange={setInput}
              onSubmit={() => handleSend(input)}
              loading={loading}
              placeholder={configReady ? '输入问题，Shift+Enter 换行…' : '请先配置 AI 引擎…'}
              disabled={!configReady}
            />
            <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 6, textAlign: 'center' }}>
              Copilot 基于 @ant-design/x 构建 · 复用站内 AI 配置
            </Typography.Text>
          </div>
        </>
      )}
    </div>
  );
}
