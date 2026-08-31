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
import { Bubble, Prompts, Sender } from '@ant-design/x';
import type { BubbleListProps } from '@ant-design/x';
import { Button, Flex, Space, Typography, message as antMessage } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { buildModels, getModel } from '../../ai/pi';
import { questionBank } from '../../data/questionBank';
import { askQuestion } from '../../application/conversation/questionCapability';
import { evaluateAnswer as evaluateConversationAnswer } from '../../application/conversation/evaluationCapability';
import { classifyIntent, initialConversationContext, questionContext, waitingForQuestionContext } from '../../application/conversation/router';
import { conversationContextSchema, type ConversationContext } from '../../schemas/conversation';
import { chromeComplete } from '../../ai/chrome';
import { createLLMProvider, isConfigValid, isEntryValid } from '../../ai/provider';
import { recordErrorLog } from '../../storage/db';
import type { AIConfig } from '../../schemas/ai-config';
import type { InterviewSession } from '../../schemas/session';
import type { LearnerProfile } from '../../schemas/learner';
import type { Question } from '../../schemas/question';
import { emptyProfile } from '../../domain/learner';
import { describeEvaluationSummary } from '../../domain/evaluation';
import { sessionFromQuiz } from '../../domain/learner';
import type { SessionRecord } from '../../schemas/learner';

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
  const candidates = config.providers.filter((p) => p.enabled && isEntryValid(p));
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
        const transcript = history.map((h) => `${h.role}: ${h.content}`).join('\n');
        return chromeComplete(system, `${transcript}${transcript ? '\n' : ''}user: ${newContent}`);
      }
      const models = buildModels(entry);
      const model = getModel(models, entry);
      if (!model) fail(`未找到模型 ${entry.model}`, entryCtx);
      // pi-ai 的 transformMessages / openai-completions 要求消息 content 为「内容块数组」：
      // assistant 消息若用 string，transformMessages 里 assistantMsg.content.flatMap 会抛
      // "assistantMsg.content.flatMap is not a function"。历史里的 assistant 回复是 string，
      // 这里统一规整成 [{ type: 'text', text }] 块数组（user 消息用 string 也兼容，统一更稳妥）。
      const toBlocks = (c: string) => (c && c.length ? [{ type: 'text', text: c }] : []);
      const msgs = [
        ...history.map((h) => ({ role: h.role, content: toBlocks(h.content) })),
        { role: 'user', content: toBlocks(newContent) },
      ] as any;
      // pi-ai Context expects { systemPrompt, messages }
      const ctx: any = { systemPrompt: system, messages: msgs.map((m: any) => ({ role: m.role, content: m.content, timestamp: Date.now() })) };
      // 鉴权交给内存 CredentialStore（buildModels 已按 provider 注入 apiKey/accountId）。
      // 切勿传 { apiKey }——pi-ai 收到 apiKey override 会丢弃 store 中的 env（Cloudflare 的
      // accountId），导致 "Provider is not configured"。
      const res: any = await models.complete(model, ctx, {});
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
  onSessionComplete?: (record: SessionRecord) => Promise<void>;
}

const CONVERSATION_CONTEXT_KEY = 'ai-interview-conversation-context-v1';

function loadConversationContext(): ConversationContext {
  try {
    const raw = localStorage.getItem(CONVERSATION_CONTEXT_KEY);
    if (raw) return conversationContextSchema.parse(JSON.parse(raw));
  } catch {
    // Corrupt context is disposable; start a fresh Chat mode.
  }
  return initialConversationContext();
}

function parseChatAnswer(question: Question, input: string): string | number[] {
  if (!question.formats.choice) return input;
  const indexes = [...input.toUpperCase().matchAll(/(?:^|[^A-Z])([A-F])(?=$|[^A-Z])/g)].map((m) => m[1].charCodeAt(0) - 65);
  const valid = [...new Set(indexes)].filter((i) => i >= 0 && i < question.formats.choice!.options.length);
  return valid.length ? valid : input;
}

const role: BubbleListProps['role'] = {
  assistant: {
    placement: 'start',
    variant: 'borderless',
    style: { maxWidth: '94%', margin: '0 0 8px', boxShadow: 'none' },
    classNames: { root: 'copilot-assistant-bubble', content: 'copilot-assistant-message' },
    styles: { content: { boxShadow: 'none', padding: '10px 12px', maxWidth: '100%' } },
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
    styles: { content: { boxShadow: '0 1px 4px rgba(0,0,0,0.12)', borderRadius: 12 } },
  },
};

export default function CopilotSidebar({ open, onClose, config, profile, session, currentQuestion, onSessionComplete }: CopilotSidebarProps) {
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string; key: string }[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [conversationContext, setConversationContext] = useState<ConversationContext>(() => loadConversationContext());
  const [chatQuestion, setChatQuestion] = useState<Question | null>(() => {
    const context = loadConversationContext();
    return context.currentQuestionId ? questionBank.questions.find((q) => q.id === context.currentQuestionId) ?? null : null;
  });
  const [width, setWidth] = useState(380);
  const [dragging, setDragging] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);

  const configReady = isConfigValid(config);

  useEffect(() => {
    try {
      localStorage.setItem(CONVERSATION_CONTEXT_KEY, JSON.stringify(conversationContext));
    } catch {
      // Context persistence is best effort; the active UI state remains authoritative.
    }
  }, [conversationContext]);

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

  // 构造 Copilot 系统提示：注入「当前题目」与「薄弱主题」作为上下文，让 Copilot 既懂当下场景、又不偏离角色。
  // 设计要点：① 历史对话通过 messages 传入、不在此重复拼接；② 明确「绝不替用户作答选择题」的红线，
  // 避免 Copilot 直接泄露答案（辅导而非代答）；③ 未配置 AI 时引导去设置页，而非硬闯报错。
  // 提示词刻意保持「不给答案、只给提示」，契合中国用户「辅导」的预期，也规避评分公平性争议。
  const buildSystemPrompt = () => {
    const weak = profile ? profile.topicStats ? Object.entries(profile.topicStats as any).filter(([, s]: any) => s.mastery < 0.85).slice(0,3).map(([k])=>k).join(', ') : '' : '';
    const activeQuestion = chatQuestion ?? currentQuestion;
    const qInfo = activeQuestion ? `当前题目：${activeQuestion.question.slice(0,200)}\n类别：${activeQuestion.category} 主题：${activeQuestion.topic} 难度：${activeQuestion.difficulty}` : session ? `当前训练：${session.definition.title} 共${session.questions.length}题` : '用户尚未开始训练';
    return `你是 AI 面试训练器的 Copilot 侧边助手，基于 ant-design/x 的 Copilot 交互范式。
职责：解释题目知识点、给出不直接泄露答案的提示、梳理薄弱项、推荐下一步训练。严禁直接替用户作答选择题的正确选项，可引导思考。
当前上下文：
${qInfo}
${weak ? `薄弱主题：${weak}` : ''}
若用户未配置 AI，请引导去设置页配置。回答使用中文，条理清晰，必要时用 Markdown 列表。`;
  };

  const appendAssistant = (content: string) => {
    setMessages((prev) => [...prev, { role: 'assistant', content, key: `${Date.now()}-a` }]);
  };

  const handleSend = async (val: string) => {
    const content = val.trim();
    if (!content || loadingRef.current) return;
    loadingRef.current = true;
    const userMsg = { role: 'user' as const, content, key: `${Date.now()}-u` };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    try {
      const complete = configReady
        ? (system: string, user: string) => chatCopilot(config, system, [], user)
        : undefined;
      const intent = await classifyIntent(content, conversationContext, complete, (event) => {
        if (import.meta.env.DEV) console.debug('[ConversationRouter]', event);
      });
      if (intent.intent !== 'general_chat' && (intent.confidence ?? 0) < 0.75) {
        appendAssistant('我不确定你希望执行哪种操作。请明确说“给我出一道题”“下一题”或“开始模拟面试”。');
        return;
      }
      const provider = configReady ? createLLMProvider(config) : null;
      const deps = { bank: questionBank, profile: profile ?? emptyProfile(), config, provider };

      if (intent.intent === 'ask_question' || intent.intent === 'continue_interview' || intent.intent === 'start_interview') {
        const question = await askQuestion(deps, {
          topic: intent.topic,
          difficulty: intent.difficulty,
          format: intent.format,
          excludeIds: chatQuestion ? [chatQuestion.id] : [],
        });
        if (!question) {
          appendAssistant('当前条件下没有找到可用题目。请换一个主题或题型。');
        } else {
          const nextContext = intent.intent === 'start_interview'
            ? { ...questionContext(question.question.id, crypto.randomUUID()), mode: 'interview' as const }
            : questionContext(question.question.id);
          setChatQuestion(question.question);
          setConversationContext(nextContext);
          const body = question.format === 'choice' && question.question.formats.choice
            ? `${question.question.question}\n\n${question.question.formats.choice.options.map((option, i) => `${String.fromCharCode(65 + i)}. ${option}`).join('\n')}\n\n请直接回复选项字母，或输入“继续”。`
            : `${question.question.question}\n\n请作答；完成后我会按题库评分。`;
          appendAssistant(body);
        }
      } else if (intent.intent === 'answer_current_question' && chatQuestion) {
        const format = chatQuestion.formats.choice ? 'choice' as const : 'open' as const;
        const answer = parseChatAnswer(chatQuestion, content);
        const evaluation = await evaluateConversationAnswer({ question: chatQuestion, format }, answer, provider);
        setConversationContext(waitingForQuestionContext(conversationContext.sessionId));
        if (!evaluation) {
          appendAssistant(configReady ? '当前回答暂未得到有效评分，请检查答案格式后重试。' : '当前题需要配置 AI 引擎才能评分。');
        } else {
          if (onSessionComplete) {
            const record = sessionFromQuiz(
              { questions: [{ question: chatQuestion, format }], startedAt: Date.now() - 1, definition: { title: 'Chat 题目训练' } },
              { [chatQuestion.id]: evaluation },
              1,
              { [chatQuestion.id]: answer },
            );
            await onSessionComplete(record);
          }
          appendAssistant(`评分完成：${describeEvaluationSummary(evaluation)}\n\n如需继续，请回复“下一题”。`);
        }
      } else if (intent.intent === 'evaluate_answer' && chatQuestion) {
        appendAssistant('当前题已结束评分流程。如需继续训练，请回复“下一题”。');
        setConversationContext(waitingForQuestionContext(conversationContext.sessionId));
      } else if (intent.intent === 'general_chat') {
        if (!configReady) {
          antMessage.warning('请先在设置中配置 AI 引擎；未配置时仍可直接请求选择题。');
          appendAssistant('当前未配置 AI 引擎。你仍可以说“给我出一道题”开始选择题训练；开放题评分和普通问答需要先配置 AI。');
        } else {
          const history = messages.map((m) => ({ role: m.role, content: m.content }));
          const reply = await chatCopilot(config, buildSystemPrompt(), history, content);
          appendAssistant(reply);
        }
      } else {
        appendAssistant('当前没有可处理的题目状态，请先说“给我出一道题”。');
      }
    } catch (e) {
      const msg = (e as Error).message || '请求失败';
      console.error('[Copilot] 对话失败（已记录到 errorLog）：', msg, { lastErr: e });
      appendAssistant(`⚠️ ${msg}`);
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  };

  const quickPrompts = [
    { key: 'question', label: '给我出一道题' },
    { key: 'explain', label: '解释当前题目涉及的知识点' },
    { key: 'hint', label: '给一点提示，但不要直接给答案' },
    { key: 'weak', label: '分析我的薄弱项并推荐下一步' },
    { key: 'mock', label: '模拟追问：基于我的回答继续提问' },
  ];

  return (
    <div
      ref={sidebarRef}
      className="copilot-shell"
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
            className="copilot-header"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexShrink: 0,
            }}
          >
            <Space size={10}>
              <span className="copilot-brand-mark"><CommentOutlined /></span>
              <span>
                <Typography.Text className="copilot-title" strong>面试 Copilot</Typography.Text>
                <Typography.Text className="copilot-subtitle" style={{ display: 'block' }}>你的即时训练助手</Typography.Text>
              </span>
            </Space>
            <Button type="text" icon={<CloseOutlined />} onClick={onClose} />
          </div>

          {/* chat list */}
          {currentQuestion && !chatQuestion && (
            <div className="copilot-context">
              <div className="copilot-context-label">正在辅导</div>
              <div className="copilot-context-value">{currentQuestion.topic} · {currentQuestion.difficulty}</div>
            </div>
          )}
          {chatQuestion && (
            <div className="copilot-context" style={{ maxHeight: 220, overflowY: 'auto' }}>
              <div className="copilot-context-label">题目模式 · {conversationContext.mode}</div>
              <Typography.Text strong>{chatQuestion.question}</Typography.Text>
              {chatQuestion.formats.choice && (
                <div style={{ marginTop: 8 }}>
                  {chatQuestion.formats.choice.options.map((option, i) => (
                    <div key={`${chatQuestion.id}-${i}`} style={{ fontSize: 12, marginTop: 4 }}>
                      {String.fromCharCode(65 + i)}. {option}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {messages.length === 0 ? (
              <>
                <div className="copilot-welcome">
                  <div className="copilot-welcome-title">你好，我来陪你练</div>
                  <div className="copilot-welcome-copy">解释考点、拆解思路、给出提示，也可以根据你的薄弱项安排下一步。</div>
                </div>
                <Prompts
                  className="copilot-prompts"
                  vertical
                  title={<div className="copilot-prompts-title">从这里开始</div>}
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
              placeholder={configReady ? '输入问题，Shift+Enter 换行…' : '可先说“给我出一道题”；普通问答需配置 AI…'}
              disabled={false}
            />
          </div>
        </>
      )}
    </div>
  );
}
