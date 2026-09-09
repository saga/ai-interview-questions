/// <reference types="vite/client" />
// scripts/validate-variants.ts —— 离线变体池审计 + **发布门禁**（双模式 Variant 设计配套）。
//
// 2026-09-03：从「只读审计报告」升级为**真正的 release gate**（P0-3）。
// 此前它只打印统计、永远 exit 0 —— 池子里有 stale 或近重复也能一路进仓库、进构建。
// 现在：stale / 近重复 / 语言质量不合格 → exit 1，阻断发布。
//
// 2026-09-08（Offline Pool P0/P1 整改）：门禁从「措辞级」升级到「路径级」——
//   - 新增阻断项：assessment identical（声明了却与 canonical 逐字相同）、
//     reasoning-path duplicate（同题 sibling 路径逐字重复）、orphan variant、
//     duplicate variant id、duplicate (questionId, id)、variant 数量异常（>4）、
//     canonical/variant format 不一致、variant kind 与实际修改内容不匹配；
//   - 近重复从「选项文本 Dice」升级为语义级（domain/variant.findSemanticDuplicateVariants：
//     options 雷同 / 同路径逐字重复 / 同 kind 题干照抄）；
//   - 新增 coverage 审计：canonical 总数、覆盖率、每题 variant 数分布（0/1/≥2）、
//     kind 覆盖、assessment 覆盖、reasoning-path 唯一率、Concept×Angle×CognitiveTask 分布；
//   - stale 归因：有 sourceSnapshot 的变体逐字段 diff，区分「仅 metadata 变化
//     （重算 hash 即可）」与「题面/选项变化（需重新生成）」。
//
// 用法：npx vite-node scripts/validate-variants.ts [--json] [--dup-threshold 88]
//
// 退出码：0 = 池健康；1 = 存在必须处理的问题。
// 过渡期若需「只看不拦」，加 --no-fail（会明确标注退出码被降级，不要用于 CI）。

import { questionBank } from '../src/data/questionBank';
import { variantPool } from '../src/data/variantBank';
import { isVariantStale } from '../src/domain/variantPool';
import {
  findSemanticDuplicateVariants,
  checkOfflineDifficultyDrivers,
  VARIANT_DUP_THRESHOLD,
} from '../src/domain/variant';
import {
  isAssessmentIdentical,
  isNearIdenticalPath,
  isReasoningGoalWellFormed,
  findReasoningPathDuplicates,
  checkKindContentMatch,
  type ReasoningPath,
} from '../src/domain/reasoningPath';
import { checkLanguageSanity, formatSanityIssues } from '../src/domain/languageSanity';
import type { Question } from '../src/schemas/question';
import type { QuestionVariant } from '../src/schemas/variant';

interface CliOptions {
  json: boolean;
  dupThreshold: number;
  /** 过渡期开关：只报告不阻断。CI 与发布前不得使用。 */
  noFail: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const out: CliOptions = { json: false, dupThreshold: VARIANT_DUP_THRESHOLD, noFail: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--no-fail') out.noFail = true;
    else if (a === '--dup-threshold')
      out.dupThreshold = Math.max(50, Math.min(100, Number(argv[++i]) || VARIANT_DUP_THRESHOLD));
  }
  return out;
}

/** 单题允许的变体上限（P2-14：P0 核心题 3–4 条高质量路径；超过即数量异常，需人工确认）。 */
export const MAX_VARIANTS_PER_QUESTION = 4;

interface StaleEntry {
  questionId: string;
  variantId: string;
  kind: string;
  reason: string;
  /** stale 归因：metadata-only（重算 hash 即可）/ content（需重新生成）/ legacy（无快照）/ orphan。 */
  attribution: 'metadata-only' | 'content' | 'legacy' | 'orphan';
  changedFields: string[];
}

interface DupPair {
  questionId: string;
  a: string;
  b: string;
  ratio: number;
  basis: string;
  detail: string;
}

interface SanityEntry {
  questionId: string;
  variantId: string;
  kind: string;
  detail: string;
}

interface BlockingEntry {
  questionId: string;
  variantId: string;
  detail: string;
}

interface AuditEntry {
  questionId: string;
  variantId: string;
  detail: string;
}

interface CoverageMatrixRow {
  questionId: string;
  variantCount: number;
  kinds: string[];
  /** 该题不同 reasoning path 数（含 canonical 自身路径；未声明测量意图的按 canonical 路径计）。 */
  distinctPaths: number;
  declaredPaths: number;
  inheritedPaths: number;
}

interface Report {
  canonicalTotal: number;
  covered: number;
  coveragePct: number;
  total: number;
  avgPerCovered: number;
  p50PerCovered: number;
  p90PerCovered: number;
  buckets: { zero: number; one: number; twoPlus: number };
  kindCoverage: Record<string, number>;
  assessmentDeclared: number;
  assessmentInherited: number;
  assessmentPct: number;
  reasoningPathUniquePct: number;
  conceptAngleTask: Array<{ concept: string; angle: string; cognitiveTask: string; count: number }>;
  coverageMatrix: CoverageMatrixRow[];
  stale: StaleEntry[];
  orphan: BlockingEntry[];
  dupPairs: DupPair[];
  sanity: SanityEntry[];
  dupThreshold: number;
  assessmentIdentical: BlockingEntry[];
  reasoningPathDuplicates: BlockingEntry[];
  kindMismatch: BlockingEntry[];
  formatMismatch: BlockingEntry[];
  duplicateIds: BlockingEntry[];
  countAnomaly: BlockingEntry[];
  nearIdenticalPaths: AuditEntry[];
  weakReasoningGoals: AuditEntry[];
  difficultyDrivers: AuditEntry[];
  /** 是否达到发布标准（全部阻断项为 0；审计项不参与）。 */
  healthy: boolean;
}

const META_FIELDS = ['topic', 'subtopic', 'angle', 'difficulty', 'cognitiveTask', 'tags'] as const;
const CONTENT_FIELDS = ['question', 'options'] as const;

function normPath(p: ReasoningPath | undefined): string | null {
  if (!p) return null;
  const t = (p.target ?? '').replace(/\s+/g, '').toLowerCase();
  const g = (p.reasoningGoal ?? '').replace(/\s+/g, '').toLowerCase();
  if (!t && !g) return null;
  return `${t} || ${g}`;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function buildReport(dupThreshold: number): Report {
  const byId = new Map<string, Question>();
  for (const q of questionBank.questions) byId.set(q.id, q);

  const stale: StaleEntry[] = [];
  const orphan: BlockingEntry[] = [];
  const dupPairs: DupPair[] = [];
  const sanity: SanityEntry[] = [];
  const assessmentIdentical: BlockingEntry[] = [];
  const reasoningPathDuplicates: BlockingEntry[] = [];
  const kindMismatch: BlockingEntry[] = [];
  const formatMismatch: BlockingEntry[] = [];
  const duplicateIds: BlockingEntry[] = [];
  const countAnomaly: BlockingEntry[] = [];
  const nearIdenticalPaths: AuditEntry[] = [];
  const weakReasoningGoals: AuditEntry[] = [];
  const difficultyDrivers: AuditEntry[] = [];

  const kindCoverage: Record<string, number> = {};
  const seenIds = new Map<string, string>();
  const seenQidId = new Set<string>();
  let total = 0;
  let covered = 0;
  let assessmentDeclared = 0;
  let assessmentInherited = 0;
  let pathUniqueVariants = 0;
  let pathTotalVariants = 0;
  const perQuestionCounts: number[] = [];
  const coverageMatrix: CoverageMatrixRow[] = [];
  const catCount = new Map<string, number>();

  let zeroBucket = 0;

  for (const [qid, list] of Object.entries(variantPool.variants)) {
    if (list.length > 0) covered++;
    total += list.length;
    perQuestionCounts.push(list.length);
    const canonical = byId.get(qid);

    // ── orphan：canonical 缺失（题目已从题库移除）──
    if (!canonical) {
      for (const v of list) {
        orphan.push({ questionId: qid, variantId: v.id, detail: 'canonical 缺失（题目已从题库移除）' });
        stale.push({
          questionId: qid,
          variantId: v.id,
          kind: v.kind,
          reason: 'canonical 缺失（题目已从题库移除）',
          attribution: 'orphan',
          changedFields: [],
        });
      }
      continue;
    }

    // ── 全局 duplicate variant id / (questionId, id) ──
    for (const v of list) {
      const prev = seenIds.get(v.id);
      if (prev && prev !== qid) {
        duplicateIds.push({ questionId: qid, variantId: v.id, detail: `variant id 全局重复（已见于 ${prev}）` });
      } else {
        seenIds.set(v.id, qid);
      }
      const key = `${qid}␟${v.id}`;
      if (seenQidId.has(key)) {
        duplicateIds.push({ questionId: qid, variantId: v.id, detail: '同一题内 (questionId, id) 重复' });
      } else {
        seenQidId.add(key);
      }
    }

    // ── 数量异常：单题超过上限（要么刷量，要么该拆成多题资产）──
    if (list.length > MAX_VARIANTS_PER_QUESTION) {
      countAnomaly.push({
        questionId: qid,
        variantId: list.map((v) => v.id).join(','),
        detail: `单题 ${list.length} 条变体，超过上限 ${MAX_VARIANTS_PER_QUESTION}（P0 核心题 3–4 条为限，多了需人工确认）`,
      });
    }

    // ── stale（含归因，P1-10）──
    for (const v of list) {
      if (!isVariantStale(v, canonical)) continue;
      let attribution: StaleEntry['attribution'] = 'legacy';
      let changedFields: string[] = [];
      let reason = 'sourceHash 与原题不一致（原题已改）';
      const snap = (v as QuestionVariant).sourceSnapshot as Record<string, unknown> | undefined;
      if (snap) {
        const cur = {
          id: canonical.id,
          topic: canonical.topic,
          subtopic: canonical.subtopic,
          angle: canonical.angle,
          difficulty: canonical.difficulty,
          cognitiveTask: canonical.cognitiveTask,
          tags: canonical.tags,
          question: canonical.question,
          options: canonical.formats.choice?.options,
        } as Record<string, unknown>;
        const norm = (x: unknown) =>
          JSON.stringify(Array.isArray(x) ? [...x].map(String).sort() : (x ?? ''));
        changedFields = [...META_FIELDS, ...CONTENT_FIELDS].filter((f) => norm(snap[f]) !== norm(cur[f]));
        const contentChanged = changedFields.some((f) => (CONTENT_FIELDS as readonly string[]).includes(f));
        if (changedFields.length === 0) {
          attribution = 'legacy';
          reason = 'sourceHash 不一致但快照字段全同（可能是指纹算法升级所致，重算 hash 即可）';
        } else if (!contentChanged) {
          attribution = 'metadata-only';
          reason = `仅 metadata 变化（${changedFields.join('/')}），重算 hash 即可，不要调 LLM 重新生成`;
        } else {
          attribution = 'content';
          reason = `题面/选项变化（${changedFields.join('/')}），需 --stale 重新生成`;
        }
      }
      stale.push({ questionId: qid, variantId: v.id, kind: v.kind, reason, attribution, changedFields });
    }

    // ── 语义级近重复（options / reasoning-path / stem 三判定面）──
    for (const p of findSemanticDuplicateVariants(
      list.map((v) => ({
        id: v.id,
        kind: v.kind,
        question: v.question,
        options: v.options,
        assessment: v.assessment
          ? { target: v.assessment.target, reasoningGoal: v.assessment.reasoningGoal }
          : undefined,
      })),
      dupThreshold,
    )) {
      dupPairs.push({
        questionId: qid,
        a: list[p.i].id,
        b: list[p.j].id,
        ratio: p.ratio,
        basis: p.basis,
        detail: p.detail,
      });
    }

    // ── 语言质量 ──
    for (const v of list) {
      const result = checkLanguageSanity(
        { stem: v.question, options: v.options },
        { stem: canonical.question, options: canonical.formats?.choice?.options },
      );
      if (!result.ok) {
        sanity.push({ questionId: qid, variantId: v.id, kind: v.kind, detail: formatSanityIssues(result) });
      }
    }

    // ── format 一致性：choice 题变体必须带 options；open 题变体不得带 options ──
    const isChoice = !!canonical.formats.choice;
    for (const v of list) {
      if (isChoice && !v.options) {
        formatMismatch.push({ questionId: qid, variantId: v.id, detail: 'canonical 为选择题，变体缺少 options' });
      } else if (!isChoice && v.options) {
        formatMismatch.push({ questionId: qid, variantId: v.id, detail: 'canonical 为开放题，变体不应带 options' });
      }
    }

    // ── kind 与实际修改内容相符 ──
    for (const v of list) {
      const kc = checkKindContentMatch(v.kind, v.question, canonical.question);
      if (!kc.ok) kindMismatch.push({ questionId: qid, variantId: v.id, detail: kc.reason ?? kc.code ?? 'kind 不符' });
    }

    // ── 测量意图：identical 的判定已升级为「face 感知」（v7.1）——Assessment Variant 允许
    // target/goal 与 canonical 相同，只要自声明了不同 angle/cognitiveTask（新 observation
    // entry）即合法；只有「声明相同 + 无任何 face 变化」的纯措辞冒充才阻断。
    const declaredItems: Array<{ id: string; path: ReasoningPath }> = [];
    for (const v of list) {
      kindCoverage[v.kind] = (kindCoverage[v.kind] ?? 0) + 1;
      if (!v.assessment) {
        assessmentInherited++;
      } else {
        assessmentDeclared++;
        declaredItems.push({
          id: v.id,
          path: { target: v.assessment.target, reasoningGoal: v.assessment.reasoningGoal },
        });
        const faceChanged =
          (v.angle !== undefined && v.angle !== canonical.angle) ||
          (v.cognitiveTask !== undefined && v.cognitiveTask !== canonical.cognitiveTask);
        if (canonical.assessment && isAssessmentIdentical(v.assessment, canonical.assessment)) {
          if (!faceChanged) {
            assessmentIdentical.push({
              questionId: qid,
              variantId: v.id,
              detail: '变体声明的测量意图与 canonical 逐字相同且未声明不同 face：纯措辞冒充，实则无新观察入口',
            });
          } else {
            nearIdenticalPaths.push({
              questionId: qid,
              variantId: v.id,
              detail: '测量意图与 canonical 相同但自声明了不同 angle/cognitiveTask（Assessment Variant，审计可见）',
            });
          }
        } else if (canonical.assessment && isNearIdenticalPath(v.assessment, canonical.assessment)) {
          nearIdenticalPaths.push({
            questionId: qid,
            variantId: v.id,
            detail: '与 canonical 测量意图高度相似（target≥95 且 goal≥90），疑似同路径（审计项）',
          });
        }
        if (!isReasoningGoalWellFormed(v.assessment.reasoningGoal)) {
          weakReasoningGoals.push({
            questionId: qid,
            variantId: v.id,
            detail: 'reasoningGoal 不是「先→再→排除」三段式（存量审计项；新资产落盘门禁已拦截）',
          });
        }
      }
      // difficulty 驱动项（审计口径；生成管线已做确定性拦截）。
      const drivers = checkOfflineDifficultyDrivers(canonical, {
        question: v.question,
        options: v.options,
      }, v.kind);
      for (const f of drivers.flags) {
        difficultyDrivers.push({ questionId: qid, variantId: v.id, detail: `${f.flag}：${f.detail}` });
      }
    }
    for (const p of findReasoningPathDuplicates(declaredItems)) {
      reasoningPathDuplicates.push({
        questionId: qid,
        variantId: `${p.a} ⇄ ${p.b}`,
        detail: '同题两个已声明变体测量意图逐字相同：文本不同但测的是同一条推理链',
      });
    }

    // ── reasoning-path 唯一率：canonical 路径 + 各变体路径去重后，出现恰好一次的变体占比 ──
    const canonKey = normPath(canonical.assessment);
    const groupKeys = [canonKey, ...list.map((v) => (v.assessment ? normPath(v.assessment) : canonKey))];
    const freq = new Map<string | null, number>();
    for (const k of groupKeys) freq.set(k, (freq.get(k) ?? 0) + 1);
    list.forEach((v) => {
      pathTotalVariants++;
      const k = v.assessment ? normPath(v.assessment) : canonKey;
      if ((freq.get(k) ?? 0) === 1) pathUniqueVariants++;
    });

    // ── coverage 矩阵行 ──
    const distinct = new Set(groupKeys.map((k) => k ?? `null:${qid}`)).size;
    coverageMatrix.push({
      questionId: qid,
      variantCount: list.length,
      kinds: [...new Set(list.map((v) => v.kind))],
      distinctPaths: distinct,
      declaredPaths: declaredItems.length,
      inheritedPaths: list.length - declaredItems.length,
    });

    // ── Concept×Angle×CognitiveTask 分布（P2-16：诊断覆盖口径）──
    const task = canonical.cognitiveTask ?? '（未声明）';
    const catKey = `${canonical.category}␟${canonical.angle}␟${task}`;
    catCount.set(catKey, (catCount.get(catKey) ?? 0) + 1);
  }

  for (const q of questionBank.questions) {
    if (!(qidOf(q) in variantPool.variants)) zeroBucket++;
  }

  const sorted = [...perQuestionCounts].sort((a, b) => a - b);
  const conceptAngleTask = [...catCount.entries()]
    .map(([k, count]) => {
      const [concept, angle, cognitiveTask] = k.split('␟');
      return { concept, angle, cognitiveTask, count };
    })
    .sort((a, b) => b.count - a.count);

  const healthy =
    stale.length === 0 &&
    orphan.length === 0 &&
    dupPairs.length === 0 &&
    sanity.length === 0 &&
    assessmentIdentical.length === 0 &&
    reasoningPathDuplicates.length === 0 &&
    kindMismatch.length === 0 &&
    formatMismatch.length === 0 &&
    duplicateIds.length === 0 &&
    countAnomaly.length === 0;

  return {
    canonicalTotal: questionBank.questions.length,
    covered,
    coveragePct: questionBank.questions.length > 0 ? (covered / questionBank.questions.length) * 100 : 0,
    total,
    avgPerCovered: covered > 0 ? total / covered : 0,
    p50PerCovered: percentile(sorted, 50),
    p90PerCovered: percentile(sorted, 90),
    buckets: {
      zero: zeroBucket,
      one: sorted.filter((n) => n === 1).length,
      twoPlus: sorted.filter((n) => n >= 2).length,
    },
    kindCoverage,
    assessmentDeclared,
    assessmentInherited,
    assessmentPct: total > 0 ? (assessmentDeclared / total) * 100 : 0,
    reasoningPathUniquePct: pathTotalVariants > 0 ? (pathUniqueVariants / pathTotalVariants) * 100 : 0,
    conceptAngleTask,
    coverageMatrix,
    stale,
    orphan,
    dupPairs,
    sanity,
    dupThreshold,
    assessmentIdentical,
    reasoningPathDuplicates,
    kindMismatch,
    formatMismatch,
    duplicateIds,
    countAnomaly,
    nearIdenticalPaths,
    weakReasoningGoals,
    difficultyDrivers,
    healthy,
  };
}

function qidOf(q: Question): string {
  return q.id;
}

function printReport(r: Report, noFail: boolean): void {
  console.log('── 变体池校验 ──');
  console.log(`  canonical 总数 : ${r.canonicalTotal}`);
  console.log(`  题目覆盖数     : ${r.covered}（${r.coveragePct.toFixed(1)}%）`);
  console.log(`  变体总数       : ${r.total}`);
  console.log(`  每题 variant   : 平均 ${r.avgPerCovered.toFixed(2)} · P50 ${r.p50PerCovered} · P90 ${r.p90PerCovered}`);
  console.log(`  题数分布       : 0 条 ${r.buckets.zero} · 1 条 ${r.buckets.one} · ≥2 条 ${r.buckets.twoPlus}`);
  console.log(`  kind 覆盖      : ${Object.entries(r.kindCoverage).map(([k, n]) => `${k}=${n}`).join(' · ') || '（无）'}`);
  console.log(
    `  assessment     : 自声明 ${r.assessmentDeclared}（${r.assessmentPct.toFixed(1)}%）· 继承 canonical ${r.assessmentInherited}`,
  );
  console.log(`  路径唯一率     : ${r.reasoningPathUniquePct.toFixed(1)}%（同题内路径恰好出现一次的变体占比，含 canonical 路径）`);

  const block = (name: string, n: number) => console.log(`  ${name}: ${n}`);
  block('stale 数         ', r.stale.length);
  for (const s of r.stale) {
    console.log(`    ✗ ${s.questionId} / ${s.variantId} [${s.kind}] —— ${s.reason}`);
  }
  block('orphan 数        ', r.orphan.length);
  for (const s of r.orphan) console.log(`    ✗ ${s.questionId} / ${s.variantId} —— ${s.detail}`);
  console.log(`  近重复对数     : ${r.dupPairs.length}（阈值 CJK-Dice ≥ ${r.dupThreshold}，语义级三判定面）`);
  for (const d of r.dupPairs) {
    console.log(`    • ${d.questionId}: ${d.a} ⇄ ${d.b}（${d.basis}，${d.detail}）`);
  }
  block('语言质量不合格 ', r.sanity.length);
  for (const s of r.sanity) {
    console.log(`    ✗ ${s.questionId} / ${s.variantId} [${s.kind}] —— ${s.detail}`);
  }
  block('测量意图雷同   ', r.assessmentIdentical.length);
  for (const s of r.assessmentIdentical) console.log(`    ✗ ${s.questionId} / ${s.variantId} —— ${s.detail}`);
  block('路径重复        ', r.reasoningPathDuplicates.length);
  for (const s of r.reasoningPathDuplicates) console.log(`    ✗ ${s.questionId} / ${s.variantId} —— ${s.detail}`);
  block('kind 不符       ', r.kindMismatch.length);
  for (const s of r.kindMismatch) console.log(`    ✗ ${s.questionId} / ${s.variantId} —— ${s.detail}`);
  block('format 不一致   ', r.formatMismatch.length);
  for (const s of r.formatMismatch) console.log(`    ✗ ${s.questionId} / ${s.variantId} —— ${s.detail}`);
  block('重复 id         ', r.duplicateIds.length);
  for (const s of r.duplicateIds) console.log(`    ✗ ${s.questionId} / ${s.variantId} —— ${s.detail}`);
  block('数量异常        ', r.countAnomaly.length);
  for (const s of r.countAnomaly) console.log(`    ✗ ${s.questionId} / ${s.variantId} —— ${s.detail}`);

  console.log(`  近似同路径（审计）: ${r.nearIdenticalPaths.length}`);
  for (const s of r.nearIdenticalPaths.slice(0, 10)) {
    console.log(`    • ${s.questionId} / ${s.variantId} —— ${s.detail}`);
  }
  if (r.nearIdenticalPaths.length > 10) console.log(`    … 还有 ${r.nearIdenticalPaths.length - 10} 条（见 --json）`);
  console.log(`  推理链薄弱（审计）: ${r.weakReasoningGoals.length}`);
  for (const s of r.weakReasoningGoals.slice(0, 10)) {
    console.log(`    • ${s.questionId} / ${s.variantId} —— ${s.detail}`);
  }
  if (r.weakReasoningGoals.length > 10) console.log(`    … 还有 ${r.weakReasoningGoals.length - 10} 条（见 --json）`);
  console.log(`  难度驱动信号（审计）: ${r.difficultyDrivers.length}`);
  for (const s of r.difficultyDrivers.slice(0, 10)) {
    console.log(`    • ${s.questionId} / ${s.variantId} —— ${s.detail}`);
  }
  if (r.difficultyDrivers.length > 10) console.log(`    … 还有 ${r.difficultyDrivers.length - 10} 条（见 --json）`);

  console.log('  Concept×Angle×CognitiveTask（变体覆盖题的 canonical 分布，前 10）：');
  for (const c of r.conceptAngleTask.slice(0, 10)) {
    console.log(`    • ${c.concept} × ${c.angle} × ${c.cognitiveTask}: ${c.count}`);
  }

  if (r.healthy) {
    console.log('\n✓ 池健康：全部发布门禁通过。');
    return;
  }

  console.log('\n✗ 池不健康，必须处理后再发布：');
  if (r.stale.length > 0) {
    const meta = r.stale.filter((s) => s.attribution === 'metadata-only').length;
    const content = r.stale.filter((s) => s.attribution === 'content').length;
    console.log(
      `    · ${r.stale.length} 条 stale（metadata-only ${meta} 条→重算 hash；content ${content} 条→ --stale 重生成；其余走 legacy 判定）`,
    );
  }
  if (r.orphan.length > 0) console.log(`    · ${r.orphan.length} 条 orphan —— canonical 已移除，删除对应变体`);
  if (r.dupPairs.length > 0) console.log(`    · ${r.dupPairs.length} 对语义重复 —— 重生成或删除其中一条`);
  if (r.sanity.length > 0) console.log(`    · ${r.sanity.length} 条语言质量不合格 —— 重生成`);
  if (r.assessmentIdentical.length > 0)
    console.log(`    · ${r.assessmentIdentical.length} 条测量意图雷同 —— 声明了新路径实则逐字相同，重写或删去声明`);
  if (r.reasoningPathDuplicates.length > 0)
    console.log(`    · ${r.reasoningPathDuplicates.length} 对路径重复 —— 同题 sibling 测同一条链，删其一或重写`);
  if (r.kindMismatch.length > 0) console.log(`    · ${r.kindMismatch.length} 条 kind 不符 —— 改正 kind 或重写题干`);
  if (r.formatMismatch.length > 0) console.log(`    · ${r.formatMismatch.length} 条 format 不一致 —— 补/删 options`);
  if (r.duplicateIds.length > 0) console.log(`    · ${r.duplicateIds.length} 条重复 id —— 重命名`);
  if (r.countAnomaly.length > 0) console.log(`    · ${r.countAnomaly.length} 题数量异常 —— 确认或删减到 ≤${MAX_VARIANTS_PER_QUESTION}`);
  if (noFail) {
    console.log('\n⚠ --no-fail：已按要求**不阻断**，退出码降级为 0。此开关仅供过渡期人工核查，禁止用于 CI。');
  }
}

function main(): void {
  const { json, dupThreshold, noFail } = parseArgs(process.argv.slice(2));
  const report = buildReport(dupThreshold);

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report, noFail);
  }

  // 发布门禁：任何阻断项存在即 exit 1（--no-fail 时降级）。
  if (!report.healthy && !noFail) process.exit(1);
}

main();
