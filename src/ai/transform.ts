// 题型变换：同一道题在 选择题 ⇄ 开放题 之间换形态（ADR-024）。
// 分工（2026-08-23 修订）：**内容交给 LLM，结构交给代码**。
// - 开放→选择：LLM 拿到题目与参考答案，直接产出完整选择题（题干、全部选项、正确项标注）；
// - 选择→开放：LLM 只重写题干，referenceAnswer 由代码从权威字段合成；
// - 代码负责结构完整性：校验输出格式、洗牌并按文本匹配重算 answer 索引——
//   "正确项索引错位"这类历史事故在结构上不可能发生；输出不合法即回退原题。
// 变换后的题目保留原题 id（溯源），只在日志中记录映射关系，不在 UI 展示。

import type { ChoiceQuestion, OpenQuestion, Question, QuestionType } from '../types';
import { extractJSON } from './pi';
import { isChoice, isOpen } from '../domain/quiz';

/** 从原题权威字段合成开放题参考答案：概念说明 + 解析 + 正确选项原文。纯函数便于测试。 */
export function composeOpenReference(q: ChoiceQuestion): string {
  const correct = q.answer.map((i) => q.options[i]).filter(Boolean);
  const answerLine = `正确说法：${correct.join('；')}`;
  return [q.reference?.concept, q.explanation, answerLine].filter(Boolean).join('\n');
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 选择 → 开放：LLM 只重写题干。
 * 安全边界贯彻 ADR-019：options/answer/reference **不进入 prompt**——
 * LLM 根本不知道正确选项是什么，只依据题干与主题改写。
 */
async function transformToOpen(q: Question, complete: CompleteFn): Promise<OpenQuestion> {
  const cq = q as ChoiceQuestion;
  const system =
    '你是资深面试官。把一道选择题改写成考察同一知识点的开放式简答题：不出现任何选项，' +
    '引导应聘者解释原理、对比方案或分析场景。只输出 JSON：{"question":"改写后的题干"}。';
  const raw = await complete(system, `【题目】${cq.question}\n【考察主题】${cq.topic}`);
  const stem = extractJSON<{ question?: unknown }>(raw).question;
  if (typeof stem !== 'string' || !stem.trim()) throw new Error('题型变换输出缺少有效题干');
  // 显式构造目标形态字段，杜绝选择题专属字段（options/answer）残留
  return {
    id: cq.id,
    category: cq.category,
    topic: cq.topic,
    tags: cq.tags,
    difficulty: cq.difficulty,
    type: 'essay',
    question: stem.trim(),
    explanation: cq.explanation,
    aiGenerated: true,
    rubric: cq.rubric,
    reference: cq.reference,
    referenceAnswer: composeOpenReference(cq),
  };
}

/**
 * 开放 → 选择（单选或多选）：LLM 依据题目与参考答案产出完整选择题内容，
 * 代码只保结构完整——选项去重、数量/越界校验、洗牌后按文本匹配重算 answer 索引。
 * 多选请求但 LLM 只标了 1 个正确项时降级为单选（槽位不落空）；
 * 输出不合法即抛错，由调用方回退原题。
 */
async function transformToChoice(
  q: Question,
  target: 'single' | 'multiple',
  complete: CompleteFn,
  rng: () => number,
): Promise<ChoiceQuestion> {
  const oq = q as OpenQuestion;
  const isMulti = target === 'multiple';
  const system = isMulti
    ? '你是资深面试官。把一道开放题改写成多选题：给出改写后的题干（"以下关于…的说法，正确的有哪些？（多选）"类句式）、' +
      '4-5 个选项，并标注其中说法正确的 2-3 个选项序号。正确项各自独立成立，干扰项似是而非但明确错误。\n' +
      '严格输出 JSON：{"question":"题干","options":["选项1","选项2","选项3","选项4"],"correct":[0,2]}'
    : '你是资深面试官。把一道开放题改写成单选题：给出改写后的题干（"以下关于…的说法，正确的是？"类句式）、' +
      '4 个选项，并标注唯一正确选项的序号。干扰项似是而非但明确错误。\n' +
      '严格输出 JSON：{"question":"题干","options":["选项1","选项2","选项3","选项4"],"correct":[1]}';
  const raw = await complete(
    system,
    `【题目】${oq.question}\n【参考答案】${oq.referenceAnswer}\n【考察主题】${oq.topic}`,
  );
  const parsed = extractJSON<{ question?: unknown; options?: unknown; correct?: unknown }>(raw);
  if (typeof parsed.question !== 'string' || !parsed.question.trim()) {
    throw new Error('题型变换输出缺少有效题干');
  }
  const rawOptions = ((Array.isArray(parsed.options) ? parsed.options : []) as unknown[])
    .filter((o): o is string => typeof o === 'string')
    .map((o) => o.trim())
    .filter((o) => o.length > 0 && o.length <= 200);
  // 先按 LLM 原始数组解析正确项文本（避免去重导致序号位移），再去重
  const correctIdx = ((Array.isArray(parsed.correct) ? parsed.correct : []) as unknown[]).filter(
    (i): i is number => Number.isInteger(i),
  );
  const correctTexts = [
    ...new Set(correctIdx.map((i) => rawOptions[i]).filter((t): t is string => typeof t === 'string')),
  ];
  if (!isMulti && correctTexts.length !== 1) {
    throw new Error('题型变换输出的正确项数量不对（单选需恰好 1 个）');
  }
  let actualType: 'single' | 'multiple' = target;
  if (isMulti && correctTexts.length < 2) {
    console.warn(`题目 ${oq.id} 多选变换只得到 ${correctTexts.length} 个正确项，降级为单选`);
    actualType = 'single';
  }
  const options = [...new Set(rawOptions)];
  if (options.length < 3 || options.length > 6) {
    throw new Error(`题型变换输出的选项数量不对（去重后 ${options.length} 个）`);
  }
  if (actualType === 'multiple' && options.length < 4) {
    throw new Error('多选题去重后选项不足 4 个');
  }
  const shuffled = shuffle(options, rng);
  const answer = shuffled
    .map((o, i) => (correctTexts.includes(o) ? i : -1))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b);
  // 显式构造目标形态字段，杜绝开放题专属字段（referenceAnswer/language）残留
  return {
    id: oq.id,
    category: oq.category,
    topic: oq.topic,
    tags: oq.tags,
    difficulty: oq.difficulty,
    type: actualType,
    question: parsed.question.trim(),
    options: shuffled,
    answer,
    explanation: oq.explanation,
    aiGenerated: true,
    rubric: oq.rubric,
  };
}

type CompleteFn = (system: string, user: string) => Promise<string>;

/**
 * 执行题型变换；已是目标题型时原样返回，LLM 输出不合法时抛错（调用方回退原题）。
 * 成功后在日志记录 id 与形态映射（不做 UI 展示）。
 *
 * 支持的目标：essay（选择→开放）、single / multiple（开放→选择）。
 * coding 刻意不支持：编程题需要可执行的参考答案与判分契约，开放题变换器不冒充它；
 * 未来真正设计 open→coding 时应单独实现。
 *
 * @param rng 注入洗牌随机源（默认 Math.random），测试可固定
 */
export async function transformQuestionWith(
  q: Question,
  target: QuestionType,
  complete: CompleteFn,
  rng: () => number = Math.random,
): Promise<Question> {
  let transformed: Question;
  if (target === 'essay') {
    transformed = isOpen(q) ? q : await transformToOpen(q, complete);
  } else if (target === 'single' || target === 'multiple') {
    transformed = isChoice(q) ? q : await transformToChoice(q, target, complete, rng);
  } else {
    console.warn(`题型变换不支持目标 ${target}（题目 ${q.id}），保持原题型`);
    transformed = q;
  }
  if (transformed !== q) {
    // 溯源：id 保持原题，transformedFrom 记录形态来源（供复盘与质量审核）
    transformed = { ...transformed, transformedFrom: q.type };
    console.info(`[题型变换] 题目 ${q.id}（${q.topic}）: ${q.type} → ${transformed.type}`);
  }
  return transformed;
}
