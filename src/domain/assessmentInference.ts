// 测量意图（assessment.target / reasoningGoal）的**离线推断**——纯函数，不依赖 React / LLM / 数据单例。
//
// 为什么需要它：`assessment` 由 Blueprint 产出（`convert-blueprint-output.ts` 落库，plan0907 P0-2），
// 但存量 1354 题 + 100 变体走的是旧管线，字段全空。没有它，「这道题要测出什么判断 / 要求考生走哪条
// 推理链」在存量库里完全不可见——人工审题与 variant challenger 都无从比对。
//
// **本模块只做「有据可依的抽取」，不做生成。**
// 产出的每一段文字都可追溯到题面已有的内容：
//   - `target`       ← explanation 的核心断言句（跳过选项字母行、元信息行、干扰项复述）
//   - `reasoningGoal`← angle/cognitiveTask 决定的起手动作 + 正确项摘要 + 干扰项摘要
// 因此它是**审计与去重用的结构化摘要**，不是作者意图的复原。需要真正的语义生成时走
// `scripts/backfill-assessment.ts --engine=llm`（接 provider 覆盖本模块的产出）。
//
// 置信度是刻意的保守设计：核心断言句抽不到就返回 null，宁可留空也不用模板文本灌满——
// 理由与 misconception 回填阈值定在 45 一致：看起来像人工标注、实则不是的字段，
// 比空字段更容易误导后续治理决策。

import type { Assessment } from '../schemas/common';
import { cjkDice, cjkTokenize } from './textSimilarity.ts';

export interface AssessmentInferenceInput {
  /** 题干 */
  question: string;
  /** 解析全文（存量库 100% 有，但推断不假设它存在） */
  explanation?: string;
  angle?: string;
  cognitiveTask?: string;
  /** 正确选项文本（单选题 1 条，多选题 N 条） */
  correctOptions: string[];
  /** 干扰项文本 */
  distractors: string[];
}

export interface AssessmentInference extends Assessment {
  /** 0～1。低于调用方阈值的推断应被丢弃。 */
  confidence: number;
  /** 命中的信号，写进侧车审计文件，便于事后追责「这条 assessment 是怎么来的」。 */
  signals: string[];
}

/** 断言句长度窗口（字符）。过短无信息，过长截断后读不通。 */
const CLAIM_MIN = 12;
const CLAIM_HARD_MAX = 130;
/** 写进 target 时的截断长度——超过后「核心判断为「…」」读起来就不再是判断了。 */
const CLAIM_SOFT_MAX = 90;
/** 选项摘要长度上限。 */
const HEAD_MAX = 26;
/** 与干扰项相似度达到此值即认为该句是干扰项复述，不能当核心断言。 */
const DISTRACTOR_RESTATEMENT = 70;
/**
 * 干扰项 token 被句子覆盖到这个比例，同样判为复述。
 * 只靠 cjkDice 不够：句子比干扰项长得多时（"…确实更灵活，但这不是动机"）Dice 会被稀释到
 * 阈值以下，于是干扰项内容反而被当成测量目标。
 */
const DISTRACTOR_COVERAGE = 80;

function tokenCoverage(haystack: string, needle: string): number {
  const pool = new Set(cjkTokenize(haystack));
  const tokens = cjkTokenize(needle);
  if (tokens.length === 0) return 0;
  return (tokens.filter((t) => pool.has(t)).length / tokens.length) * 100;
}

/** 元信息行：「本题考查…」「答案：C」「解析：…」等不是断言。 */
const META_PREFIX = /^(本题考查|本题考察|本题主要|答案\s*[:：]|解析\s*[:：]|选项\s*[A-Da-d]|参见|参考|提示\s*[:：]|注意\s*[:：])/;
/**
 * 以选项字母起头的句子（"A 项错误，因为…" / "B、…" / "A 是…"）。
 * 这类句子是在逐项判对错，不是这道题要测出的判断本身。
 */
const OPTION_LEAD =
  /^[A-Da-d]\s*(?:[、,，\/]\s*[A-Da-d]\s*)*[\.、,，:：)）]?\s*(项|选项|错误|正确|不对|是|不是)/;

const SENTENCE_END = /[。！？!?；;]/;

/**
 * 分句：按 CJK 句末标点与换行切分，保留标点后再统一剥除。
 * 刻意不在 `.` 上切分——题干里到处是 `$T \\ge 20$`、`0.5`、`v1.2`，按点切会碎掉。
 */
function splitSentences(text: string): string[] {
  const out: string[] = [];
  let buf = '';
  for (const ch of text) {
    buf += ch;
    if (SENTENCE_END.test(ch) || ch === '\n') {
      const s = stripTail(buf);
      if (s) out.push(s);
      buf = '';
    }
  }
  const last = stripTail(buf);
  if (last) out.push(last);
  return out;
}

function stripTail(s: string): string {
  return s.replace(/[\s。！？!?；;，,、]+$/g, '').trim();
}

/** 取首个分句（到第一个逗号/分号为止），再按 HEAD_MAX 截断。 */
function head(text: string): string {
  const clause = text.split(/[。！？!?；;，,]/).map((s) => s.trim()).filter(Boolean)[0] ?? text;
  const t = stripTail(clause);
  return t.length <= HEAD_MAX ? t : `${t.slice(0, HEAD_MAX)}…`;
}

/**
 * 谓语信号：句子里出现这类词才像「判断」而不是名词短语罗列。
 * 存量解析的首句常是「Bedrock Knowledge Bases 自动化切分/嵌入/检索」这种名词串，
 * 直接拿去当 target 会得到「能判断『某某机制』」——没有判断可言。
 */
const PREDICATE = new RegExp(
  [
    '会', '能', '可', '应', '需', '必须', '因为', '所以', '因此', '导致', '意味', '取决',
    '要求', '使得', '优于', '高于', '低于', '不足以', '不能', '不会', '避免', '降低', '增加',
    '提升', '减少', '本质', '关键在', '目的', '动机', '原因', '区别', '而非', '而不是',
    '用来', '用于', '并不', '主要', '往往', '应当', '旨在',
    '\\bis\\b', '\\bare\\b', '\\bcan\\b', '\\bmust\\b', '\\bshould\\b', '\\bbecause\\b',
    '\\btherefore\\b', '\\bleads to\\b', '\\bmeans\\b', '\\brequires\\b', '\\brather than\\b',
  ].join('|'),
  'i',
);

/**
 * 挑核心断言句：解析里最像结论的一句，按分值取最优而非取首个。
 * 排除项：元信息行、选项字母起头、与某条干扰项高度相似（那是干扰项复述，不是测量目标）。
 */
function pickClaim(sentences: string[], distractors: string[], correctOptions: string[]): string | undefined {
  let best: { sentence: string; score: number } | undefined;
  sentences.forEach((raw, i) => {
    const s = raw.length > CLAIM_HARD_MAX ? `${raw.slice(0, CLAIM_HARD_MAX - 1)}…` : raw;
    if (s.length < CLAIM_MIN) return;
    if (META_PREFIX.test(s)) return;
    if (OPTION_LEAD.test(s)) return;
    if (
      distractors.some(
        (d) => cjkDice(s, d) >= DISTRACTOR_RESTATEMENT || tokenCoverage(s, d) >= DISTRACTOR_COVERAGE,
      )
    ) {
      return;
    }

    const hasPredicate = PREDICATE.test(s);
    // 没有谓语信号的长句多半是名词罗列，只在足够长（有实质内容）时才放行。
    if (!hasPredicate && s.length < 30) return;

    let score = 0;
    if (hasPredicate) score += 2;
    if (s.length >= 20 && s.length <= CLAIM_SOFT_MAX) score += 2;
    if (correctOptions.some((c) => cjkDice(s, c) >= DISTRACTOR_RESTATEMENT)) score += 1;
    if (i === 0) score += 1;
    if (!best || score > best.score) best = { sentence: s, score };
  });
  if (!best) return undefined;
  const { sentence } = best;
  return sentence.length > CLAIM_SOFT_MAX ? `${sentence.slice(0, CLAIM_SOFT_MAX - 1)}…` : sentence;
}

/**
 * 起手动作：由 angle（视角）决定，cognitiveTask 兜底。
 * 只写「先做什么」，不写结论——结论部分由实际选项内容填充。
 */
const LEAD_BY_ANGLE: Record<string, string> = {
  definition: '先明确该概念的定义与适用边界',
  fundamental: '先回到该机制的第一性原理',
  mechanism: '先复现该机制的内部过程',
  comparison: '先对齐待比较对象的可比维度',
  calculation: '先确定计算所依赖的量与其关系',
  tradeoff: '先明确取舍发生在哪两个维度之间',
  scenario: '先识别场景给出的约束条件',
  debugging: '先定位现象的直接诱因',
  'system-design': '先拆出设计目标与不可绕过的约束',
  design: '先确定设计目标与约束的优先级',
  causal: '先建立因果链的前后件',
  diagnosis: '先从现象反推最可能的成因',
  prediction: '先确定影响结果的关键变量',
  quantitative: '先确定量化口径与所依赖的量',
  implementation: '先确定实现路径上的关键约束',
  optimization: '先定位瓶颈所在环节',
  evaluation: '先确定评估指标与其适用前提',
  application: '先判断该方法的适用前提是否满足',
  behavioral: '先还原情境中的行为与动机',
};

const LEAD_BY_TASK: Record<string, string> = {
  recall: '先回忆该知识点的定义与结论',
  explain: '先说明该机制为何成立',
  identify: '先识别待判定对象属于哪一类',
  diagnose: '先从现象反推成因',
  compare: '先对齐比较维度',
  predict: '先推断该条件下会发生的后果',
  apply: '先判断方法前提是否成立',
  evaluate: '先确定评价标准与权重',
  design: '先确定目标与约束的优先级',
  troubleshoot: '先缩小故障范围',
  infer: '先建立量与量之间的关系',
  synthesize: '先整合多处信息形成判断',
};

function leadOf(angle: string | undefined, cognitiveTask: string | undefined): string {
  return (
    (angle ? LEAD_BY_ANGLE[angle] : undefined) ??
    (cognitiveTask ? LEAD_BY_TASK[cognitiveTask] : undefined) ??
    '先确定判断所依赖的依据'
  );
}

/**
 * 推断测量意图。抽不到核心断言句时返回 null——调用方应跳过而不是写一条空转的模板。
 */
export function inferAssessment(input: AssessmentInferenceInput): AssessmentInference | null {
  const { explanation, angle, cognitiveTask, correctOptions, distractors } = input;
  const signals: string[] = [];

  const claim = explanation
    ? pickClaim(splitSentences(explanation), distractors, correctOptions)
    : undefined;
  if (!claim) return null;
  signals.push('claim:explanation');

  const isMultiple = correctOptions.length > 1;
  const target = isMultiple
    ? `能逐项判断下列主张是否成立，核心判断为「${claim}」`
    : `能判断「${claim}」`;

  const steps: string[] = [leadOf(angle, cognitiveTask)];
  if (correctOptions.length === 0) {
    steps.push(`据此给出「${head(claim)}」这一结论并说明依据`);
  } else if (correctOptions.length === 1) {
    steps.push(`据此确认「${head(correctOptions[0])}」成立`);
  } else {
    const heads = correctOptions.slice(0, 2).map(head);
    steps.push(`据此逐项确认「${heads.join('」「')}」等 ${correctOptions.length} 项成立`);
  }
  if (distractors.length > 0) {
    const heads = distractors.slice(0, 2).map(head);
    steps.push(`并排除「${heads.join('」「')}」等不成立描述`);
  }
  const reasoningGoal = `${steps.join('；')}。`;

  // 置信度：核心断言是主项，选项内容次之，维度信息只是加成。
  let confidence = 0.45;
  if (correctOptions.length > 0) confidence += 0.25;
  confidence += distractors.length >= 2 ? 0.2 : distractors.length === 1 ? 0.1 : 0;
  if (angle) {
    confidence += 0.05;
    signals.push('angle');
  }
  if (cognitiveTask) {
    confidence += 0.05;
    signals.push('cognitiveTask');
  }
  if (correctOptions.length > 0) signals.push(`correct:${correctOptions.length}`);
  if (distractors.length > 0) signals.push(`distractors:${distractors.length}`);

  return { target, reasoningGoal, confidence: Math.min(1, confidence), signals };
}

/** 默认写入阈值：核心断言 + 至少一条正确项 + 干扰项信息。 */
export const DEFAULT_MIN_CONFIDENCE = 0.7;
