// 纯逻辑：reasoning-path（测量路径）的确定性判定。
//
// 背景（Offline Variant Pool P0 整改）：池子里已有代码支持 `assessment.target +
// reasoningGoal`，但存量变体一半以上没有声明新的测量意图，且已声明的 target 与
// canonical 几乎完全相同（dice=100）、reasoningGoal 差异多是选项改写带来的模板
// 差异——即「换措辞冒充 assessment variant」。本模块提供：
//
//   - `isAssessmentIdentical`：变体声明的测量意图与 canonical **逐字相同**（规范化后
//     相等）→ 声称了新路径实则没有，**发布阻断**（validate-variants release gate）。
//   - `findReasoningPathDuplicates`：同一题多个已声明变体之间路径逐字重复 → **发布阻断**。
//   - `findNearIdenticalPaths`：高度疑似同路径（target 与 goal 双高相似）→ 审计可见，
//     不阻断（文本相似 ≠ 同路径，模板化推断会抬高相似度，不能仅凭启发式删资产）。
//   - `hasExplicitReasoningSteps`：reasoningGoal 必须描述「先做什么 → 再做什么 →
//     排除什么」，泛化描述（「考察对 X 的理解」）不算新路径的证据 → 生成器/组装器
//     落盘门禁（offline-only，不进 runtime）。
//   - `checkKindContentMatch`：variant kind 与实际修改内容是否相符（context 类必须
//     真的重写了题干；surface 类不得悄悄加入大段场景）→ 发布门禁。
//
// 全部纯函数、零 LLM，可同时用于离线生成管线与池审计（同一条规则）。

import { cjkDice } from './textSimilarity';
import type { VariantKind } from '../schemas/variant';
import type { AssessmentInference } from './assessmentInference';

export interface ReasoningPath {
  target: string;
  reasoningGoal: string;
}

/** 规范化：去空白、小写。用于「逐字相同」判定。 */
export function normalizeReasoningText(s: string): string {
  return (s ?? '').replace(/\s+/g, '').toLowerCase();
}

/**
 * 变体声明的测量意图与 canonical 是否**逐字相同**（target 与 reasoningGoal 规范化后都相等）。
 *
 * ⚠️ 语义边界（v7.1）：target+goal 相同只证明 **measurement metadata 相同**，**不单独构成
 * 「变体无效 / 重复测量」的判据**——Assessment Variant 允许不改 assessmentTarget/reasoningGoal，
 * 通过不同 observation entry（题干情境 + 自声明的 angle/cognitiveTask face）区分（ADR-077）。
 * 本函数是纯相等判定，供上层门禁**组合使用**：
 *   - 声明了 assessment 且与 canonical 逐字相同，**且未声明任何不同 measurement face** → 纯措辞
 *     冒充，阻断（见 assemble-variants / validate-variants）；
 *   - 声明相同但有不同 face（不同 angle/cognitiveTask）→ 合法 Assessment Variant（新入口），放行。
 * 未声明（继承 canonical）不算 identical——那是 presentation variant，另行统计。
 */
export function isAssessmentIdentical(
  variant: ReasoningPath | undefined,
  canonical: ReasoningPath | undefined,
): boolean {
  if (!variant || !canonical) return false;
  return (
    normalizeReasoningText(variant.target) === normalizeReasoningText(canonical.target) &&
    normalizeReasoningText(variant.reasoningGoal) === normalizeReasoningText(canonical.reasoningGoal)
  );
}

export interface PathSimilarity {
  targetDice: number;
  goalDice: number;
}

/** target / reasoningGoal 的 CJK-Dice 相似度（0~100）。 */
export function reasoningPathSimilarity(a: ReasoningPath, b: ReasoningPath): PathSimilarity {
  return {
    targetDice: cjkDice(a.target ?? '', b.target ?? ''),
    goalDice: cjkDice(a.reasoningGoal ?? '', b.reasoningGoal ?? ''),
  };
}

/**
 * 高度疑似同路径：target 与 goal 双高相似（默认 ≥95 / ≥90）。
 * 审计可见、不阻断——模板化生成的 reasoningGoal（起手动作 + 选项摘要）天然高相似，
 * 仅凭阈值删资产会误伤真正的不同路径。
 */
export function isNearIdenticalPath(
  a: ReasoningPath,
  b: ReasoningPath,
  targetThreshold = 95,
  goalThreshold = 90,
): boolean {
  if (isAssessmentIdentical(a, b)) return true;
  const { targetDice, goalDice } = reasoningPathSimilarity(a, b);
  return targetDice >= targetThreshold && goalDice >= goalThreshold;
}

export interface ReasoningPathItem {
  id: string;
  path: ReasoningPath;
}

export interface ReasoningPathPair {
  a: string;
  b: string;
  targetDice: number;
  goalDice: number;
}

/**
 * 生成期硬门禁：变体声明的 path 与 canonical 是否过于相似（ADR-082 追补）。
 *
 * 与 `isNearIdenticalPath` 同判定（逐字相同，或 target≥95 且 goal≥90），
 * 但语义不同：后者是池审计的"疑似"（不阻断），本函数是生成器的"拒收"——
 * 名字分开，调用方一看便知走的是哪条链路。`isNearIdenticalPath` 本体不动。
 */
export function isReasoningPathTooSimilar(
  a: ReasoningPath,
  b: ReasoningPath,
  targetThreshold = 95,
  goalThreshold = 90,
): boolean {
  if (isAssessmentIdentical(a, b)) return true;

  const { targetDice, goalDice } = reasoningPathSimilarity(a, b);

  return targetDice >= targetThreshold && goalDice >= goalThreshold;
}

/** 同一题多个已声明变体之间：路径逐字重复的配对（阻断级）。 */
export function findReasoningPathDuplicates(items: ReasoningPathItem[]): ReasoningPathPair[] {
  const out: ReasoningPathPair[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (isAssessmentIdentical(items[i].path, items[j].path)) {
        out.push({ a: items[i].id, b: items[j].id, targetDice: 100, goalDice: 100 });
      }
    }
  }
  return out;
}

/**
 * 推断签名相似度阈值（0~100 的 CJK-Dice）：推断出的 reasoningGoal 相似度 ≥ 该值
 * 即判定为同一条 reasoning path（只是换措辞/场景），assessment variant 不予通过。
 *
 * 阈值含义（ADR-082）：这不是"语义等价证明"，而是"不同路径"的可验证近似。
 * 推断签名由 canonical explanation + 各自选项头拼成（见 assessmentInference），
 * 同槽位改写越彻底分数越低。纯换措辞通常仍 ≥82；实质重写表达通常掉到 82 以下。
 * 若线上 pathreject 率异常（过高误杀 / 过低放行），凭遥测归因调该值，不加新门禁。
 */
export const REASONING_PATH_SIMILARITY_THRESHOLD = 82;

/**
 * 推断签名规范化（与 `normalizeReasoningText` 分开的函数，刻意不复用）。
 *
 * `normalizeReasoningText` 服务于「逐字相同」判定（identical / duplicate，阻断级）：
 * 改动它会连带改变这些判定的语义。本函数只服务于推断签名的相似度比较，
 * 额外剥除引号与句读标点——它们在 LLM 声明文本里随机出现，不携带路径信息，
 * 却会系统性压低 Dice（虚假的"不同"）。
 */
export function normalizeReasoningSignature(value: string): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[「」『』"'“”‘’]/g, '')
    .replace(/\s+/g, '')
    .replace(/[，,。；;：:、]/g, '');
}

/**
 * 两条**推断出来的** reasoning path 是否实质不同（ADR-082 离线 assessment 门禁）。
 *
 * 不比较 LLM 自声明的 assessment（可伪造：换几个字、改 angle/cognitiveTask 即能通过
 * identical 检查）。比较双方从实际题面推断出的 reasoningGoal（`inferAssessment` 纯函数产出）：
 * 同一 explanation + 同槽位选项 ⇒ 推断签名天然接近；只有选项表达被实质重写，
 * 签名才会拉开距离——这正是"换了条路测同一知识"的可验证近似。
 *
 * 任一为空（推断失败）返回 false：由调用方按"无法证明不同"处理（拒绝），
 * 不在这里吞掉失败（阈值调整只凭遥测归因，见 ADR-082）。
 */
export function isReasoningPathSubstantiallyDifferent(
  canonical: AssessmentInference,
  variant: AssessmentInference,
): boolean {
  const a = normalizeReasoningSignature(canonical.reasoningGoal);
  const b = normalizeReasoningSignature(variant.reasoningGoal);
  if (!a || !b) return false;
  return cjkDice(a, b) < REASONING_PATH_SIMILARITY_THRESHOLD;
}

/** 同一题多个已声明变体之间：高度疑似同路径的配对（审计级，不阻断）。 */
export function findNearIdenticalPaths(
  items: ReasoningPathItem[],
  targetThreshold = 95,
  goalThreshold = 90,
): ReasoningPathPair[] {
  const out: ReasoningPathPair[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (isNearIdenticalPath(items[i].path, items[j].path, targetThreshold, goalThreshold)) {
        const { targetDice, goalDice } = reasoningPathSimilarity(items[i].path, items[j].path);
        out.push({
          a: items[i].id,
          b: items[j].id,
          targetDice: Math.round(targetDice),
          goalDice: Math.round(goalDice),
        });
      }
    }
  }
  return out;
}

/**
 * reasoningGoal 是否显式描述了推理步骤（离线生成规范 P0-2）。
 * 要求同时出现三类信号，缺一不可：
 *   1. 起手：「先…」
 *   2. 承接：「再…/然后/接着/据此/之后/第二步」
 *   3. 排除：「排除/逐项/是否成立/验证/比较/甄别」（仅「确认成立」不算排除）
 * 泛化描述（「考察对 X 的理解」「检验掌握程度」）必然通不过——它没有推理链。
 */
const LEAD = /先/;
const FOLLOW = /(再|然后|接着|据此|之后|第二步|下一步)/;
/** 排除环节必须是「 ruling out」的动作：确认成立只是承接，不算排除。 */
const EXCLUDE = /(排除|逐项|是否成立|验证|比较|甄别)/;

export function hasExplicitReasoningSteps(reasoningGoal: string): boolean {
  const g = reasoningGoal ?? '';
  return LEAD.test(g) && FOLLOW.test(g) && EXCLUDE.test(g);
}

/** 泛化描述黑名单：出现即视为没有描述推理链（即使碰巧含有「先」字）。 */
const GENERIC_GOAL = /(考察.*理解|检验.*掌握|测试.*能力|考查.*知识|了解.*情况|看看.*水平)/;

export function isGenericReasoningGoal(reasoningGoal: string): boolean {
  return GENERIC_GOAL.test(reasoningGoal ?? '');
}

/** 新资产落盘要求：显式步骤 + 非泛化。存量审计只统计，不追溯阻断。 */
export function isReasoningGoalWellFormed(reasoningGoal: string): boolean {
  return hasExplicitReasoningSteps(reasoningGoal) && !isGenericReasoningGoal(reasoningGoal);
}

export interface KindContentCheck {
  ok: boolean;
  code?: string;
  reason?: string;
}

/**
 * variant kind 与实际修改内容是否相符（发布门禁）。
 *
 * 只判**可证明错**的情形，不做风格审美：
 *   - kind 为 context / context-options，却与 canonical 题干近乎逐字相同
 *     （CJK-Dice ≥ 95）→ 声称加了上下文实则没改，判不匹配。
 *   - kind 为 surface，题干却膨胀到 1.8× 以上且新增大段场景 → 实为 context，
 *     判不匹配（标错 kind 会污染按 kind 统计的 coverage 矩阵）。
 *   - `*-options` 与非 options 的区分由 validateVariant 的必填 options 保证，不在此重复。
 *
 * 校准：现行池 102 条变体 0 命中（context 类全部真实重写了题干，无挂名项）。
 */
export function checkKindContentMatch(
  kind: VariantKind,
  variantStem: string,
  canonicalStem: string,
): KindContentCheck {
  const stemDice = cjkDice(variantStem ?? '', canonicalStem ?? '');
  if ((kind === 'context' || kind === 'context-options') && stemDice >= 95) {
    return {
      ok: false,
      code: 'kind-content-mismatch',
      reason: `kind=${kind} 但题干与原题近乎相同（相似度 ${Math.round(stemDice)}），没有真正加入工程上下文`,
    };
  }
  if (kind === 'surface' && variantStem.length > canonicalStem.length * 1.8 && stemDice < 70) {
    return {
      ok: false,
      code: 'kind-content-mismatch',
      reason: `kind=surface 但题干大幅重写/膨胀（${canonicalStem.length}→${variantStem.length} 字），实为 context 类，应标 context`,
    };
  }
  return { ok: true };
}
