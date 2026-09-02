import { z } from 'zod';
import { extractJSON } from './pi';
import type { CompleteFn } from '../types';
import type { Question } from '../schemas/question';
import { detectOptionLengthBias } from '../domain/bias';
import { normalizeOptionText } from '../domain/options';

// 变体质量质询器（**离线专用**）。
//
// 与 `domain/variant.validateVariant` 的分工：
//   validateVariant = **漂移探测器**，只查结构项与抗暗示（选项去重、长度泄题、指代自包含、
//   形态对齐）。`token_set_ratio ≥ 45` 通过 ≠ 语义正确——条件被删掉、前提被新增的变体
//   可以完整通过全部硬门槛。它擅长「防明显坏变体」，不擅长「判断这是高质量变体」。
//
// 本模块是产出后的**质量漏斗**：对候选变体逐条打 5 个维度的分，供超采—筛选取 top-N。
// 红线：**只在离线 pipeline 跑**，不进 runtime、不做在线双模型——runtime 仍是
// one-shot + fallback 原题（ADR-069）。

export const VARIANT_CHALLENGER_SYSTEM = `[PROMPT-VERSION v1]

你是变体题目的质量质询者。给你一道原题（canonical）和一道由它改写的变体，判断变体是否**仍然在考同一件事**。

【重要前提】
变体的正确答案索引、解析、topic、angle、difficulty 均由程序从原题继承，你不需要检查这些字段本身。
你要检查的是：LLM 改写后的**自然语言**是否悄悄改变了题目考察的内容。

【五个维度】
1. concept-preserved：原题考察的核心概念在变体里仍然成立，没有换成别的概念、没有引入需要额外知识的新概念。
2. answer-preserved：**每个选项的真假属性逐项未翻转**。原正确项在变体里仍为正确，原干扰项在变体里仍为错误（可换表达，不可换真假）。特别注意：改写时偷偷加进「只有/必须/所有/绝不」等限定词，会让原本正确的陈述变成错误，反之亦然。
3. difficulty-preserved：未因新增条件/额外提示而变简单，也未因删除关键前提而变难。
4. diagnostic-value：干扰项仍然代表真实工程误区，没被改写成明显荒谬或一眼可排除的选项（那会让题目失去区分度）。
5. accidental-clue：未意外引入长度泄题（正确项显著更长）、专业度泄题（正确项术语/数字密度显著更高）或语气泄题（正确项表述明显更严谨）。

【JSON 输出契约】
只输出一个 JSON 对象，不要 Markdown 或额外文字。字段：
{
  "dimensions": [
    {"dimension": "concept-preserved", "pass": true, "note": "一句话理由"},
    {"dimension": "answer-preserved", "pass": true, "note": "..."},
    {"dimension": "difficulty-preserved", "pass": true, "note": "..."},
    {"dimension": "diagnostic-value", "pass": true, "note": "..."},
    {"dimension": "accidental-clue", "pass": true, "note": "..."}
  ],
  "summary": "一句话结论"
}

判定尺度：宁严勿松。answer-preserved 只要有一项真假翻转就必须 pass=false。
五个维度全部 pass 才算合格变体；任一维度 pass=false 即整条候选不合格。`;

export const VARIANT_CHALLENGE_DIMENSIONS = [
  'concept-preserved',
  'answer-preserved',
  'difficulty-preserved',
  'diagnostic-value',
  'accidental-clue',
] as const;

export type VariantChallengeDimension = (typeof VARIANT_CHALLENGE_DIMENSIONS)[number];

const dimensionSchema = z.object({
  dimension: z.enum(VARIANT_CHALLENGE_DIMENSIONS),
  pass: z.boolean(),
  note: z.string(),
});

const challengeSchema = z.object({
  dimensions: z.array(dimensionSchema),
  summary: z.string(),
});

export interface VariantChallenge {
  /** 五维全部 pass 才为 true。 */
  ok: boolean;
  /** 通过维度数 / 5，供超采排序用。 */
  score: number;
  failed: VariantChallengeDimension[];
  summary: string;
  /** 模型输出无法解析时为 true——按「不合格」处理，不静默放行。 */
  unparsable?: boolean;
}

/** 变体的题干/选项表示（generateVariant 的返回形状）。 */
export interface VariantShape {
  question: string;
  options?: string[];
}

function renderOptions(options: string[] | undefined, answer: number[]): string {
  if (!options) return '（开放题，无选项）';
  return options
    .map((o, i) => `${String.fromCharCode(65 + i)}. ${o}${answer.includes(i) ? '  ←原题正确项' : '  ←原题干扰项'}`)
    .join('\n');
}

export function buildVariantChallengeUser(canonical: Question, variant: VariantShape, format: 'choice' | 'open'): string {
  const choice = canonical.formats.choice;
  return `【原题】
题干：
${canonical.question}
${choice ? `\n选项：\n${renderOptions(choice.options, choice.answer)}\n` : ''}
${canonical.formats.open ? `\n开放题参考答案：\n${canonical.formats.open.referenceAnswer}\n` : ''}
解析：
${canonical.explanation}

【变体】（呈现形态：${format}；答案索引、解析、topic、angle、difficulty 均由程序继承自原题，不需检查）
题干：
${variant.question}
${variant.options ? `\n选项：\n${variant.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join('\n')}\n` : ''}

按 [JSON 输出契约] 逐维度给出 pass 与理由，只输出 JSON。`;
}

/**
 * 廉价确定性预检：不花 LLM 就能否定的，先否掉。
 * 只覆盖 accidental-clue（长度/密度泄题）——其余四维必须靠 LLM。
 * 返回 null 表示「未发现问题，需继续走 LLM 质询」。
 */
export function cheapVariantQualityFlags(
  canonical: Question,
  variant: VariantShape,
  format: 'choice' | 'open',
): { ok: false; reason: string } | null {
  if (format !== 'choice' || !variant.options || !canonical.formats.choice) return null;
  const answer = canonical.formats.choice.answer;
  const options = variant.options;

  // 长度泄题：复用与 runtime 同一实现，保证离线与在线判据一致。
  const bias = detectOptionLengthBias(options, answer);
  if (bias.biased) return { ok: false, reason: `accidental-clue（长度泄题）：${bias.detail}` };

  // 信息密度泄题：正确项均长/专业度显著高于干扰项。长度 lint 只看全局 max/min，
  // 看不出「所有正确项都比干扰项更具体」这一类。
  const correct = answer.filter((i) => i < options.length).map((i) => options[i]);
  const distractors = options.filter((_, i) => !answer.includes(i));
  if (correct.length === 0 || distractors.length === 0) return null;
  const spec = (t: string) => (t.match(/[0-9]+(\.[0-9]+)?%?/g)?.length ?? 0) + (t.match(/[A-Za-z]{2,}/g)?.length ?? 0);
  const mean = (xs: string[]) => xs.reduce((s, x) => s + x.length, 0) / xs.length;
  const ratio = mean(distractors) > 0 ? mean(correct) / mean(distractors) : 1;
  if (ratio >= 1.5 && spec(correct.join('')) / correct.length > spec(distractors.join('')) / distractors.length) {
    return {
      ok: false,
      reason: `accidental-clue（信息密度泄题）：正确项均长 ${mean(correct).toFixed(0)} vs 干扰项 ${mean(distractors).toFixed(0)}（${ratio.toFixed(2)}×）`,
    };
  }

  // 选项规范化后重复：LLM 改写容易把两个选项写成同一句话的不同措辞。
  const norm = options.map(normalizeOptionText);
  if (new Set(norm).size !== norm.length) return { ok: false, reason: 'diagnostic-value：选项规范化后重复' };

  return null;
}

export function parseVariantChallenge(raw: string): VariantChallenge {
  let extracted: unknown;
  try {
    extracted = extractJSON<unknown>(raw);
  } catch {
    extracted = undefined;
  }
  const parsed = challengeSchema.safeParse(extracted);
  if (!parsed.success) {
    // 解析失败按「不合格」处理：静默放行会让质询器形同虚设，
    // 而误杀只是少留一条变体（离线超采下成本可忽略）。
    return {
      ok: false,
      score: 0,
      failed: [...VARIANT_CHALLENGE_DIMENSIONS],
      summary: `质询输出无法解析为合法 JSON：${raw.slice(0, 200)}`,
      unparsable: true,
    };
  }
  const failed = parsed.data.dimensions.filter((d) => !d.pass).map((d) => d.dimension);
  const passCount = VARIANT_CHALLENGE_DIMENSIONS.length - failed.length;
  return {
    ok: failed.length === 0,
    score: passCount / VARIANT_CHALLENGE_DIMENSIONS.length,
    failed,
    summary: parsed.data.summary,
  };
}

export async function challengeVariant(
  canonical: Question,
  variant: VariantShape,
  format: 'choice' | 'open',
  complete: CompleteFn,
  systemPrompt = VARIANT_CHALLENGER_SYSTEM,
): Promise<VariantChallenge> {
  const cheap = cheapVariantQualityFlags(canonical, variant, format);
  if (cheap) {
    return { ok: false, score: 0, failed: ['accidental-clue'], summary: cheap.reason };
  }
  const raw = await complete(systemPrompt, buildVariantChallengeUser(canonical, variant, format));
  return parseVariantChallenge(raw);
}
