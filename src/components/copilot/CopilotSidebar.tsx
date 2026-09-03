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
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useIsMobile } from '../../hooks/useIsMobile';
import { buildModels, getModel } from '../../ai/pi';
import { questionBank } from '../../data/questionBank';
import { askQuestion } from '../../application/conversation/questionCapability';
import { evaluateAnswer as evaluateConversationAnswer } from '../../application/conversation/evaluationCapability';
import { routeUserMessage, parseChatAnswer } from '../../application/conversation/commandDetector';
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
import { runCopilotTurn, type AnswerContext } from '../../application/conversation/copilot';
import {
  createConversationSession,
  addQuestionToSession,
  addEvaluationToSession,
  toSessionRecord,
  loadConversationSession,
  saveConversationSession,
  clearConversationSession,
  projectToConversationSession,
  shouldUpgradeToInterview,
  initialConversationContext,
  type ConversationSession,
} from '../../application/conversation/conversationSession';
import { startChatInterview, rehydrateInterviewAgent, type ChatInterviewController } from '../../application/conversation/interviewCapability';

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
  const isMobile = useIsMobile();
  const listRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  // 面试（Agent 驱动）运行时会话句柄：跨多次用户输入复用，不持久化（plan0831_5 §P0-1/P0-2）。
  const chatInterviewRef = useRef<ChatInterviewController | null>(null);
  // 恢复中标记：避免刷新恢复与用户首次交互并发时创建两个 Agent（plan0831_6 P0-1）。
  const resumingRef = useRef(false);
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

  // 卸载时释放 Agent 运行时（避免看门狗/进行中的 run 泄漏，plan0831_5 §P0-1）。
  useEffect(() => {
    return () => {
      chatInterviewRef.current?.dispose();
      chatInterviewRef.current = null;
    };
  }, []);

  // 刷新恢复（plan0831_6 P0-1）：若持久化的 session 仍在 interview 模式且有当前题，
  // 重建运行时会话并接回 controller，避免「假恢复 → 静默退化成 Question 模式确定性评分」。
  // 无可用引擎时给出明确提示，不静默退化。
  useEffect(() => {
    const persisted = loadConversationSession();
    if (!persisted || persisted.context.mode !== 'interview' || !persisted.context.currentQuestionId) return;
    const entry = config.providers.find((p) => p.enabled && isEntryValid(p)) ?? null;
    const providerForAgent = configReady ? createLLMProvider(config) : null;
    if (!entry || !providerForAgent) {
      appendAssistant('检测到上一场「模拟面试」未结束（mode=interview），但当前未配置可用的 AI 引擎，无法恢复运行时会话。请先在设置中配置引擎，或回复「结束」以保存进度。');
      return;
    }
    resumingRef.current = true;
    const resumeSession = rehydrateInterviewAgent(persisted);
    void startChatInterview({
      bank: questionBank.questions,
      profile: profile ?? emptyProfile(),
      entry,
      fallbackEntries: config.providers.filter((p) => p.enabled && isEntryValid(p)),
      provider: providerForAgent,
      resumeSession,
    })
      .then((res) => {
        resumingRef.current = false;
        if (res.fatalError) {
          appendAssistant(res.fatalError);
          return;
        }
        chatInterviewRef.current = res.controller;
        setChatQuestion(res.firstQuestion?.question ?? null);
      })
      .catch(() => {
        resumingRef.current = false;
      });
  }, []);

  const appendAssistant = (content: string) => {
    setMessages((prev) => {
      const next = [...prev, { role: 'assistant' as const, content, key: `${Date.now()}-a-${Math.random().toString(36).slice(2,6)}` }];
      // sync to convSession messages：convSession.context 是 Conversation 真源，不回退到外层陈旧的 conversationContext
      setConvSession((prevS) => {
        if (!prevS) return prevS;
        const updated: ConversationSession = { ...prevS, messages: next };
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

  /**
   * 命令通道（ADR-064）：只处理「改变训练状态」的 5 个确定性动作。
   * 其余所有输入已在 routeUserMessage 处被判定为 copilot / answer，不会进到这里。
   */
  const handleCommand = async (
    command: { kind: 'start_interview' | 'ask_question' | 'continue_interview' | 'end_interview' | 're_evaluate'; topic?: string; difficulty?: Question['difficulty'] },
    ctx: { nextMessages: { role: 'user' | 'assistant'; content: string; key: string }[]; provider: ReturnType<typeof createLLMProvider> | null },
  ): Promise<void> => {
    const { nextMessages, provider } = ctx;
    const deps = { bank: questionBank, profile: profile ?? emptyProfile(), config, provider };

    // --- end_interview：严格顺序（plan0831_6 P0-2）：build record → persist learner
    // → dispose Agent → clear active session → set UI to ended。end 分支不再调用任何
    // saveConversationSession，确保刷新后不会恢复一个「已结束」的 session。 ---
    if (command.kind === 'end_interview') {
      chatInterviewRef.current?.dispose();
      chatInterviewRef.current = null;
      let assistantMsg = '已结束。';
      if (convSession && convSession.questions.length > 0 && onSessionComplete) {
        const record = toSessionRecord(convSession);
        if (record && record.questionResults.length > 0) {
          await onSessionComplete(record);
          assistantMsg = `已结束本次训练，共 ${record.questionResults.length} 题，均分 ${record.overall}。已写入学习记录。`;
        } else {
          assistantMsg = '已结束。当前没有可保存的作答。';
        }
      }
      // 先清掉 active session（setConvSession(null)），使后续 appendAssistant 内部的
      // setConvSession(prevS) 因 prevS 为 null 不再回写 localStorage，杜绝「clear→save」竞态。
      setConvSession(null);
      clearConversationSession();
      // 保留「上一 session 已结束」状态（endedAt），让用户明确自己已不在原面试中。
      setConversationContext({ ...initialConversationContext(), mode: 'interview', endedAt: Date.now() });
      setChatQuestion(null);
      appendAssistant(assistantMsg);
      return;
    }

    // --- re_evaluate：对最近一题用已存答案重跑评分（确定性，不消耗 LLM 意图分类）。 ---
    if (command.kind === 're_evaluate') {
      const lastQ = chatQuestion ?? convSession?.questions[convSession.questions.length - 1]?.question ?? null;
      if (!lastQ) { appendAssistant('当前没有可重新评分的题目。'); return; }
      const stored = convSession?.answers?.[lastQ.id];
      if (stored === undefined) { appendAssistant('还没有可重新评分的作答记录，请先作答。'); return; }
      const format = lastQ.formats.choice ? 'choice' as const : 'open' as const;
      const evaluation = await evaluateConversationAnswer({ question: lastQ, format }, stored, provider);
      setConvSession((prev) => {
        if (!prev) return prev;
        const updated = addEvaluationToSession(prev, lastQ.id, stored, evaluation);
        saveConversationSession(updated);
        return updated;
      });
      if (!evaluation) appendAssistant('重新评分未得到有效结果。');
      else appendAssistant(`重新评分：${describeEvaluationSummary(evaluation)}`);
      return;
    }

    // --- ask_question / continue_interview / start_interview：出题 / 下一题 / 开始面试 ---
    let baseSession = convSession ?? ensureSession(command.kind === 'start_interview' ? 'interview' : 'question');
    // 升级策略收口到 shouldUpgradeToInterview（plan0831_6 P1-5 / 小问题）：唯一 policy。
    const shouldUpgrade = shouldUpgradeToInterview(baseSession, { intent: command.kind, difficulty: command.difficulty, topic: command.topic });
    const targetMode: 'question' | 'interview' = command.kind === 'start_interview' || shouldUpgrade || baseSession.context.mode === 'interview' ? 'interview' : 'question';

    if (targetMode === 'interview') {
      // P0-1/P0-2：面试模式真正走 pi-agent-core（createInterviewAgent），不再自己实现简化版 Agent 面试。
      let question: SessionQuestion | null = null;
      let finished = false;
      let fatal: string | undefined;
      let controller = chatInterviewRef.current;
      // 刷新恢复进行中：忽略本次输入，等 resume 把 controller 接回后再交互（plan0831_6 P0-1）。
      if (!controller && resumingRef.current) return;
      if (!controller) {
        // 首次进入：需要可用的 AI 引擎（entry + provider）。
        const entry = config.providers.find((p) => p.enabled && isEntryValid(p)) ?? null;
        const providerForAgent = configReady ? createLLMProvider(config) : null;
        if (!entry || !providerForAgent) {
          appendAssistant('模拟面试需要配置可用的 AI 引擎（设置中配置 DeepSeek / OpenRouter / Gemini / 本地模型）。你也可以直接说“给我出一道题”做选择题训练。');
          setConvSession((prev) => prev ? { ...prev, messages: nextMessages } : prev);
          return;
        }
        const res = await startChatInterview({
          bank: questionBank.questions,
          profile: profile ?? emptyProfile(),
          entry,
          fallbackEntries: config.providers.filter((p) => p.enabled && isEntryValid(p)),
          provider: providerForAgent,
          instruction: '请开始一次模拟面试，根据我的薄弱项自适应出题。',
        });
        controller = res.controller;
        chatInterviewRef.current = controller;
        question = res.firstQuestion;
        finished = res.finished;
        fatal = res.fatalError;
      } else {
        // 已存在 controller：用户说「下一题/继续/换一道」→ 交付下一题（上一题未答则跳过不计分）。
        const step = await controller.skip().catch(() => null);
        if (!step) return;
        question = step.question;
        finished = step.finished;
        fatal = step.fatalError;
      }
      if (fatal) {
        appendAssistant(fatal);
        chatInterviewRef.current?.dispose();
        chatInterviewRef.current = null;
        return;
      }
      if (finished) {
        appendAssistant('面试已结束：当前题库没有更多可考察的题目。回复“结束”可保存成绩。');
        chatInterviewRef.current?.dispose();
        chatInterviewRef.current = null;
        return;
      }
      if (!question) {
        appendAssistant('当前条件下没有找到可用题目。');
        setConvSession((prev) => prev ? { ...prev, messages: nextMessages } : prev);
        return;
      }
      // 投影运行时会话到 ConversationSession（单一真源，plan0831_6 P1-3）；不再手工拼 answers/evaluations。
      const body = question.format === 'choice' && question.question.formats.choice
        ? `${question.question.question}\n\n${question.question.formats.choice.options.map((option, i) => `${String.fromCharCode(65 + i)}. ${option}`).join('\n')}\n\n请直接回复选项字母，或输入“继续/结束”。`
        : `${question.question.question}\n\n请作答；完成后我会按题库评分。输入“结束”可结束本轮训练。`;
      const withAssistant = [...nextMessages, { role: 'assistant' as const, content: body, key: `${Date.now()}-a` }];
      const updated = projectToConversationSession(baseSession, controller.session, withAssistant, { deliveredQuestion: question, countAsNew: true });
      saveConversationSession(updated);
      setConvSession(updated);
      setConversationContext(updated.context);
      setChatQuestion(question.question);
      setMessages(withAssistant);
      return;
    }

    // ---- question 模式（非面试）：保持原确定性 askQuestion 逻辑 ----
    baseSession = { ...baseSession, messages: nextMessages };
    setConvSession(baseSession);
    let question: SessionQuestion | null = null;
    {
      // fallback to rank-based askQuestion with excludeIds = history
      const excludeIds = baseSession.context.questionHistory ?? baseSession.questions.map((q) => q.question.id);
      question = await askQuestion(deps, { topic: command.topic, difficulty: command.difficulty, excludeIds });
      // also try to handle topic alias miss: if no question due to topic filter, retry without topic
      if (!question && command.topic) {
        question = await askQuestion(deps, { difficulty: command.difficulty, excludeIds });
      }
    }
    if (!question) {
      appendAssistant('当前条件下没有找到可用题目。请换一个主题或题型。');
      setConvSession((prev) => prev ? { ...prev, messages: nextMessages } : prev);
    } else {
      const updated = addQuestionToSession(baseSession, question);
      updated.context.mode = targetMode;
      setConvSession(updated);
      setConversationContext(updated.context);
      setChatQuestion(question.question);
      const body = question.format === 'choice' && question.question.formats.choice
        ? `${question.question.question}\n\n${question.question.formats.choice.options.map((option, i) => `${String.fromCharCode(65 + i)}. ${option}`).join('\n')}\n\n请直接回复选项字母，或输入“继续/结束”。`
        : `${question.question.question}\n\n请作答；完成后我会按题库评分。输入“结束”可结束本轮训练。`;
      const withAssistant = [...nextMessages, { role: 'assistant' as const, content: body, key: `${Date.now()}-a` }];
      saveConversationSession({ ...updated, messages: withAssistant });
      setMessages(withAssistant);
      return;
    }
  };

  /**
   * 答案通道（ADR-064）：当前确实有「待作答题目」且输入可解析为作答时才走这里。
   * 求助型输入（「这道题我不会」）已在 routeUserMessage 处被判定为 copilot，不会进来。
   */
  const handleAnswer = async (ctx: {
    content: string;
    nextMessages: { role: 'user' | 'assistant'; content: string; key: string }[];
    provider: ReturnType<typeof createLLMProvider> | null;
  }): Promise<void> => {
    const { content, nextMessages, provider } = ctx;
    if (!chatQuestion) {
      appendAssistant('当前没有可作答的题目，请先说“给我出一道题”。');
      setConvSession((prev) => { if (!prev) return prev; const u = { ...prev, messages: nextMessages }; saveConversationSession(u); return u; });
      return;
    }
    // 面试模式（Agent 驱动）：走 controller.submit → 评分 + 交付下一题（plan0831_5 §P0-1）。
    if (convSession?.context.mode === 'interview' && chatInterviewRef.current) {
      const controller = chatInterviewRef.current;
      const answer = parseChatAnswer(chatQuestion, content);
      // 并发提交保护（plan0831_6 P1-4）：上一次 submit 仍在进行时，忽略本次重复提交，不覆盖 resolver。
      const step = await controller.submit(answer).catch(() => null);
      if (!step) return;
      if (step.fatalError) {
        appendAssistant(step.fatalError);
        controller.dispose();
        chatInterviewRef.current = null;
        return;
      }
      const base = convSession;
      if (step.finished || !step.question) {
        // 面试结束：等待用户「结束」保存成绩（投影到 ConversationSession，plan0831_6 P1-3）。
        const body = `本轮训练已完成，共 ${Object.keys(controller.session.evaluations).length} 题。回复“结束”可保存成绩。`;
        const withAssistant = [...nextMessages, { role: 'assistant' as const, content: body, key: `${Date.now()}-a` }];
        const updated = projectToConversationSession(base, controller.session, withAssistant, { deliveredQuestion: null, countAsNew: false });
        controller.dispose();
        chatInterviewRef.current = null;
        saveConversationSession(updated);
        setConvSession(updated);
        setConversationContext(updated.context);
        setChatQuestion(null);
        setMessages(withAssistant);
        return;
      }
      const q = step.question;
      const body = q.format === 'choice' && q.question.formats.choice
        ? `${q.question.question}\n\n${q.question.formats.choice.options.map((option, i) => `${String.fromCharCode(65 + i)}. ${option}`).join('\n')}\n\n请直接回复选项字母，或输入“继续/结束”。`
        : `${q.question.question}\n\n请作答；完成后我会按题库评分。输入“结束”可结束本轮训练。`;
      const withAssistant = [...nextMessages, { role: 'assistant' as const, content: body, key: `${Date.now()}-a` }];
      const updated = projectToConversationSession(base, controller.session, withAssistant, { deliveredQuestion: q, countAsNew: true });
      saveConversationSession(updated);
      setConvSession(updated);
      setConversationContext(updated.context);
      setChatQuestion(q.question);
      setMessages(withAssistant);
      return;
    }
    // question 模式：原确定性评估
    const format = chatQuestion.formats.choice ? 'choice' as const : 'open' as const;
    const answer = parseChatAnswer(chatQuestion, content);
    const evaluation = await evaluateConversationAnswer({ question: chatQuestion, format }, answer, provider);
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
      appendAssistant(`评分完成：${summary}\n\n如需继续，请回复“下一题”；结束本轮请输入“结束”。`);
    }
  };

  /**
   * Copilot 通道（ADR-064 §7）：解释 / 提示 / 比较 / 追问 / 知识问答，零副作用。
   * 检索在调用模型之前完成（copilot.ts 内部），检索失败只降级为无依据问答。
   */
  const handleCopilotChat = async (
    content: string,
    nextMessages: { role: 'user' | 'assistant'; content: string; key: string }[],
  ): Promise<void> => {
    // 方案 A（ADR-065 P1-4）：首次进入 Copilot 即创建并持久化 session（mode=chat），
    // 保持与命令/答案通道一致的落库行为，使 transcript 随 ConversationSession 刷新可恢复。
    setConvSession((prev) => {
      if (prev) {
        const updated: ConversationSession = { ...prev, messages: nextMessages, context: { ...prev.context, mode: 'chat' } };
        saveConversationSession(updated);
        return updated;
      }
      // 方案 A（ADR-065 P1-4）：首次进入 Copilot 即创建并持久化 session（mode=chat），
      // 使 transcript 随 ConversationSession 刷新可恢复，与命令/答案通道一致。
      const sid = crypto.randomUUID();
      const base = createConversationSession(sid);
      const created: ConversationSession = { ...base, messages: nextMessages, context: { ...base.context, mode: 'chat' } };
      saveConversationSession(created);
      return created;
    });
    if (!configReady) {
      antMessage.warning('请先在设置中配置 AI 引擎；未配置时仍可直接请求选择题。');
      appendAssistant('当前未配置 AI 引擎。你仍可以说“给我出一道题”开始选择题训练；开放题评分和普通问答需要先配置 AI。');
      return;
    }
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    const activeQuestion = chatQuestion ?? currentQuestion ?? null;
    // ADR-065 P0-2：从会话里取出用户实际作答与评分诊断，注入 Copilot，使其从"泛知识解释器"
    // 升级为"个性化教练"。当前题尚未作答（无 records）时为 null。
    const answerContext: AnswerContext | null =
      activeQuestion && convSession && Object.prototype.hasOwnProperty.call(convSession.answers, activeQuestion.id)
        ? { answer: convSession.answers[activeQuestion.id], evaluation: convSession.evaluations[activeQuestion.id] ?? null }
        : null;
    const result = await runCopilotTurn(
      { chat: (system, h, msg) => chatCopilot(config, system, h, msg) },
      { message: content, history, profile, activeQuestion, session, answerContext, context: conversationContext },
    );
    setMessages((prev) => {
      const withAssistant = [...prev, { role: 'assistant' as const, content: result.reply, key: `${Date.now()}-a` }];
      setConvSession((prevS) => {
        if (!prevS) return prevS;
        // P0-1：convSession.context 是 Conversation 真源。首次进入纯 Chat 时 LLM 返回后这里必须用
        // prevS.context 并显式锁定 mode='chat'，不能回退到外层陈旧的 conversationContext（否则 mode
        // 可能被覆盖成 question，破坏刷新恢复与后续 command/answer 路由）。单独持有的 conversationContext
        // 只是 UI 派生状态，此处一并同步。
        // ADR-066 P1：把本轮解析出的知识锚点（检索 seeds）记回会话，作为下一轮 follow-up 的 graph 种子，
        // 让"那 reranker 呢？"在已锚定 RAG 的会话里稳定延续（检索失败 / 无锚点时保留上一轮）。
        const seeds = result.evidence?.seeds ?? [];
        const updated: ConversationSession = {
          ...prevS,
          messages: withAssistant,
          context: {
            ...prevS.context,
            mode: 'chat',
            activeKnowledgeIds: seeds.length ? seeds : prevS.context.activeKnowledgeIds,
          },
        };
        saveConversationSession(updated);
        setConversationContext(updated.context);
        return updated;
      });
      return withAssistant;
    });
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
      const provider = configReady ? createLLMProvider(config) : null;
      // 唯一通道决策点（ADR-064 §5）：命令优先、求助优先于作答、其余一律 Copilot。
      // 不再有「意图不确定 → 请说命令」的阻断：不确定就是 Copilot，把命令行降级成聊天框是产品定位错误。
      const channel = routeUserMessage(content, conversationContext, chatQuestion ?? currentQuestion ?? null);
      if (channel.kind === 'command') {
        await handleCommand(channel.command, { nextMessages, provider });
        return;
      }
      if (channel.kind === 'answer') {
        await handleAnswer({ content, nextMessages, provider });
        return;
      }
      await handleCopilotChat(content, nextMessages);
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

  // 窄屏下 Copilot 改为右侧浮层，且关闭时**整棵子树不渲染**。
  // 此前靠 CSS `@media` 里的 `.copilot-shell { position: fixed; width: 92vw !important }` 切换，
  // 但 `.copilot-shell` 这个类名在 open=false 时依然存在，`!important` 又会压过内联的 width:0
  // ⇒ 移动端永远有一块 92vw 的白色固定面板盖在 z-index 1000 上（内容因 open=false 不渲染，
  // 看到的就是一片空白）。结构问题用结构解决，别用 !important 盖。
  if (isMobile && !open) return null;

  const shellStyle: CSSProperties = isMobile
    ? {
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: 'min(92vw, 420px)',
        minWidth: 0,
        zIndex: 1000,
        background: '#fff',
        display: 'flex',
        flexDirection: 'column',
        borderLeft: '1px solid #dce4ef',
        boxShadow: '-12px 0 36px rgba(24,39,75,0.16)',
      }
    : {
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
      };

  return (
    <>
      {/* 浮层遮罩：点遮罩关闭。没有它，窄屏下面板盖住内容却没有明显的退出路径。 */}
      {isMobile && open && (
        <div
          onClick={onClose}
          style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(0,0,0,0.35)' }}
        />
      )}
      <div ref={sidebarRef} className="copilot-shell" style={shellStyle}>
      {/* 拖拽改宽只在宽屏有意义：窄屏是固定 92vw 的浮层，没有可拖的边界。 */}
      {open && !isMobile && (<div onMouseDown={() => setDragging(true)} onDoubleClick={() => setWidth(380)} title="拖拽调整宽度，双击重置" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, cursor: 'col-resize', zIndex: 10, background: dragging ? 'rgba(22,119,255,0.15)' : 'transparent' }} />)}
      {open && (<>
        <div className="copilot-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <Space size={10}><span className="copilot-brand-mark"><CommentOutlined /></span><span><Typography.Text className="copilot-title" strong>面试 Copilot</Typography.Text><Typography.Text className="copilot-subtitle" style={{ display: 'block' }}>你的即时训练助手</Typography.Text></span></Space><Button type="text" icon={<CloseOutlined />} onClick={onClose} />
        </div>
        {currentQuestion && !chatQuestion && (<div className="copilot-context"><div className="copilot-context-label">正在辅导</div><div className="copilot-context-value">{currentQuestion.topic} · {currentQuestion.difficulty}</div></div>)}
        {conversationContext.endedAt && (<div className="copilot-context" style={{ background: '#fffbe6', borderColor: '#ffe58f' }}><div className="copilot-context-label">上一场训练已结束</div><div className="copilot-context-value">回复「下一题」开始新一轮，或「开始模拟面试」。</div></div>)}
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
    </>
  );
}
