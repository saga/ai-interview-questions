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
挑战一道题是否值得进入技术题库：题干是否自包含、目标和约束是否充分、逻辑是否成立、答案是否成立、干扰项是否可辩护、解析是否支持答案；以及这道题对目标候选人的区分度——能否把「懂」与「不懂」区分开。

【答案有效性的判据（按题型分支，勿混用）】
- 单选题（single）：恰好一个最佳答案，其余选项均可被明确排除；
- 多选题（multiple）：正确答案至少两项，每一项都**独立成立**（单独看也为真，不是靠另一个正确项才成立），
  相互之间不是同一判断的换述（语义重复应合并为一项）；未被标为正确的选项必须**逐个为假**，
  同时又具备合理的工程迷惑性。多选题不要求「唯一答案」，只要求「每一项都站得住、每一项错项都倒得掉」。

【JSON 输出契约】
只输出一个 JSON 对象，不要 Markdown 或额外文字。字段：
{
  "verdict": "reject | revise | accept | skipped",
  "value": "high | medium | low",
  "summary": "一句话结论",
  "issues": [{"severity":"critical | warning | pass","dimension":"self-contained | sufficiency | logic | answer-validity | distractors | explanation","issue":"问题","evidence":"题目证据","suggestion":"修复建议"}],
  "rewrittenQuestion": "仅在需要改写时提供自包含题干，否则省略"
}
value（面试区分度 / 价值）：high=能区分懂与不懂；medium=可接受；low=太 trivial-like / 只考记忆背诵 / 对声明难度过易 / 不能区分常见误解。value=low 的题即使结构正确也应 revise 而非 accept。`;

const issueSchema = z.object({
  severity: z.enum(['critical', 'warning', 'pass']),
  dimension: z.enum(['self-contained', 'sufficiency', 'logic', 'answer-validity', 'distractors', 'explanation']),
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

/**
 * 答案有效性判据：按题型分支，单选问「是否唯一最佳」，多选问「每一项是否独立成立 + 错项是否逐个为假」。
 * 过去统一问「是否只有一个正确答案」，对多选题是错误判据（多选题本来就不止一个正确答案），
 * 会把合规的多选题一律判 critical，也会放过「正确项互为换述」的真问题。
 */
export function answerValidityRule(question: Question): string {
  const choice = question.formats.choice;
  if (!choice) return '3. 参考答案能否由题干给出的目标、约束和通用工程知识唯一确定？';
  const count = choice.answer.length;
  if (choice.type === 'multiple') {
    return `3. 本题是多选题，标出的正确答案共 ${count} 项。逐项检查：每个正确项是否**独立成立**（单独看也为真，不依赖另一个正确项才成立）？正确项之间是否只是同一判断的换述（语义重复应合并）？每个未标为正确的选项是否**逐个为假**、且仍具备合理的工程迷惑性？注意：多选题不要求「只有一个正确答案」。`;
  }
  return `3. 本题是单选题，标出的正确答案共 ${count} 项。是否恰好有一个可由通用工程知识推导的最佳答案，其余选项均可被明确排除？`;
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
${answerValidityRule(question)}
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

export type ChallengeDimension = QuestionChallengeIssue['dimension'];

/** 批量质询的单题结果。error 存在表示 LLM 调用/解析失败（未产生可信结论）。 */
export interface ChallengeOutcome {
  id: string;
  challenge?: QuestionChallenge;
  error?: string;
}

export interface ChallengeSummary {
  total: number;
  /** 得到结论的题数（total - 失败数）。 */
  judged: number;
  failed: number;
  verdicts: Record<QuestionChallenge['verdict'], number>;
  values: Record<'high' | 'medium' | 'low' | 'unknown', number>;
  /** 各维度的 critical / warning 命中数——定位「哪一类质量问题最多」。 */
  dimensions: Record<ChallengeDimension, { critical: number; warning: number }>;
  /** 硬门禁候选：verdict=reject，或含任一 critical issue。 */
  blockers: { id: string; dimensions: string[]; summary: string }[];
  /** 人工复核队列：critical 优先、其次 warning 多、最后区分度低（value=low）。 */
  reviewQueue: { id: string; score: number; reasons: string[] }[];
}

const DIMENSIONS: ChallengeDimension[] = [
  'self-contained',
  'sufficiency',
  'logic',
  'answer-validity',
  'distractors',
  'explanation',
];

/**
 * 批量质询结果汇总（纯函数，不碰 LLM / IO）。
 *
 * 分层治理（plan0907 P1-2）：deterministic 门禁负责可机证的正确性，challenger 负责语义质量，
 * 人工作最终验收。因此这里**不把 challenger 直接当 hard gate**：默认只产出报告，
 * 是否阻断由调用方决定（`--gate` 时以 blockers 为准），避免把 LLM 的偶发误判写进 CI。
 */
export function summarizeChallenges(outcomes: ChallengeOutcome[]): ChallengeSummary {
  const verdicts: ChallengeSummary['verdicts'] = { reject: 0, revise: 0, accept: 0, skipped: 0 };
  const values: ChallengeSummary['values'] = { high: 0, medium: 0, low: 0, unknown: 0 };
  const dimensions = Object.fromEntries(
    DIMENSIONS.map((d) => [d, { critical: 0, warning: 0 }]),
  ) as ChallengeSummary['dimensions'];
  const blockers: ChallengeSummary['blockers'] = [];
  const reviewQueue: ChallengeSummary['reviewQueue'] = [];
  let judged = 0;

  for (const o of outcomes) {
    const c = o.challenge;
    if (!c) continue;
    judged++;
    verdicts[c.verdict] += 1;
    values[c.value ?? 'unknown'] += 1;

    let score = 0;
    const reasons: string[] = [];
    const criticalDims = new Set<string>();
    for (const issue of c.issues) {
      if (dimensions[issue.dimension]) {
        if (issue.severity === 'critical') dimensions[issue.dimension].critical += 1;
        else if (issue.severity === 'warning') dimensions[issue.dimension].warning += 1;
      }
      if (issue.severity === 'critical') {
        score += 10;
        criticalDims.add(issue.dimension);
        reasons.push(`[critical/${issue.dimension}] ${issue.issue}`);
      } else if (issue.severity === 'warning') {
        score += 3;
        reasons.push(`[warning/${issue.dimension}] ${issue.issue}`);
      }
    }
    if (c.value === 'low') {
      score += 2;
      reasons.push('区分度偏低（value=low）');
    }
    if (c.verdict === 'reject') score += 20;

    const dims = [...criticalDims];
    if (c.verdict === 'reject' || criticalDims.size > 0) {
      blockers.push({ id: o.id, dimensions: dims, summary: c.summary });
    }
    if (score > 0) reviewQueue.push({ id: o.id, score, reasons });
  }

  reviewQueue.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return {
    total: outcomes.length,
    judged,
    failed: outcomes.length - judged,
    verdicts,
    values,
    dimensions,
    blockers,
    reviewQueue,
  };
}

