#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { questionBank } from '../src/data/questionBank.ts';
import type { Question } from '../src/schemas/question.ts';
import { CodeBuddySdkRuntime } from '../src/ai/codebuddySdkRuntime.ts';

const materialSchema = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  title: z.string().min(1),
  content: z.string().min(40),
});
const evidenceFileSchema = z.object({
  materials: z.array(materialSchema).min(1),
});
const evidenceRefSchema = z.object({
  materialId: z.string().min(1),
  quote: z.string().min(20),
});
const independentSchema = z.object({
  answerIndices: z.array(z.number().int().nonnegative()).default([]),
  referenceAnswer: z.string().optional(),
  reasoning: z.string().min(1),
  assumptions: z.array(z.string()).default([]),
});
const statusSchema = z.enum([
  'SUPPORTED', 'REFUTED', 'CONDITIONAL', 'INSUFFICIENT', 'CONFLICTING',
]);
const verificationSchema = z.object({
  options: z.array(z.object({
    index: z.number().int().nonnegative(),
    status: statusSchema,
    reason: z.string().min(1),
    evidence: z.array(evidenceRefSchema),
  })),
  explanationStatus: statusSchema,
  explanationReason: z.string().min(1),
  explanationEvidence: z.array(evidenceRefSchema),
  referenceAnswerStatus: statusSchema.optional(),
  referenceAnswerReason: z.string().optional(),
  referenceAnswerEvidence: z.array(evidenceRefSchema).default([]),
  independentAnswerMatchesReference: z.boolean().optional(),
  missingAssumptions: z.array(z.string()).default([]),
  limitations: z.array(z.string()).default([]),
});

type Material = z.infer<typeof materialSchema>;
type EvidenceRef = z.infer<typeof evidenceRefSchema>;
type Verification = z.infer<typeof verificationSchema>;
type Verdict = 'VERIFIED' | 'INCORRECT' | 'REVIEW' | 'NEEDS_EVIDENCE' | 'ERROR';
interface Outcome {
  id: string;
  verdict: Verdict;
  independent?: unknown;
  findings?: unknown;
  evidenceErrors: string[];
  error?: string;
}

function arg(name: string): string | undefined {
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline !== undefined) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
function has(name: string): boolean {
  return process.argv.includes(`--${name}`) ||
    process.argv.includes(`--${name}=true`);
}
function parseJson<T>(raw: string, schema: z.ZodType<T>): T {
  const trimmed = raw.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  let candidate = fence?.[1];
  if (!candidate) {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start < 0 || end < start) throw new Error('模型输出不包含 JSON 对象。');
    candidate = trimmed.slice(start, end + 1);
  }
  return schema.parse(JSON.parse(candidate));
}
function optionsOf(question: Question): string[] {
  return question.formats.choice?.options ?? [];
}
function answersOf(question: Question): number[] {
  return question.formats.choice?.answer ?? [];
}
function allowedMaterials(question: Question): Set<string> {
  return new Set([
    question.source?.materialId,
    ...(question.source?.relatedMaterials ?? []),
  ].filter((id): id is string => Boolean(id?.trim())));
}
function checkEvidence(
  refs: EvidenceRef[],
  materials: Material[],
  allowed: Set<string>,
  label: string,
): string[] {
  const errors: string[] = [];
  for (const ref of refs) {
    const material = materials.find((item) => item.id === ref.materialId);
    if (!material) {
      errors.push(`${label}: 没有提供材料 ${ref.materialId}`);
      continue;
    }
    if (!allowed.has(ref.materialId)) {
      errors.push(`${label}: 材料 ${ref.materialId} 未登记在题目 source 中`);
    }
    if (!material.content.includes(ref.quote)) {
      errors.push(`${label}: 引文无法在 ${ref.materialId} 中逐字匹配：${ref.quote.slice(0, 80)}`);
    }
  }
  return errors;
}
function sameSet(left: number[], right: number[]): boolean {
  const a = [...left].sort((x, y) => x - y);
  const b = [...right].sort((x, y) => x - y);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
function independentPrompt(question: Question): string {
  const choice = question.formats.choice;
  return [
    '你是独立答题者，必须在不知道题库答案的情况下解题。',
    '此阶段禁止猜测、寻找或引用存储答案；不要读取解析或参考答案。',
    '选择题返回从 0 开始的答案索引；开放题返回你独立写出的完整回答。',
    '说明推理步骤和依赖前提。只返回 JSON：answerIndices、referenceAnswer、reasoning、assumptions。',
    JSON.stringify({
      id: question.id,
      topic: question.topic,
      difficulty: question.difficulty,
      cognitiveTask: question.cognitiveTask ?? null,
      question: question.question,
      choiceType: choice?.type ?? null,
      options: choice?.options ?? [],
      hasOpenAnswer: Boolean(question.formats.open),
    }),
  ].join('\n\n');
}
function verificationPrompt(
  question: Question,
  independent: z.infer<typeof independentSchema>,
  materials: Material[],
): string {
  return [
    '你是技术事实核验员。逐项检查题干、每个选项、存储答案、开放题参考答案和解析。',
    '独立答案在本阶段之前产生，不得为迎合存储答案而调整推理。',
    '只能使用给出的来源摘录；不能用模型记忆补充来源没有支持的事实。',
    '每个 SUPPORTED 或 REFUTED 判断都必须提供逐字引用。对每个选项单独判定，不在答案集合中不代表它必然错误。',
    '条件依赖版本、配置、部署或工作负载时，使用 CONDITIONAL；材料不足时使用 INSUFFICIENT。',
    '开放题请判断独立回答与参考答案的核心结论是否一致，并基于来源评价参考答案。',
    'explanationStatus 表示解析中的关键事实是否得到来源支持。',
    '只返回 JSON：options、explanationStatus、explanationReason、explanationEvidence、referenceAnswerStatus、referenceAnswerReason、referenceAnswerEvidence、independentAnswerMatchesReference、missingAssumptions、limitations。',
    '独立解题结果：\n' + JSON.stringify(independent),
    '题目及存储答案（此阶段才提供）：\n' + JSON.stringify({
      id: question.id,
      question: question.question,
      options: optionsOf(question),
      choiceType: question.formats.choice?.type ?? null,
      storedAnswerIndices: answersOf(question),
      referenceAnswer: question.formats.open?.referenceAnswer ?? null,
      explanation: question.explanation,
      source: question.source ?? null,
    }),
    '提供的来源材料：\n' + JSON.stringify(materials.map((item) => ({
      id: item.id,
      url: item.url,
      title: item.title,
      content: item.content.slice(0, 16000),
    }))),
  ].join('\n\n');
}
function adjudicate(
  question: Question,
  independent: z.infer<typeof independentSchema>,
  findings: Verification,
  materials: Material[],
  allowed: Set<string>,
): { verdict: Verdict; evidenceErrors: string[] } {
  const evidenceErrors: string[] = [];
  let incorrect = false;
  let review = false;

  const choice = question.formats.choice;
  if (choice) {
    const validIndexes = new Set(choice.options.map((_, index) => index));
    if (
      independent.answerIndices.some((index) => !validIndexes.has(index)) ||
      new Set(independent.answerIndices).size !== independent.answerIndices.length
    ) {
      review = true;
    } else if (!sameSet(answersOf(question), independent.answerIndices)) {
      // A model disagreement is not enough to declare the stored key false; require human adjudication.
      review = true;
    }

    const optionIndexSet = new Set(findings.options.map((item) => item.index));
    const expectedIndexes = choice.options.map((_, index) => index);
    if (
      optionIndexSet.size !== findings.options.length ||
      optionIndexSet.size !== expectedIndexes.length ||
      expectedIndexes.some((index) => !optionIndexSet.has(index))
    ) review = true;

    for (const item of findings.options) {
      const shouldSupport = answersOf(question).includes(item.index);
      if (
        (shouldSupport && item.status === 'REFUTED') ||
        (!shouldSupport && item.status === 'SUPPORTED')
      ) incorrect = true;
      if (!['SUPPORTED', 'REFUTED'].includes(item.status)) review = true;
      if (['SUPPORTED', 'REFUTED'].includes(item.status) && item.evidence.length === 0) {
        review = true;
      }
      evidenceErrors.push(...checkEvidence(item.evidence, materials, allowed, `选项 ${item.index}`));
    }
  }

  if (question.formats.open) {
    if (!independent.referenceAnswer?.trim()) review = true;
    if (findings.independentAnswerMatchesReference === false) review = true;
    if (findings.independentAnswerMatchesReference === undefined) review = true;
    if (findings.referenceAnswerStatus === 'REFUTED') incorrect = true;
    if (findings.referenceAnswerStatus !== 'SUPPORTED') review = true;
    if (
      findings.referenceAnswerStatus === 'SUPPORTED' &&
      findings.referenceAnswerEvidence.length === 0
    ) review = true;
    evidenceErrors.push(...checkEvidence(
      findings.referenceAnswerEvidence, materials, allowed, '开放题参考答案',
    ));
  }

  if (findings.explanationStatus === 'REFUTED') incorrect = true;
  if (findings.explanationStatus !== 'SUPPORTED') review = true;
  if (findings.explanationStatus === 'SUPPORTED' && findings.explanationEvidence.length === 0) {
    review = true;
  }
  evidenceErrors.push(...checkEvidence(
    findings.explanationEvidence, materials, allowed, '题目解析',
  ));
  if (findings.missingAssumptions.length > 0) review = true;

  if (incorrect) return { verdict: 'INCORRECT', evidenceErrors };
  if (evidenceErrors.length > 0) return { verdict: 'NEEDS_EVIDENCE', evidenceErrors };
  return { verdict: review ? 'REVIEW' : 'VERIFIED', evidenceErrors };
}

const ids = (arg('ids') ?? '').split(',').map((value) => value.trim()).filter(Boolean);
const knowledgeId = arg('knowledge-id');
const topic = arg('topic');
const limit = Math.max(1, Math.min(100, Number(arg('limit') ?? 10) || 10));
const concurrency = Math.max(1, Math.min(4, Number(arg('concurrency') ?? 2) || 2));
const outputPath = resolve(process.cwd(), arg('out') ?? 'reports/question-correctness-verification.json');
const evidencePath = arg('evidence-file');
const gate = has('gate');
const dryRun = has('dry-run');
const model = process.env.QUESTION_VERIFIER_MODEL?.trim() || 'hy4flash-free';

if (ids.length === 0 && !knowledgeId && !topic) {
  console.error('必须指定 --ids=id1,id2、--knowledge-id=<KnowledgeNode-id> 或旧参数 --topic=<topic>，防止意外核验整个题库。');
  process.exit(2);
}
const targets = questionBank.questions.filter((question) => {
  if (ids.length > 0) return ids.includes(question.id);
  if (knowledgeId) return question.knowledgeId === knowledgeId || (!question.knowledgeId && question.topic === knowledgeId);
  return question.topic === topic;
}).slice(0, limit);
if (targets.length === 0) {
  console.error('没有匹配到题目。');
  process.exit(2);
}
if (!evidencePath && !dryRun) {
  console.error('事实核验必须提供来源摘录：--evidence-file=<JSON path>。没有证据不能标记 VERIFIED。');
  process.exit(2);
}
const materials: Material[] = evidencePath
  ? evidenceFileSchema.parse(JSON.parse(readFileSync(resolve(process.cwd(), evidencePath), 'utf8'))).materials
  : [];

if (dryRun) {
  for (const question of targets) console.log(`- ${question.id}: ${question.question}`);
  console.log('dry-run：未调用模型。');
  process.exit(0);
}

async function mapLimit<T, R>(
  items: T[],
  maxConcurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from(
    { length: Math.min(maxConcurrency, items.length) },
    async () => {
      for (;;) {
        const index = cursor++;
        if (index >= items.length) return;
        output[index] = await fn(items[index]);
      }
    },
  ));
  return output;
}

const runtime = new CodeBuddySdkRuntime();
const outcomes = await mapLimit(targets, concurrency, async (question): Promise<Outcome> => {
  const allowed = allowedMaterials(question);
  const matchingMaterials = materials.filter((item) => allowed.has(item.id));
  if (!question.source?.materialId || matchingMaterials.length === 0) {
    return {
      id: question.id,
      verdict: 'NEEDS_EVIDENCE',
      evidenceErrors: ['题目 source.materialId 没有匹配的来源摘录'],
    };
  }
  try {
    const blind = await runtime.run({
      model,
      systemPrompt: '独立技术答题者。不要读取或猜测题库答案。只返回合法 JSON。',
      prompt: independentPrompt(question),
      timeoutMs: 180000,
    });
    const independent = parseJson(blind.text, independentSchema);
    const checked = await runtime.run({
      model,
      systemPrompt: '基于原始来源摘录的技术事实核验员。不能用模型记忆代替证据。',
      prompt: verificationPrompt(question, independent, matchingMaterials),
      timeoutMs: 180000,
    });
    const findings = parseJson(checked.text, verificationSchema);
    const result = adjudicate(question, independent, findings, matchingMaterials, allowed);
    return {
      id: question.id,
      verdict: result.verdict,
      independent,
      findings,
      evidenceErrors: result.evidenceErrors,
    };
  } catch (error) {
    return {
      id: question.id,
      verdict: 'ERROR',
      evidenceErrors: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

const summary = {
  total: outcomes.length,
  verified: outcomes.filter((item) => item.verdict === 'VERIFIED').length,
  incorrect: outcomes.filter((item) => item.verdict === 'INCORRECT').length,
  review: outcomes.filter((item) => item.verdict === 'REVIEW').length,
  needsEvidence: outcomes.filter((item) => item.verdict === 'NEEDS_EVIDENCE').length,
  errors: outcomes.filter((item) => item.verdict === 'ERROR').length,
};
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  model,
  summary,
  outcomes,
}, null, 2), 'utf8');
console.log(JSON.stringify(summary, null, 2));
console.log(`核验报告：${outputPath}`);
if (gate && summary.verified !== summary.total) process.exit(1);
