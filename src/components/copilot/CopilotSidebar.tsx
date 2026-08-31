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
import { classifyIntent, initialConversationContext } from '../../application/conversation/router';
import { conversationContextSchema, type ConversationContext } from '../../schemas/conversation';
import { chromeComplete } from '../../ai/chrome';
import { createLLMProvider, isConfigValid, isEntryValid } from '../../ai/provider';
import { recordErrorLog } from '../../storage/db';
import type { AIConfig } from '../../schemas/ai-config';
import type { InterviewSession, SessionQuestion } from '../../schemas/session';
import type { LearnerProfile } from '../../schemas/learner';
import type { Question } from '../../schemas/question';
import { emptyProfile } from '../../domain/learner';
import { describeEvaluationSummary } from '../../domain/evaluation';
import type { SessionRecord } from '../../schemas/learner';
import { buildCopilotSystemPrompt } from '../../application/conversation/copilotPrompt';
import {
  createConversationSession,
  addQuestionToSession,
  addEvaluationToSession,
  toSessionRecord,
  loadConversationSession,
  saveConversationSession,
  clearConversationSession,
  type ConversationSession,
} from '../../application/conversation/conversationSession';
import { nextAdaptiveStep } from '../../application/interviewEngine';
import type { AnswerSignal } from '../../domain/adaptive';

function logCopilotFailure(message: string, detail: Record<string, unknown>): void {
  console.error('[Copilot] 调用失败：', message, detail);
  void recordErrorLog('copilot', message, detail);
}
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
    fail('未配置可用的 AI 引擎，请先在设置中配置', { providers: config.providers.map((p) => ({ id: p.id, enabled: p.enabled, model: p.model })) });
  }
  let lastErr: unknown;
  for (const entry of candidates) {
    try {
      const entryCtx = { provider: entry.id, model: entry.model, hasApiKey: Boolean(entry.apiKey && entry.apiKey.trim()), systemLen: system.length, promptLen: newContent.length, historyLen: history.length };
      if (entry.id === 'chrome') {
        const transcript = history.map((h) => `${h.role}: ${h.content}`).join('\n');
        return chromeComplete(system, `${transcript}${transcript ? '\n' : ''}user: ${newContent}`);
      }
      const models = buildModels(entry);
      const model = getModel(models, entry);
      if (!model) fail(`未找到模型 ${entry.model}`, entryCtx);
      const toBlocks = (c: string) => (c && c.length ? [{ type: 'text', text: c }] : []);
      const msgs = [...history.map((h) => ({ role: h.role, content: toBlocks(h.content) })), { role: 'user', content: toBlocks(newContent) }] as any;
      const ctx: any = { systemPrompt: system, messages: msgs.map((m: any) => ({ role: m.role, content: m.content, timestamp: Date.now() })) };
      const res: any = await models.complete(model, ctx, {});
      if (res?.stopReason === 'error') {
        fail(res?.errorMessage ? `模型调用失败：${res.errorMessage}` : '模型调用返回错误（stopReason=error），请检查引擎配置或网络', { ...entryCtx, stopReason: res?.stopReason, errorMessage: res?.errorMessage });
      }
      const blocks: any[] = Array.isArray(res?.content) ? res.content : typeof res?.content === 'string' ? [{ type: 'text', text: res.content }] : [];
      const textBlock = blocks.find((b: any) => b?.type === 'text');
      const text = textBlock && 'text' in textBlock ? textBlock.text : '';
      if (text) return text;
      const hasThinking = blocks.some((b: any) => b?.type === 'thinking');
      fail(hasThinking ? '模型仅返回了思考过程、未生成正文（可能是 max_tokens 被推理 token 消耗完）' : '模型未返回文本', { ...entryCtx, stopReason: res?.stopReason, blockTypes: blocks.map((b: any) => b?.type), textLen: text.length });
    } catch (e) { lastErr = e; }
  }
  throw lastErr ?? new Error('所有 AI 引擎均调用失败');
}
interface CopilotSidebarProps {
  open: boolean; onClose: () => void; config: AIConfig; profile: LearnerProfile | null; session: InterviewSession | null; currentQuestion?: Question | null; onSessionComplete?: (record: SessionRecord) => Promise<void>;
}
const CONVERSATION_CONTEXT_KEY = 'ai-interview-conversation-context-v1';
function loadConversationContext(): ConversationContext {
  try { const raw = localStorage.getItem(CONVERSATION_CONTEXT_KEY); if (raw) return conversationContextSchema.parse(JSON.parse(raw)); } catch {}
  return initialConversationContext();
}
function parseChatAnswer(question: Question, input: string): string | number[] {
  if (!question.formats.choice) return input;
  const indexes = [...input.toUpperCase().matchAll(/(?:^|[^A-Z])([A-F])(?=$|[^A-Z])/g)].map((m) => m[1].charCodeAt(0) - 65);
  const valid = [...new Set(indexes)].filter((i) => i >= 0 && i < question.formats.choice!.options.length);
  return valid.length ? valid : input;
}
const role: BubbleListProps['role'] = {
  assistant: { placement: 'start', variant: 'borderless', style: { maxWidth: '94%', margin: '0 0 8px', boxShadow: 'none' }, classNames: { root: 'copilot-assistant-bubble', content: 'copilot-assistant-message' }, styles: { content: { boxShadow: 'none', padding: '10px 12px', maxWidth: '100%' } }, footer: (<Space size={0}><Button type="text" size="small" icon={<ReloadOutlined />} /><Button type="text" size="small" icon={<CopyOutlined />} /><Button type="text" size="small" icon={<LikeOutlined />} /><Button type="text" size="small" icon={<DislikeOutlined />} /></Space>) },
  user: { placement: 'end', style: { margin: '0 0 8px' }, styles: { content: { boxShadow: '0 1px 4px rgba(0,0,0,0.12)', borderRadius: 12 } } },
};
export default function CopilotSidebar({ open, onClose, config, profile, session, currentQuestion, onSessionComplete }: CopilotSidebarProps) {
  const persisted = loadConversationSession();
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string; key: string }[]>(() => persisted?.messages ?? []);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [conversationContext, setConversationContext] = useState<ConversationContext>(() => persisted?.context ?? loadConversationContext());
  const [convSession, setConvSession] = useState<ConversationSession | null>(() => persisted);
  const [chatQuestion, setChatQuestion] = useState<Question | null>(() => {
    const ctx = persisted?.context ?? loadConversationContext();
    return ctx.currentQuestionId ? questionBank.questions.find((q) => q.id === ctx.currentQuestionId) ?? null : null;
  });
  const [width, setWidth] = useState(380);
  const [dragging, setDragging] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const configReady = isConfigValid(config);

  // Persist context + messages together (P1-1)
  useEffect(() => {
    try { localStorage.setItem(CONVERSATION_CONTEXT_KEY, JSON.stringify(conversationContext)); } catch {}
  }, [conversationContext]);
  useEffect(() => {
    if (convSession) saveConversationSession(convSession);
  }, [convSession]);

  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [messages, loading]);
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => { const newWidth = Math.round(window.innerWidth - e.clientX); setWidth(Math.min(600, Math.max(300, newWidth))); };
    const onUp = () => setDragging(false);
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); document.body.style.cursor = ''; document.body.style.userSelect = ''; };
  }, [dragging]);

  const appendAssistant = (content: string) => {
    setMessages((prev) => {
      const next = [...prev, { role: 'assistant' as const, content, key: `${Date.now()}-a-${Math.random().toString(36).slice(2,6)}` }];
      // sync to convSession messages
      setConvSession((prevS) => {
        if (!prevS) return prevS;
        const updated: ConversationSession = { ...prevS, messages: next, context: conversationContext };
        saveConversationSession(updated);
        return updated;
      });
      return next;
    });
  };

  // Ensure convSession exists, create if needed
  const ensureSession = (mode: 'question' | 'interview' = 'question'): ConversationSession => {
    if (convSession) return convSession;
    const sid = crypto.randomUUID();
    const s = createConversationSession(sid);
    s.context.mode = mode;
    s.messages = messages;
    return s;
  };

  const handleSend = async (val: string) => {
    const content = val.trim();
    if (!content || loadingRef.current) return;
    loadingRef.current = true;
    const userMsg = { role: 'user' as const, content, key: `${Date.now()}-u` };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput('');
    setLoading(true);
    try {
      const complete = configReady ? (system: string, user: string) => chatCopilot(config, system, [], user) : undefined;
      const intent = await classifyIntent(content, conversationContext, complete, (event) => {
        if (import.meta.env.DEV) console.debug('[ConversationRouter]', event);
      });
      if (intent.intent !== 'general_chat' && (intent.confidence ?? 0) < 0.75) {
        appendAssistant('我不确定你希望执行哪种操作。请明确说“给我出一道题”“下一题”或“开始模拟面试”。');
        // still persist user message to session
        setConvSession((prev) => {
          const base = prev ?? ensureSession();
          const updated = { ...base, messages: nextMessages, context: conversationContext };
          saveConversationSession(updated); return updated;
        });
        return;
      }
      const provider = configReady ? createLLMProvider(config) : null;
      const deps = { bank: questionBank, profile: profile ?? emptyProfile(), config, provider };

      // --- end_interview: aggregate single record ---
      if (intent.intent === 'end_interview') {
        if (convSession && convSession.questions.length > 0 && onSessionComplete) {
          const record = toSessionRecord(convSession);
          if (record && record.questionResults.length > 0) {
            await onSessionComplete(record);
            appendAssistant(`已结束本次训练，共 ${record.questionResults.length} 题，均分 ${record.overall}。已写入学习记录。`);
          } else {
            appendAssistant('已结束。当前没有可保存的作答。');
          }
        } else {
          appendAssistant('已结束。');
        }
        clearConversationSession();
        setConvSession(null);
        setConversationContext(initialConversationContext());
        setChatQuestion(null);
        // messages keep but mark ended
        setMessages((prev) => {
          const next = [...prev];
          if (convSession) saveConversationSession({ ...convSession, messages: next } as any);
          return next;
        });
        return;
      }

      if (intent.intent === 'ask_question' || intent.intent === 'continue_interview' || intent.intent === 'start_interview') {
        let baseSession = convSession ?? ensureSession(intent.intent === 'start_interview' ? 'interview' : 'question');
        // Upgrade logic P1-4: if in question mode, turnCount>=2 and continue with difficulty hint => upgrade to interview
        const shouldUpgrade = baseSession.turnCount >= 2 && intent.intent === 'continue_interview' && (intent.difficulty === 'hard' || (intent.topic && baseSession.context.questionHistory?.length));
        const targetMode: 'question' | 'interview' = intent.intent === 'start_interview' || shouldUpgrade || baseSession.context.mode === 'interview' ? 'interview' : 'question';
        if (targetMode === 'interview' && baseSession.context.mode !== 'interview') {
          baseSession = { ...baseSession, context: { ...baseSession.context, mode: 'interview' } };
        }
        // Ensure session persists with current messages
        baseSession = { ...baseSession, messages: nextMessages };
        setConvSession(baseSession);

        let question: SessionQuestion | null = null;
        if (targetMode === 'interview' && baseSession.questions.length > 0) {
          // Use adaptive continuation (P0-2): build signals from evaluations
          try {
            const bankForAdaptive = questionBank;
            const fakeSession: InterviewSession = { definition: { title: 'Chat 面试', categories: [], difficulties: [], formats: ['choice','open'], count: 10, useAI: true } as any, questions: baseSession.questions, startedAt: baseSession.startedAt };
            const signals: AnswerSignal[] = Object.entries(baseSession.evaluations).map(([id, ev]) => {
              const q = questionBank.questions.find((qq) => qq.id === id);
              if (!q || !ev) return null;
              return { topic: q.topic, score: ev.overall, difficulty: q.difficulty } as AnswerSignal;
            }).filter((x): x is AnswerSignal => x !== null);
            const adaptive = await nextAdaptiveStep(bankForAdaptive, fakeSession, signals, profile ?? emptyProfile(), config, provider ?? undefined);
            if (adaptive) question = adaptive.question;
          } catch {}
        }
        if (!question) {
          // fallback to rank-based askQuestion with excludeIds = history
          const excludeIds = baseSession.context.questionHistory ?? baseSession.questions.map((q) => q.question.id);
          // include difficulty/topic from intent
          question = await askQuestion(deps, { topic: intent.topic, difficulty: intent.difficulty, format: intent.format, excludeIds });
          // also try to handle topic alias miss: if no question due to topic filter, retry without topic
          if (!question && intent.topic) {
            question = await askQuestion(deps, { difficulty: intent.difficulty, format: intent.format, excludeIds });
          }
        }
        if (!question) {
          appendAssistant('当前条件下没有找到可用题目。请换一个主题或题型。');
          setConvSession((prev) => prev ? { ...prev, messages: nextMessages } : prev);
        } else {
          const updated = addQuestionToSession({ ...baseSession, messages: nextMessages }, question);
          // adjust mode if upgraded
          updated.context.mode = targetMode;
          setConvSession(updated);
          setConversationContext(updated.context);
          setChatQuestion(question.question);
          const body = question.format === 'choice' && question.question.formats.choice
            ? `${question.question.question}\n\n${question.question.formats.choice.options.map((option, i) => `${String.fromCharCode(65 + i)}. ${option}`).join('\n')}\n\n请直接回复选项字母，或输入“继续/结束”。`
            : `${question.question.question}\n\n请作答；完成后我会按题库评分。输入“结束”可结束本轮训练。`;
          // Need to persist messages with assistant reply as well; do after append
          {
            const withAssistant = [...nextMessages, { role: 'assistant' as const, content: body, key: `${Date.now()}-a` }];
            saveConversationSession({ ...updated, messages: withAssistant });
            setMessages(withAssistant);
          }
          return;
        }
      } else if (intent.intent === 'answer_current_question' && chatQuestion) {
        const format = chatQuestion.formats.choice ? 'choice' as const : 'open' as const;
        const answer = parseChatAnswer(chatQuestion, content);
        const evaluation = await evaluateConversationAnswer({ question: chatQuestion, format }, answer, provider);
        // update session with evaluation (aggregate, not per-question record)
        setConvSession((prev) => {
          if (!prev) return prev;
          const updated = addEvaluationToSession(prev, chatQuestion.id, answer, evaluation);
          updated.messages = nextMessages;
          // also push assistant message later via state update
          saveConversationSession(updated);
          setConversationContext(updated.context);
          return updated;
        });
        // Keep chatQuestion for display until next question; but clear pending via context
        if (!evaluation) {
          appendAssistant(configReady ? '当前回答暂未得到有效评分，请检查答案格式后重试。' : '当前题需要配置 AI 引擎才能评分（选择题已本地判分，若仍无分请检查选项格式如 A/B）。');
        } else {
          // Do NOT call onSessionComplete per question (P0-4). Aggregate only on end.
          const summary = describeEvaluationSummary(evaluation);
          const nextStepHint = convSession && convSession.context.mode === 'interview' ? '面试官将根据你的表现选题，回复“下一题”继续或“结束”收尾。' : '如需继续，请回复“下一题”；结束本轮请输入“结束”。';
          appendAssistant(`评分完成：${summary}\n\n${nextStepHint}`);
        }
      } else if (intent.intent === 'evaluate_answer' && chatQuestion) {
        // explicit re-evaluate
        const format = chatQuestion.formats.choice ? 'choice' as const : 'open' as const;
        const answer = parseChatAnswer(chatQuestion, content);
        const evaluation = await evaluateConversationAnswer({ question: chatQuestion, format }, answer, provider);
        if (!evaluation) appendAssistant('重新评分未得到有效结果。');
        else appendAssistant(`重新评分：${describeEvaluationSummary(evaluation)}`);
        // update eval
        setConvSession((prev) => {
          if (!prev || !chatQuestion) return prev;
          const updated = addEvaluationToSession(prev, chatQuestion.id, answer, evaluation);
          saveConversationSession(updated);
          return updated;
        });
      } else if (intent.intent === 'general_chat') {
        // persist user message to session if exists
        setConvSession((prev) => {
          if (!prev) return prev;
          const updated = { ...prev, messages: nextMessages };
          saveConversationSession(updated); return updated;
        });
        if (!configReady) {
          antMessage.warning('请先在设置中配置 AI 引擎；未配置时仍可直接请求选择题。');
          appendAssistant('当前未配置 AI 引擎。你仍可以说“给我出一道题”开始选择题训练；开放题评分和普通问答需要先配置 AI。');
        } else {
          const history = messages.map((m) => ({ role: m.role, content: m.content }));
          const sys = buildCopilotSystemPrompt({ profile, activeQuestion: chatQuestion ?? currentQuestion ?? null, session });
          const reply = await chatCopilot(config, sys, history, content);
          // append and persist
          setMessages((prev) => {
            const withAssistant = [...prev, { role: 'assistant' as const, content: reply, key: `${Date.now()}-a` }];
            setConvSession((prevS) => {
              if (!prevS) return prevS;
              const updated = { ...prevS, messages: withAssistant, context: conversationContext };
              saveConversationSession(updated); return updated;
            });
            return withAssistant;
          });
          return;
        }
      } else {
        appendAssistant('当前没有可处理的题目状态，请先说“给我出一道题”。');
        setConvSession((prev) => { if (!prev) return prev; const u = { ...prev, messages: nextMessages }; saveConversationSession(u); return u; });
      }
      // generic persist for paths that used appendAssistant via state fn not yet synced: ensure messages saved
      // (most branches already handled)
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
    <div ref={sidebarRef} className="copilot-shell" style={{ width: open ? width : 0, minWidth: open ? 300 : 0, flexShrink: 0, borderLeft: open ? '1px solid #f0f0f0' : 'none', background: '#fff', display: 'flex', flexDirection: 'column', overflow: 'hidden', transition: dragging ? 'none' : 'width 0.25s ease', alignSelf: 'stretch', minHeight: 0, position: 'relative' }}>
      {open && (<div onMouseDown={() => setDragging(true)} onDoubleClick={() => setWidth(380)} title="拖拽调整宽度，双击重置" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, cursor: 'col-resize', zIndex: 10, background: dragging ? 'rgba(22,119,255,0.15)' : 'transparent' }} />)}
      {open && (<>
        <div className="copilot-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <Space size={10}><span className="copilot-brand-mark"><CommentOutlined /></span><span><Typography.Text className="copilot-title" strong>面试 Copilot</Typography.Text><Typography.Text className="copilot-subtitle" style={{ display: 'block' }}>你的即时训练助手</Typography.Text></span></Space><Button type="text" icon={<CloseOutlined />} onClick={onClose} />
        </div>
        {currentQuestion && !chatQuestion && (<div className="copilot-context"><div className="copilot-context-label">正在辅导</div><div className="copilot-context-value">{currentQuestion.topic} · {currentQuestion.difficulty}</div></div>)}
        {chatQuestion && (<div className="copilot-context" style={{ maxHeight: 220, overflowY: 'auto' }}><div className="copilot-context-label">题目模式 · {conversationContext.mode} · 已练 {convSession?.questions.length ?? 0} 题</div><Typography.Text strong>{chatQuestion.question}</Typography.Text>{chatQuestion.formats.choice && (<div style={{ marginTop: 8 }}>{chatQuestion.formats.choice.options.map((option, i) => (<div key={`${chatQuestion.id}-${i}`} style={{ fontSize: 12, marginTop: 4 }}>{String.fromCharCode(65 + i)}. {option}</div>))}</div>)}</div>)}
        <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {messages.length === 0 ? (<><div className="copilot-welcome"><div className="copilot-welcome-title">你好，我来陪你练</div><div className="copilot-welcome-copy">解释考点、拆解思路、给出提示，也可以根据你的薄弱项安排下一步。</div></div><Prompts className="copilot-prompts" vertical title={<div className="copilot-prompts-title">从这里开始</div>} items={quickPrompts.map((p) => ({ key: p.key, description: p.label }))} onItemClick={(info) => handleSend(info?.data?.description as string)} />{!configReady && (<Typography.Text type="warning" style={{ fontSize: 12 }}>尚未配置 AI 引擎，Copilot 将无法联网作答。请先在“设置”中配置 DeepSeek / OpenRouter / Gemini / 本地模型等。</Typography.Text>)}</>) : (<Bubble.List items={messages.map((m) => ({ key: m.key, role: m.role, content: m.content, loading: false }))} role={role} autoScroll />)}
          {loading && (<Bubble placement="start" content="思考中…" loading />)}
        </div>
        <Flex gap={8} wrap="wrap" style={{ padding: '0 12px' }}>
          <Button size="small" icon={<ScheduleOutlined />} onClick={() => handleSend('请解释当前题目的核心知识点和考察角度')}>讲考点</Button>
          <Button size="small" icon={<ProductOutlined />} onClick={() => handleSend('请给我一点解题提示，不要直接给答案')}>给提示</Button>
          {convSession && convSession.questions.length>0 && (<Button size="small" onClick={() => handleSend('结束')}>结束训练</Button>)}
        </Flex>
        <div style={{ padding: 12, borderTop: '1px solid #f0f0f0' }}>
          <Sender value={input} onChange={setInput} onSubmit={() => handleSend(input)} loading={loading} placeholder={configReady ? '输入问题，Shift+Enter 换行…' : '可先说“给我出一道题”；普通问答需配置 AI…'} disabled={false} />
        </div>
      </>)}
    </div>
  );
}
