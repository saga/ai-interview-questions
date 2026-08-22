import { createModels } from '@earendil-works/pi-ai';
import type { CredentialStore } from '@earendil-works/pi-ai';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';
import type { ChoiceQuestion, EssayGrade, EssayQuestion, Question } from '../types';

export type ProviderId = 'openai' | 'anthropic' | 'openrouter';

export interface PiConfig {
  provider: ProviderId;
  model: string;
  apiKey: string;
}

export function isConfigValid(c: PiConfig): boolean {
  return Boolean(c && c.apiKey && c.apiKey.trim().length > 0 && c.model && c.provider);
}

/**
 * 构造一个仅存在于内存的 CredentialStore，把用户填写的 API Key 提供给
 * 对应 provider。这是浏览器环境下注入密钥最稳妥的方式（不依赖环境变量）。
 */
function createCredentialStore(apiKey: string, providerId: string): CredentialStore {
  return {
    read: async (pid) => (pid === providerId ? { type: 'api_key', key: apiKey } : undefined),
    list: async () => [],
    modify: async () => undefined,
    delete: async () => undefined,
  };
}

function buildModels(config: PiConfig) {
  const models = createModels({
    credentials: createCredentialStore(config.apiKey, config.provider),
  });
  if (config.provider === 'openai') models.setProvider(openaiProvider());
  else if (config.provider === 'anthropic') models.setProvider(anthropicProvider());
  else models.setProvider(openrouterProvider());
  return models;
}

/** 调用 LLM 并返回纯文本。密钥通过 CredentialStore 注入，并额外作为请求级 override。 */
export async function callLLM(config: PiConfig, system: string, user: string): Promise<string> {
  const models = buildModels(config);
  const model = models.getModel(config.provider, config.model);
  if (!model) {
    throw new Error(`在 provider "${config.provider}" 中未找到模型 "${config.model}"`);
  }
  const context = {
    systemPrompt: system,
    messages: [{ role: 'user', content: user, timestamp: Date.now() }],
  };
  const res = await models.complete(model, context as never, { apiKey: config.apiKey } as never);
  const textBlock = (res.content ?? []).find((b: { type: string }) => b.type === 'text');
  return ((textBlock as { text?: string } | undefined)?.text ?? '').trim();
}

/** 从 LLM 文本中稳健地提取 JSON（容忍代码块包裹与多余文字）。 */
export function extractJSON<T = unknown>(raw: string): T {
  let s = (raw ?? '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try {
    return JSON.parse(s) as T;
  } catch {
    const first = s.search(/[[{]/);
    const last = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
    if (first !== -1 && last > first) {
      return JSON.parse(s.slice(first, last + 1)) as T;
    }
    throw new Error('LLM 未返回可解析的 JSON');
  }
}

const TRANSFORM_SYSTEM =
  '你是一位资深的 AI 技术面试官。请基于给定的原始面试题生成一道"变体题"：在保持考察知识点和正确答案完全一致的前提下，重新组织题干措辞、调整选项顺序（如有）、并给出新讲解，难度与原题一致。只输出 JSON，不要任何额外文字。';

/**
 * 用 LLM 对一道题做变体变换（重新措辞、打乱选项、重算答案索引）。
 * 失败时抛出错误，由调用方决定是否回退到原题。
 */
export async function transformQuestion(q: Question, config: PiConfig): Promise<Question> {
  if (q.type === 'essay') {
    const eq = q as EssayQuestion;
    const user = `原始问答题：
${JSON.stringify(
  { question: eq.question, referenceAnswer: eq.referenceAnswer, explanation: eq.explanation },
  null,
  2,
)}

请输出 JSON，字段：
- question: 重新措辞后的题干
- referenceAnswer: 参考答案（保持知识点一致）
- explanation: 解析
示例：{"question":"...","referenceAnswer":"...","explanation":"..."}`;
    const out = extractJSON<{ question: string; referenceAnswer: string; explanation: string }>(
      await callLLM(config, TRANSFORM_SYSTEM, user),
    );
    return {
      ...eq,
      question: out.question,
      referenceAnswer: out.referenceAnswer,
      explanation: out.explanation,
      aiGenerated: true,
    };
  }

  const cq = q as ChoiceQuestion;
  const user = `原始选择题：
${JSON.stringify(
  { question: cq.question, options: cq.options, answer: cq.answer, explanation: cq.explanation },
  null,
  2,
)}

请输出 JSON，字段：
- question: 重新措辞后的题干
- options: 字符串数组（重新组织选项措辞并打乱顺序）
- answer: 正确选项索引数组（必须对应"新的 options"顺序，且与原 answer 指向同一知识点）
- explanation: 解析
注意：answer 必须基于打乱后的新 options 重新计算索引。示例：{"question":"...","options":["..."],"answer":[1],"explanation":"..."}`;
  const out = extractJSON<{ question: string; options: string[]; answer: number[]; explanation: string }>(
    await callLLM(config, TRANSFORM_SYSTEM, user),
  );
  if (!Array.isArray(out.options) || !Array.isArray(out.answer) || out.options.length === 0) {
    throw new Error('选择题变体结构不完整');
  }
  out.answer.forEach((i) => {
    if (i < 0 || i >= out.options.length) throw new Error('答案索引越界');
  });
  return {
    ...cq,
    question: out.question,
    options: out.options,
    answer: out.answer,
    explanation: out.explanation,
    aiGenerated: true,
  };
}

/** 用 LLM 对问答题的回答进行评分与反馈。 */
export async function gradeEssay(
  q: EssayQuestion,
  userAnswer: string,
  config: PiConfig,
): Promise<EssayGrade> {
  const system =
    '你是一位严格的 AI 技术面试官，负责评估候选人的问答题回答。基于参考答案给出客观评分与详细反馈。只输出 JSON。';
  const user = `题目：${q.question}

参考答案：
${q.referenceAnswer}

候选人回答：
${userAnswer && userAnswer.trim() ? userAnswer : '（未作答）'}

请输出 JSON，字段：
- score: 0-100 的整数评分
- feedback: 总体反馈文字
- strengths: 回答中的亮点（字符串数组）
- missed: 回答中遗漏或错误的要点（字符串数组）`;
  const out = extractJSON<EssayGrade>(await callLLM(config, system, user));
  const score = Math.max(0, Math.min(100, Math.round(Number(out.score) || 0)));
  return {
    score,
    feedback: out.feedback ?? '',
    strengths: Array.isArray(out.strengths) ? out.strengths : [],
    missed: Array.isArray(out.missed) ? out.missed : [],
  };
}
