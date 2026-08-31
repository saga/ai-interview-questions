import { z } from 'zod';
import { extractJSON } from './pi';
import type { CompleteFn } from '../types';
import type { Question } from '../schemas/question';

// 质询系统提示（稳定前缀，KV-Cache 友好）：角色 + 边界 + 任务 + JSON 输出契约。
// 随题变化的数据在 buildQuestionChallengeUser（用户消息），本常量不含动态数据。
export const QUESTION_CHALLENGER_SYSTEM = `[PROMPT-VERSION v1]

你是一名严格的题目质询者，不是出题者，也不是来源文章的复述者。
你只能依据题目、选项和解析判断，忽略 source、tags、category、topic、subtopic 等 metadata；不能假设考生读过文章来源、产品文档、Lens、认证考纲或框架。

【你的任务】
挑战一道题是否值得进入技术题库：题干是否自包含、目标和约束是否充分、逻辑是否成立、答案是否唯一、干扰项是否可辩护、解析是否支持答案；以及这道题对目标候选人的区分度——能否把「懂」与「不懂」区分开。

【JSON 输出契约】
只输出一个 JSON 对象，不要 Markdown 或额外文字。字段：
{
  "verdict": "reject | revise | accept | skipped",
  "value": "high | medium | low",
  "summary": "一句话结论",
  "issues": [{"severity":"critical | warning | pass","dimension":"self-contained | sufficiency | logic | answer-uniqueness | distractors | explanation","issue":"问题","evidence":"题目证据","suggestion":"修复建议"}],
  "rewrittenQuestion": "仅在需要改写时提供自包含题干，否则省略"
}
value（面试区分度 / 价值）：high=能区分懂与不懂；medium=可接受；low=太 trivial-like / 只考记忆背诵 / 对声明难度过易 / 不能区分常见误解。value=low 的题即使结构正确也应 revise 而非 accept。`;

const issueSchema = z.object({
  severity: z.enum(['critical', 'warning', 'pass']),
  dimension: z.enum(['self-contained', 'sufficiency', 'logic', 'answer-uniqueness', 'distractors', 'explanation']),
  issue: z.string(),
  evidence: z.string(),
  suggestion: z.string(),
});

const challengeSchema = z.object({
  verdict: z.enum(['reject', 'revise', 'accept', 'skipped']),
  value: z.enum(['high', 'medium', 'low']).optional(),
  summary: z.string(),
  issues: z.array(issueSchema),
  rewrittenQuestion: z.string().optional(),
});

export type QuestionChallengeIssue = z.infer<typeof issueSchema>;
export type QuestionChallenge = z.infer<typeof challengeSchema>;

const SOURCE_PREREQUISITE_PATTERNS = [
  /符合.{0,24}(lens|框架|考纲|认证)/i,
  /根据.{0,24}(lens|框架|考纲|认证)/i,
  /按照.{0,24}(lens|框架|考纲|认证)/i,
  /本文提到|上述方法|该平台建议|该产品中/i,
];

function sourcePrerequisiteIssues(question: Question): QuestionChallengeIssue[] {
  const text = [question.question, ...(question.formats.choice?.options ?? []), question.formats.open?.referenceAnswer ?? ''].join('\n');
  if (!SOURCE_PREREQUISITE_PATTERNS.some((pattern) => pattern.test(text))) return [];
  return [{
    severity: 'critical',
    dimension: 'self-contained',
    issue: '题目把来源文章、Lens、框架或产品语境当成了答题依据。',
    evidence: '题干或选项出现了来源框架前置问法或文章指代。',
    suggestion: '删除来源判断，改写为包含业务目标、系统约束和验收标准的通用工程场景。',
  }];
}

export function buildQuestionChallengeUser(question: Question): string {
  const choice = question.formats.choice;
  return `请质询下面这道题。不要读取或依据 source、tags、category、topic、subtopic。

题干：
${question.question}
${choice ? `\n选项：\n${choice.options.map((option, index) => `${String.fromCharCode(65 + index)}. ${option}`).join('\n')}\n正确答案索引：${JSON.stringify(choice.answer)}\n` : ''}
${question.formats.open ? `\n开放题参考答案：\n${question.formats.open.referenceAnswer}\n` : ''}
题目解析：
${question.explanation}

逐项检查：
1. 不知道文章来源、产品、Lens、认证框架或内部术语时，能否独立作答？
2. 题干是否给出足够的目标、约束和验收标准？
3. 是否只有一个可由通用工程知识推导的正确答案？
4. 干扰项是否代表真实且互斥的工程误区？
5. 解析是否解释了答案的因果关系和边界？
6. 这道题能否把「懂」与「不懂」的候选人区分开？还是太 trivial / 只考记忆背诵 / 对声明难度过易 / 不能区分常见误解？请给出 value（high / medium / low）。

按 [JSON 输出契约] 输出 JSON。`;
}

export function parseQuestionChallenge(raw: string, question: Question): QuestionChallenge {
  let extracted: unknown;
  try {
    extracted = extractJSON<unknown>(raw);
  } catch {
    extracted = undefined;
  }
  const parsed = challengeSchema.safeParse(extracted);
  const hardIssues = sourcePrerequisiteIssues(question);
  if (!parsed.success) {
    return {
      verdict: hardIssues.length ? 'reject' : 'revise',
      summary: hardIssues.length ? '命中来源框架前置知识规则，拒绝进入题库。' : '质询模型输出无法解析，需要人工复核。',
      issues: hardIssues.length ? hardIssues : [{
        severity: 'critical',
        dimension: 'logic',
        issue: '质询结果不是合法结构化 JSON。',
        evidence: raw.slice(0, 300),
        suggestion: '重新运行质询或人工审查题目。',
      }],
    };
  }
  const modelResult = parsed.data;
  // 区分度偏低（value=low）的题即使结构正确也降为 revise，避免把「只考记忆背诵」的题放进题库。
  const downgraded =
    modelResult.value === 'low' && modelResult.verdict === 'accept'
      ? {
          ...modelResult,
          verdict: 'revise' as const,
          summary: `${modelResult.summary} 但区分度偏低（value=low），建议改写提升面试价值。`,
        }
      : modelResult;
  if (!hardIssues.length) return downgraded;
  return {
    ...downgraded,
    verdict: 'reject',
    summary: `${downgraded.summary} 另命中来源框架前置知识规则。`,
    issues: [...hardIssues, ...downgraded.issues],
  };
}

export async function challengeQuestion(question: Question, complete: CompleteFn, systemPrompt = QUESTION_CHALLENGER_SYSTEM): Promise<QuestionChallenge> {
  const raw = await complete(systemPrompt, buildQuestionChallengeUser(question));
  return parseQuestionChallenge(raw, question);
}

