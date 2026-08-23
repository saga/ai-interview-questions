// 题型变换：同一道题在 选择题 ⇄ 开放题 之间换形态（ADR-024）。
// 安全模型延续 ADR-019：LLM 只产出题干（与开放→选择时的干扰项），
// 正确选项文本 / 参考答案 一律由代码从原题权威字段（explanation、referenceAnswer、正确 options）
// 合成——LLM 不拥有答案 key，"正确项索引错位"在结构上不可能发生。
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

/** 从开放题参考答案提取"唯一正确表述"（首个足够长的成句片段，作为变换后选择题的正确选项）。 */
export function deriveCorrectStatement(q: OpenQuestion): string {
  const s =
    q.referenceAnswer
      .split(/(?<=[。！？!?\n])/)
      .map((p) => p.trim())
      .find((p) => p.length >= 8)
      ?.slice(0, 120)
      .trim() ?? '';
  if (!s) throw new Error(`题目 ${q.id} 的 referenceAnswer 无法提取正确表述`);
  return s;
}

/**
 * 提取多个正确表述（用于变换成多选题）：参考答案按句切分，
 * 每个足够长的片段都是一个权威"正确说法"，去重后取前 3 个。
 */
export function deriveCorrectStatements(q: OpenQuestion, min = 2): string[] {
  const list = [
    ...new Set(
      q.referenceAnswer
        .split(/(?<=[。！？!?\n])/)
        .map((p) => p.trim())
        .filter((p) => p.length >= 8)
        .map((p) => p.slice(0, 120)),
    ),
  ];
  if (list.length < min) {
    throw new Error(`题目 ${q.id} 的 referenceAnswer 只能提取出 ${list.length} 个正确表述（需 ≥${min}）`);
  }
  return list.slice(0, 3);
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
 * 开放 → 选择（单选或多选）：
 * - 正确选项文本一律由代码从 referenceAnswer 的成句片段提取（权威字段合成）；
 * - LLM 只出题干与 3 个干扰项；干扰项与任何正确表述相同/重复时被剔除；
 * - 多选要求参考答案能提取出 ≥2 个正确表述，不足时回退为单选（保证配额槽位不落空）。
 */
async function transformToChoice(
  q: Question,
  target: 'single' | 'multiple',
  complete: CompleteFn,
  rng: () => number,
): Promise<ChoiceQuestion> {
  const oq = q as OpenQuestion;
  const isMulti = target === 'multiple';

  let corrects: string[];
  let actualType: 'single' | 'multiple' = target;
  if (isMulti) {
    try {
      corrects = deriveCorrectStatements(oq);
    } catch (err) {
      console.warn(`题目 ${oq.id} 参考答案不足以出多选题，回退单选：`, err);
      corrects = [deriveCorrectStatement(oq)];
      actualType = 'single';
    }
  } else {
    corrects = [deriveCorrectStatement(oq)];
  }

  const system = isMulti
    ? '你是资深面试官。把一道开放题改写成多选题：给出改写后的题干（"以下关于…的说法，正确的有哪些？（多选）"类句式），' +
      '并给出 3 个似是而非但明确错误的干扰表述。不得泄露参考答案原文。\n' +
      '严格输出 JSON：{"question":"题干","distractors":["错误表述1","错误表述2","错误表述3"]}'
    : '你是资深面试官。把一道开放题改写成单选题：给出改写后的题干（"以下关于…的说法，正确的是？"类句式），' +
      '并给出 3 个似是而非但明确错误的干扰表述。不得泄露参考答案原文。\n' +
      '严格输出 JSON：{"question":"题干","distractors":["错误表述1","错误表述2","错误表述3"]}';
  const raw = await complete(system, `【题目】${oq.question}\n【考察主题】${oq.topic}`);
  const parsed = extractJSON<{ question?: unknown; distractors?: unknown }>(raw);
  if (typeof parsed.question !== 'string' || !parsed.question.trim()) {
    throw new Error('题型变换输出缺少有效题干');
  }
  const correctSet = new Set(corrects);
  const distractors = [
    ...new Set(
      ((Array.isArray(parsed.distractors) ? parsed.distractors : []) as unknown[])
        .filter((d): d is string => typeof d === 'string')
        .map((d) => d.trim())
        .filter((d) => d.length > 0 && d.length <= 200 && !correctSet.has(d)),
    ),
  ];
  if (distractors.length < 2) throw new Error('可用干扰项不足（去重后需 ≥2 个且不与正确表述相同）');
  const options = shuffle([...corrects, ...distractors.slice(0, 3)], rng);
  const answer = options
    .map((o, i) => (correctSet.has(o) ? i : -1))
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
    options,
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
    console.info(`[题型变换] 题目 ${q.id}（${q.topic}）: ${q.type} → ${transformed.type}`);
  }
  return transformed;
}
