// 题目变体生成（one-shot 结构化生成，不需要 Agent）。
//
// ⚠️ 本模块产出的是 **Runtime Presentation Variant**（plan0907 P1-1 方案 A / ADR-077）：
// 同一知识重写表达（ADR-080：允许明显换场景/叙事/选项表达结构），但**不改变 assessment identity**——
// 不换 topic / angle / cognitiveTask / difficulty / assessment，
// 也不重新决定 answer / explanation / 选项数量 / 选项顺序 / 槽位语义角色 / 选项真假属性
// （ADR-036 变体边界 + ADR-080 位置不变式：程序按序号映射答案，角色不可跨槽位挪动）。
// 「同一 Knowledge 的不同 reasoning path 测量」= **Offline Assessment Variant**，只能由离线池
// （`src/data/variants/*.json`，generator=offline）提供；`questionVariantSchema` 已在 schema 层
// 禁止 runtime 条目声明测量面，本模块也不向模型暴露这些字段（见 buildUser）。
//
// 职责边界（2026-09-02 第五轮）：本模块**只做 LLM 适配 + 解析**，不做任何校验。
// 唯一的校验入口是 `application/sessionEvaluator.finalizeQuestion` 里的 `validateVariant`
// （validate + apply + fallback 三件事集中在一处），避免同一候选被校验两次。

import type { CompleteFn, GeneratedVariant } from '../types';
import type { FormatId } from '../schemas/common';
import { assessmentSchema, cognitiveTaskSchema, questionAngleSchema } from '../schemas/common';
import type { Question } from '../schemas/question';
import type { VariantKind } from '../schemas/variant';
import type { VariantMeasurementFace } from '../domain/variant';
import { requiredPointsFor } from '../domain/knowledge/nodes';
import { extractJSON } from './pi';
import { z } from 'zod';

// 稳定前缀（KV-Cache 友好）：同知识重写约束。同一场面试为不同题生成变体时可复用同一前缀。
// 边界（ADR-036 变体收缩 + ADR-080 放宽生成自由度）：LLM 只做「同知识重写」
// （题干 + 选项文本改写），选项顺序与答案由程序在 applyVariant 中重排与重映射，
// 本 prompt 不要求也不允许模型决定顺序 / 答案。ADR-080 把生成空间从「换皮 paraphrase」
// 放宽到「同知识重写」，但槽位↔语义角色对应、答案恒取 canonical 两条硬边界不动。
export const VARIANT_SYSTEM = `[PROMPT-VERSION v6]

对已有面试题做同知识重写（same-knowledge rewrite）：测的是同一件事，但可以像一道真正重新写过的题。

任务：
1. 改写题干，使其场景、问法、表达与原题明显不同（见下方「题干可以」）。
2. 对每个选项做**幅度明显**的改写，使改写后的选项读起来与原文明显不同（见下方「选项改写幅度」）。
3. 保持每个选项原本代表的技术结论不变（见下方「语义角色对应」）。
4. 不得新增解题必需的知识、事实、前置条件或隐藏约束；不删除关键条件（见下方「背景信息」）。
5. 不改变任何选项的正确 / 错误属性。
6. 不改变选项数量。
7. 不创造新的 distractor。
8. 不挪动选项的语义角色：每个输出槽位必须保持原选项的语义角色，不得将两个选项的语义角色互换（顺序与答案由程序在后续步骤统一处理）。
9. 不生成答案。
10. 不生成解析。

题干可以（且鼓励）：
- 改变场景、角色、问题入口和约束表达，只要最终仍测量相同的核心知识与判断
- 改变措辞、句式和提问方式
- 加入工程背景信息（须沿用原题术语、优先中文；见下方「背景信息」）
- 调整表达视角
- 例：原题「为什么 KV Cache 可以降低长上下文推理的成本？」→ 可改写为
  「一个在线客服系统发现同一会话的后续请求不断重复发送历史对话，每次都重新计算
  整段历史 token。若要降低这部分重复计算，最直接应利用什么机制？」

背景信息（重要）：
- 允许增加用于改变场景、角色、叙事方式的表面背景信息（如系统名称、使用角色、
  业务规模），即使原题没有提过。
- 红线是「解题必需」：背景不得引入决定答案所必需的新知识、新事实、新前置条件
  或隐藏约束，也不得把正确项独有的关键词泄入题干。
- 背景优先使用中文与原题已有术语；不得引入新的解题依赖知识或技术前提——用于构造场景的背景术语可以增加，但不得成为回答问题所必需的条件。

选项改写幅度（重要，针对 *-options 风格）：
- 仅做同义替换 / 加几个字 / 换连接词，属于「轻改」，会被去重门禁判为近重复而整条丢弃——
  同一题的两个变体（surface-options 与 context-options）选项将因此雷同，等于没多样化。
- 正确做法是**大幅改写**：换叙述视角、换句式结构、换主语、换例证措辞，让每个选项看起来像是重新写过的，
  但技术结论 / 因果 / 适用条件 / 真假属性一字不改。
- 允许改变单个选项内部的表达结构：把「技术方案」写成「工程决策」、把「原因」写成「后果」、
  调整选项内部叙述顺序——只要该选项代表的技术结论不变。
- 例：原选项「让 LLM 边抽指标边完成跨企业对比运算，省掉计算代码层」→
  可改写为「为省事让模型在抽取阶段就直接归并跨公司排放数据，不必另维护计算逻辑」（视角与句式都变，
  但「LLM 兼任计算不可取」的判定不变）。
- 允许用不同的自然语言表达原选项的技术结论，不要求保留原题的关键词；但不得改变语义角色、因果关系、适用条件、范围或真假属性。

选项语义角色对应（重要，答案契约）：
- 每个输出槽位必须保持原选项的语义角色，**不得将两个选项的语义角色互换**：
  程序按序号把原题答案映射到变体，互换角色会直接判错题（顺序本身由程序统一处理，模型不决定顺序）。
  例：原第 2 项是正确项，变体第 2 项也必须是那个正确项的改写——可以换说法，不可以换成别的选项的意思。
- 只允许改变表达结构，不允许改变因果关系、适用条件、范围、数量或真假属性。
- 不要给某个选项补充解释、理由或额外结论（例如把「增大 batch size」写成
  「增大 batch size 可以显著减少单请求的 prefill 计算」——这已经改变了原选项的语义）。

允许明显重写，但以下 6 条是红线：
1. 不引入新知识点；2. 不新增解题必需的前提；3. 不改变答案；
4. 不改变任何选项的正误语义；5. 不让难度明显变化；6. 不重新创造完全不同的 distractor。

只输出 JSON：

选择题：
{
  "question": "改写后的题干",
  "options": ["改写后的选项1", "改写后的选项2", "改写后的选项3", "改写后的选项4"]
}

开放题：
{
  "question": "改写后的题干"
}`;

/** 从 VARIANT_SYSTEM 头解析 prompt 版本（如 "v3"），供离线变体池的 promptVersion 字段使用。 */
export const VARIANT_PROMPT_VERSION: string =
  (VARIANT_SYSTEM.match(/\[PROMPT-VERSION\s+([^\]]+)\]/) ?? [])[1]?.trim() ?? 'unknown';

/**
 * 4 种同知识重写风格的类型指令（双模式 Variant 设计）：
 * 注入到 system prompt 的「变体风格」段落，指导 LLM 在「语义角色对应 + 答案契约」的硬约束内
 * 偏向某种改写风格。不改变 LLM 不得重新决定 answer / explanation / 选项数量 / 顺序 / 槽位角色的边界。
 */
export const VARIANT_KIND_GUIDANCE: Record<VariantKind, string> = {
  surface:
    'surface（换表达与叙事，不强制加场景）：重写题干措辞、问法与视角，允许换场景入口与约束表达，但不强制植入完整工程场景；若为选择题，仍须按「语义角色对应」逐项改写各选项。',
  context:
    'context（融入工程上下文）：在题干中植入一段具体、真实、不依赖原题的工程背景（系统/角色/规模）后再改写，使题目更有代入感；背景须遵守 system prompt 的「背景信息」红线；若为选择题，仍须按「语义角色对应」逐项改写各选项。',
  'surface-options':
    'surface-options（题干 + 选项改写，默认风格）：改写题干，并对每个选项做**幅度明显**的改写（换视角/句式/主语，而非仅同义替换；允许改变单个选项内部表达结构，但须满足「语义角色对应」），使选项读起来与原文明显不同但技术含义不变。',
  'context-options':
    'context-options（上下文 + 题干 + 选项改写）：在题干中植入具体工程上下文后改写题干（遵守「背景信息」红线），并对每个选项做**幅度明显**的改写（换视角/句式/主语，而非仅同义替换；允许改变单个选项内部表达结构，但须满足「语义角色对应」），使选项读起来与原文明显不同但技术含义不变。',
};

/** 把变体风格指令追加到 system prompt（在「只输出 JSON」约束之后，作为额外风格要求）。 */
function withKind(system: string, kind: VariantKind): string {
  return (
    `${system}\n\n[变体风格 ${kind}]\n本变体必须额外满足以下风格要求：\n${VARIANT_KIND_GUIDANCE[kind]}\n` +
    '在满足上方全部 10 条约束与「只输出 JSON」的基础上，再满足本风格要求。'
  );
}

// 同知识重写契约：模型只允许产出 question / options。
// answer / explanation 不在此类型中——即便模型回吐这两个字段，解析后也无法进入产物。
interface RawVariant {
  question?: string;
  options?: string[];
}

function buildUser(q: Question, format?: FormatId): string {
  // 同知识重写：只向模型暴露「主题 + 必考概念 + 原题题干 + 原题选项」，
  // 不暴露 answer / explanation / referenceAnswer / angle / difficulty，
  // 从源头切断「LLM 重新决定答案」的路径。
  const isChoice = format === 'choice';
  const payload = {
    topic: q.topic,
    requiredConcepts: requiredPointsFor(q) ?? [],
    question: q.question,
    ...(isChoice ? { options: q.formats.choice?.options } : {}),
  };
  return JSON.stringify(payload);
}

function toGeneratedVariant(_q: Question, out: RawVariant): GeneratedVariant {
  // 只接受题干与选项；即使模型输出 answer / explanation 也直接丢弃。
  // 安全边界：LLM 可以改 presentation，但不能重新决定答案。
  return {
    question: out.question ?? '',
    options: out.options,
  };
}

/**
 * 生成同知识重写候选：**一次 LLM 调用 + 解析**，不做校验。
 * 返回未经验证的 `GeneratedVariant`——结构/语义校验由调用方（finalizeQuestion）统一执行，
 * 校验失败时回退原题。本函数只在 LLM 调用本身抛错时才抛出（网络/鉴权/解析失败等）。
 */
export async function generateVariant(
  q: Question,
  complete: CompleteFn,
  format?: FormatId,
  systemPrompt = VARIANT_SYSTEM,
  kind?: VariantKind,
): Promise<GeneratedVariant> {
  const system = kind ? withKind(systemPrompt, kind) : systemPrompt;
  const user = buildUser(q, format);
  const out = extractJSON<RawVariant>(await complete(system, user));
  return toGeneratedVariant(q, out);
}

// ── Offline Assessment Variant 生成（离线池 P0-2，与上面 Runtime presentation 路径对偶） ──
//
// `generateVariant` 只做「换措辞」：不改变 assessment identity，产出恒为 presentation
// variant。离线池要的是「同一 Knowledge 的不同 reasoning path 测量」，必须换测量
// 路径——例如 canonical 测「判断 A 是否成立」，variant 改成「在约束 B 下比较 A/C」
// 或「从故障现象反推 A/C 哪个是根因」。本 prompt 即该规范的机读版本：
//
//   - 同一 Knowledge：topic / tags / requiredConcepts 不变，不引入新的隐含知识前提；
//   - 不同 reasoning path：必须显式声明 assessment.target + assessment.reasoningGoal，
//     且 reasoningGoal 必须是「先做什么 → 再做什么 → 排除什么」三段式，泛化描述拒收；
//   - 选项仍按槽位语义角色对应、真假属性逐项不变、数量不变、不生成 answer / explanation
//     （与 presentation 路径相同的安全边界，见 validateVariant）。
//
// 只走离线管线（scripts/question-variants.ts --mode assessment，默认），绝不进 runtime。

export const VARIANT_ASSESSMENT_SYSTEM = `[PROMPT-VERSION v1]

为已有面试题设计一道「同一知识点、不同推理路径」的变体。

【同一 Knowledge（红线，不可违背）】
1. 考察的 topic 与必考概念不变，不引入需要额外领域知识的新概念、新前提。
2. 每个选项的技术结论 / 因果 / 适用条件 / 真假属性逐项不变（可换表达，不可换真假）。
3. 不改变选项数量，不创造新的 distractor，不交换选项顺序（顺序由程序处理）。
4. 不新增解题必需的关键条件，不删除原题的关键约束，不在题干里泄入答案线索。
5. 不生成答案，不生成解析。

【不同 reasoning path（本题的核心任务）】
6. 变体必须走与原题**不同的推理链**，而不是只换措辞。换路示例（按原题认知动作选择其一）：
   - 原题「判断 A 是否成立」→ 变体「在约束 B 下比较 A 与 C，选出成立者」；
   - 原题「解释机制 M 为何成立」→ 变体「从故障现象反推 M 的哪一环是根因」；
   - 原题「选择最优方案」→ 变体「给定失效约束，排除不可行的方案并说明排除依据」。
7. 必须显式输出 assessment.target（这道变体要测出的判断是什么）与
   assessment.reasoningGoal（考生答对必须走完的推理链）。
8. reasoningGoal 必须是三段式，缺一段即不合格：
   「先做什么 → 再做什么 → 排除什么」
   例：「先对齐 A/C 的可比维度；再在约束 B 下逐项验证各自结论；并排除『只看表面现象』等不成立判断。」
   禁止泛化描述（「考察对 X 的理解」「检验掌握程度」一律不合格）。
9. 同时声明 angle 与 cognitiveTask：它们应与原题不同（视角或认知动作至少换其一）；
   若确实无法换，请如实沿用原值，不要硬编。

【题干与选项】
10. 题干必须实质重写（换场景 / 换提问方式 / 换约束），照抄原题干不合格。
11. 选择题：每个选项做幅度明显的改写（换视角/句式/主语，而非仅同义替换），
    输出的第 N 个选项必须是输入第 N 个选项的改写。
12. 开放题：只输出 question，不要 options 字段。

只输出 JSON：
{
  "question": "改写后的题干",
  "options": ["改写后的选项1", "改写后的选项2", "..."],
  "angle": "<视角>",
  "cognitiveTask": "<认知任务>",
  "assessment": {"target": "…", "reasoningGoal": "先…；再…；并排除…。"}
}`;

/** 离线 assessment prompt 版本（与 VARIANT_PROMPT_VERSION 独立演进）。 */
export const VARIANT_ASSESSMENT_PROMPT_VERSION: string =
  (VARIANT_ASSESSMENT_SYSTEM.match(/\[PROMPT-VERSION\s+([^\]]+)\]/) ?? [])[1]?.trim() ?? 'unknown';

const assessmentRawSchema = z.object({
  question: z.string().optional(),
  options: z.array(z.string()).optional(),
  angle: questionAngleSchema.optional(),
  cognitiveTask: cognitiveTaskSchema.optional(),
  assessment: assessmentSchema.optional(),
});

/** Assessment 变体候选：表达 + 自声明的测量面（applyVariant 经 measurementFaceOf 落地）。 */
export type AssessmentVariantCandidate = GeneratedVariant & VariantMeasurementFace;

function buildAssessmentUser(q: Question, format?: FormatId): string {
  const isChoice = format === 'choice';
  const payload = {
    topic: q.topic,
    tags: q.tags,
    requiredConcepts: requiredPointsFor(q) ?? [],
    question: q.question,
    ...(isChoice ? { options: q.formats.choice?.options } : {}),
    canonicalAngle: q.angle,
    canonicalCognitiveTask: q.cognitiveTask,
    canonicalAssessment: q.assessment,
  };
  return JSON.stringify(payload);
}

/**
 * 生成 assessment 变体候选：一次 LLM 调用 + 结构解析，不做语义校验。
 * angle / cognitiveTask / assessment 非法或缺失时抛出（调用方按 LLM 失败计，
 * 不落盘）——缺了测量意图的 assessment variant 与 presentation 无异，不许入库。
 */
export async function generateAssessmentVariant(
  q: Question,
  complete: CompleteFn,
  format?: FormatId,
  systemPrompt = VARIANT_ASSESSMENT_SYSTEM,
  kind?: VariantKind,
): Promise<AssessmentVariantCandidate> {
  const system = kind ? withKind(systemPrompt, kind) : systemPrompt;
  const user = buildAssessmentUser(q, format);
  const raw = extractJSON<unknown>(await complete(system, user));
  const parsed = assessmentRawSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`assessment 变体输出无法解析：${parsed.error.issues.map((i) => i.message).join('; ')}`);
  }
  const out = parsed.data;
  if (!out.question?.trim()) throw new Error('assessment 变体缺少题干');
  if (!out.assessment) throw new Error('assessment 变体缺少自声明的测量意图（assessment.target + reasoningGoal）');
  if (!out.angle || !out.cognitiveTask) {
    throw new Error('assessment 变体缺少自声明的 angle / cognitiveTask');
  }
  return {
    question: out.question,
    options: out.options,
    angle: out.angle,
    cognitiveTask: out.cognitiveTask,
    assessment: out.assessment,
  };
}
