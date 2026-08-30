// 题目变体生成（one-shot 结构化生成，不需要 Agent）。
// 安全模型（ADR-036）：LLM 可重构所有 Presentation（题干/场景/选项/解析），但必须保持 Knowledge Contract 不变量，输出为 VariantCandidate，需经 domain 校验。

import type { CompleteFn, GeneratedVariant } from '../types';
import type { VariantFormat } from '../schemas/common';
import type { Question } from '../schemas/question';
import { requiredPointsFor } from '../domain/knowledge';
import { detectOptionLengthBias } from '../domain/bias';
import { validateVariant } from '../domain/variant';
import { extractJSON } from './pi';

// 变体系统提示（稳定前缀，KV-Cache 友好）：分层硬约束（角色→不变量→变化维度→生成规则→
// distractor 规则→抗暗示→静默验证→输出契约），专为 Flash 类模型设计——减少模型需自行推理的歧义，
// 把「真正不同 / requiredConcepts 必须被考察 / 答案适用条件不变量」写成显式规则而非笼统要求。
// 所有「随题目变化」的数据都在 buildUser 里（用户消息），本常量不含任何动态数据——同一场面试里为不同题
// 生成变体时，可复用同一个被缓存的 system 前缀（DeepSeek Context Caching 命中）。
export const VARIANT_SYSTEM = `[PROMPT-VERSION v2]

你是一位资深 AI 技术面试官。你的任务不是简单改写原题，而是在不改变知识考察契约的前提下，生成一道具有不同表达、场景或认知角度的高质量变体题。

【核心原则】
先保护知识契约，再改变题目呈现。
变体必须：
- 测量与原题相同的核心知识；
- 保持原题正确结论及其适用条件；
- 保持相同难度等级和题型；
- 与原题有实质性差异，而不是简单同义改写；
- 自包含，不依赖原题、文章或外部上下文。

【不可改变的知识契约】
以下内容是硬约束：
- 核心知识点（topic / tags）
- 必考概念（requiredConcepts）
- 正确答案的核心语义
- 核心考察意图
- 难度等级
- 题型（single / multiple / open）
不得因为改变场景而改变原结论的适用条件。
不得引入原题没有依据、且会改变正确性的技术事实。
特别注意：requiredConcepts 必须被实际考察，而不仅仅是在题干、选项或解析中出现这些词。

【允许变化】
可以改变：
- 问题的表达方式
- 技术或工程场景
- 输入、约束、现象或故障表现
- 示例、名称和非关键数值
- 认知角度
- 选项的表达方式
- 解析的组织方式
优先让变体与原题在以下至少一个方面产生明显变化：
- mechanism：为什么 / 如何工作
- tradeoff：权衡、代价、边界
- pitfall：常见错误、误用、失败原因
- application：真实工程场景中的选择或判断
- diagnosis：根据现象定位原因
不要为了「变化」而改变真正要测量的知识。

【生成流程】
生成前，先在内部完成以下判断：
1. 确定原题真正测量的核心 concept；
2. 确定 requiredConcepts 中哪些概念必须通过推理或判断体现；
3. 选择一个与原题不同的认知角度或场景；
4. 检查新场景是否仍然支持原题的正确答案（若改变场景会改变答案，不得使用该场景）；
5. 再生成题干、选项和解析。
生成后，在内部检查：
- 正确答案是否仍然成立？
- requiredConcepts 是否真正被考察？
- 是否只是替换了几个词？
- 题目是否 self-contained？
- 难度是否保持？
- distractors 是否合理且确实错误？
- 是否存在明显的答案暗示？
- 是否有多个选项实际上都成立？
若发现问题，在输出前修正。

【选择题设计】
对于 single / multiple：
正确答案必须是唯一可被知识契约支持的答案。
distractors 应该具有一定迷惑性，但必须存在明确的技术错误。优先使用：
- 常见误解
- 概念混淆
- 条件遗漏
- 因果关系颠倒
- 适用范围错误
- 将局部性质错误地推广到整体
- 看似合理但违反题目约束
避免使用明显荒谬、与主题无关或一眼可排除的错误选项。

【正确答案不变量】
生成选择题时，先锁定原题正确答案所表达的技术结论。
新的选项可以完全重写，但必须满足：
- 原正确结论在新题场景下仍然成立；
- 正确选项必须表达该结论；
- 只能有一个选项（多选题则为原正确结论对应的全部选项）成立；
- 不得因为改变场景而偷偷改变正确答案的适用条件。
不要通过在选项中重复关键词来“保持知识点”；必须保持实际考察的技术结论。

【抗暗示】
不要通过形式特征泄露答案。
- 各选项应具有相近的表达完整度和细节程度。
- 正确项不得系统性地更长、更具体或更专业。
- 错误项也应保持自然、完整的工程表达。
- 不要通过绝对化词语、异常专业术语或明显不同的句式暗示正确答案。
- 不要为了长度均衡向错误选项加入无意义内容。
内容正确性和区分度优先于字数严格一致。

【开放题】
如果题型为 open：
- 不生成 options 或 answer；
- question 必须能够独立回答；
- referenceAnswer 所对应的核心知识必须仍然能够被回答覆盖；
- 题目应尽量改变场景、问法或认知角度，而不是简单改写原问题。

【解析】
解析应解释：
- 为什么正确答案成立；
- 为什么关键 distractors 不成立（选择题）；
- 题目实际考察了哪些核心概念。
不要在解析中引入题目没有依据的新知识。

【JSON 输出契约】
只输出一个 JSON 对象，不要输出 Markdown、代码块或额外文字。
选择题：
{
  "question": "新的、自包含的题干",
  "options": ["选项1", "选项2", "选项3", "选项4"],
  "answer": [0],
  "explanation": "解析"
}
多选题：
{
  "question": "新的、自包含的题干",
  "options": ["选项1", "选项2", "选项3", "选项4"],
  "answer": [0, 2],
  "explanation": "解析"
}
开放题：
{
  "question": "新的、自包含的题干",
  "explanation": "参考解析或答案要点"
}
注意：
- answer 使用从 0 开始的数组索引；
- single 只能有一个 answer；
- multiple 可以有多个 answer；
- open 不输出 options 和 answer；
- 必须输出合法 JSON。`;

interface RawVariant {
  question?: string;
  options?: string[];
  answer?: number[];
  explanation?: string;
}

function buildUser(q: Question, format?: VariantFormat): string {
  // P0-1：变体题型以「本次会话实际形态」为准；未提供时再回退到题库默认（有 choice 即 single/multiple，否则 open）。
  // 关键：双形态题（1078/1084）按 sq.format 生成，而不是永远按 choice 生成。
  const fmt: VariantFormat = format ?? (q.formats.choice ? (q.formats.choice.type === 'single' ? 'single' : 'multiple') : 'open');
  const contract: Record<string, unknown> = {
    topic: q.topic,
    tags: q.tags,
    requiredConcepts: requiredPointsFor(q) ?? [],
    difficulty: q.difficulty,
    format: fmt,
  };
  if (q.angle) contract.angle = q.angle;

  const original = {
    question: q.question,
    options: q.formats.choice?.options,
    answer: q.formats.choice?.answer,
    explanation: q.explanation,
    referenceAnswer: q.formats.open?.referenceAnswer,
  };

  const angleHint = q.angle
    ? `原题角度为 ${q.angle}，变体应尽量选择一个不同但相关的角度（definition/fundamental/mechanism/comparison/calculation/tradeoff/scenario/debugging/design/system-design），不要为换角度引入新的核心知识；若无合适替代角度则保持原角度但明显改变场景或问题组织方式。`
    : '变体应尽量改变考察角度或工程场景，但不得引入新的核心知识。';

  // 题型专属输出契约：按本次 format 明确告知模型该输出哪类 JSON，避免双形态题被默认成 choice。
  const formatInstruction =
    fmt === 'open'
      ? '本次必须生成【开放题】变体：不输出 options / answer；只输出 { "question": 新的自包含题干, "explanation": 解析 }。'
      : `本次必须生成【${fmt === 'single' ? '单选题' : '多选题'}】变体：输出 { "question", "options": [...], "answer": [...]（${fmt === 'single' ? '单选题 answer 仅 1 项' : '多选题 answer 可多项'}）, "explanation" }。`;

  return `【知识契约】
${JSON.stringify(contract, null, 2)}

【原题】
${JSON.stringify(original, null, 2)}

【变体目标】
生成与原题实质不同的变体。
${angleHint}

要求：
- 必须保持 requiredConcepts 被实际考察（通过推理 / 判断，而非仅在题干中提及）；
- 必须保持正确答案及其适用条件（改变场景后若原答案不再成立，不得使用该场景）；
- 不要只做同义改写——变体的 reasoning path 应发生变化；
- 新题必须 self-contained，不依赖原题；
- distractors 必须合理但存在明确技术错误（常见误解 / 概念混淆 / 条件遗漏等）；
- 避免通过选项长度、细节丰富度或措辞特征泄露答案；
- 难度保持为 ${q.difficulty}。

${formatInstruction}

按 [JSON 输出契约] 输出。`;
}

function toGeneratedVariant(_q: Question, out: RawVariant): GeneratedVariant {
  return {
    // 不再静默回退原题题干：缺失的 question 由 validateVariant 显式拒绝
    question: out.question ?? '',
    options: out.options,
    answer: out.answer,
    explanation: out.explanation,
  };
}

/** 生成变体候选；输出包含题干/选项/答案/解析（后三者仅选择题需要）。 */
export async function generateVariant(q: Question, complete: CompleteFn, format?: VariantFormat, systemPrompt = VARIANT_SYSTEM): Promise<GeneratedVariant> {
  const user = buildUser(q, format);

  // 首次生成
  let out = extractJSON<RawVariant>(await complete(systemPrompt, user));
  let candidate = toGeneratedVariant(q, out);
  let check = validateVariant(q, candidate, format);

  // P0-1：validateVariant 真正成为 gate —— 首次校验失败则一次性重试
  if (!check.ok) {
    const retryUser =
      user + `\n\n【修正】上一版变体未通过校验：${check.reason}，请重新生成并确保满足所有硬约束（题干自包含、选项/答案合法、topic/required 证据保留、难度与题型不变）。`;
    const fixedRaw = extractJSON<RawVariant>(await complete(systemPrompt, retryUser));
    const fixedCandidate = toGeneratedVariant(q, fixedRaw);
    const fixedCheck = validateVariant(q, fixedCandidate, format);
    if (!fixedCheck.ok) {
      throw new Error(fixedCheck.reason ?? check.reason ?? '变体校验未通过');
    }
    out = fixedRaw;
    candidate = fixedCandidate;
    check = fixedCheck;
  }

  // 抗暗示（anti-cueing）自愈：若 LLM 生成的选项存在长度泄题，一次性重试修正，
  // 避免把「正确项明显更长 / 干扰项过短」的偏差写进变体（traditional 启发式 + prompt 微调）。
  const biased =
    Array.isArray(out.options) &&
    Array.isArray(out.answer) &&
    detectOptionLengthBias(out.options, out.answer).biased;
  if (biased) {
    const retryUser =
      user +
      '\n\n【修正】上一版选项中存在长度泄题（正确项明显长于干扰项，或某干扰项过短），' +
      '请重新生成：确保各选项篇幅长度与工程细节丰富度均衡，不要通过长度暗示正确答案。';
    const fixed = extractJSON<RawVariant>(await complete(systemPrompt, retryUser));
    const fixedCandidate = toGeneratedVariant(q, fixed);
    // P0-2：retry 后再次 validate，避免绕过 domain gate
    const fixedCheck = validateVariant(q, fixedCandidate, format);
    if (!fixedCheck.ok) {
      // 修正版未通过校验则保留首版已校验的候选
      return candidate;
    }
    return fixedCandidate;
  }
  return candidate;
}
