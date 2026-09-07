#!/usr/bin/env node

/**
 * Build a correctness-verification worklist.
 *
 * IMPORTANT:
 * This script is TRIAGE ONLY.
 *
 * It does not determine whether a question is correct.
 * It does not modify the question bank.
 * It does not replace schema validation.
 * It does not run an LLM.
 *
 * Its purpose is to prioritize questions where semantic correctness
 * verification is more valuable.
 *
 * Usage:
 *
 *   node --experimental-strip-types scripts/verify-question-candidates.ts
 *
 *   node --experimental-strip-types scripts/verify-question-candidates.ts \
 *     --output reports/question-correctness-worklist.jsonl
 *
 *   node --experimental-strip-types scripts/verify-question-candidates.ts \
 *     --min-risk high
 *
 * The script intentionally uses Node's built-in TypeScript stripping so
 * the repository does not need to add tsx merely for this utility.
 */

import fs from "node:fs";
import path from "node:path";

type ChoiceType = "single" | "multiple";

type QuestionFormat = "single" | "multiple" | "open" | "unknown";

type RiskLevel = "low" | "medium" | "high";

/**
 * Triage urgency only.
 *
 * Deliberately NOT named P0/P1/P2: in this repository P0/P1/P2 already means
 * "confirmed defect severity" produced by the verify-question-correctness
 * skill. Reusing it here would let `P0 candidate` be misread as
 * "confirmed P0 defect".
 */
type VerificationPriority = "HIGH" | "MEDIUM" | "LOW";

interface ChoiceFormat {
  type?: ChoiceType;
  options?: string[];
  answer?: number[];
}

interface OpenFormat {
  referenceAnswer?: string;
}

interface QuestionLike {
  id?: string;
  category?: string;
  topic?: string;
  subtopic?: string;
  difficulty?: string;
  angle?: string;
  cognitiveTask?: string;
  question?: string;
  explanation?: string;
  concepts?: {
    core?: string[];
    supporting?: string[];
  };
  assessment?: {
    target?: string;
    reasoningGoal?: string;
  };
  formats?: {
    choice?: ChoiceFormat;
    open?: OpenFormat;
  };
}

interface EvidenceSignal {
  code: string;
  description: string;
  points: number;
}

interface Candidate {
  id: string;
  file: string;
  format: QuestionFormat;
  riskScore: number;
  riskLevel: RiskLevel;
  verificationPriority: VerificationPriority;
  reasons: string[];
  signals: string[];
  metadata: {
    category?: string;
    topic?: string;
    difficulty?: string;
    angle?: string;
    cognitiveTask?: string;
  };
}

interface ParsedArgs {
  output: string;
  minRisk: RiskLevel;
  limit?: number;
  sample?: number;
}

const ROOT = process.cwd();

const QUESTION_ROOT = path.join(ROOT, "src/data/questions");

const DEFAULT_OUTPUT = path.join(
  ROOT,
  "reports/question-correctness-worklist.jsonl",
);

/**
 * These are intentionally narrow and high-signal.
 *
 * Do NOT add generic AI/LLM/domain keywords here.
 * A question being about AI is not itself a correctness-risk signal.
 */
const ABSOLUTE_PATTERNS: Array<{
  pattern: RegExp;
  code: string;
  description: string;
  points: number;
}> = [
  {
    pattern: /\balways\b/i,
    code: "absolute.always",
    description: "uses universal wording: always",
    points: 5,
  },
  {
    pattern: /\bnever\b/i,
    code: "absolute.never",
    description: "uses universal wording: never",
    points: 5,
  },
  {
    pattern: /\bguarantee(?:s|d)?\b/i,
    code: "absolute.guarantee",
    description: "uses guarantee language",
    points: 6,
  },
  {
    pattern: /\bmust\b/i,
    code: "absolute.must",
    description: "uses strong necessity language",
    points: 3,
  },
  {
    pattern: /\bcannot\b/i,
    code: "absolute.cannot",
    description: "uses strong impossibility language",
    points: 4,
  },
  {
    pattern: /\bnecessarily\b/i,
    code: "absolute.necessarily",
    description: "uses necessity language",
    points: 5,
  },
  {
    pattern: /\bonly\b/i,
    code: "absolute.only",
    description: "uses exclusivity language",
    points: 3,
  },
  {
    pattern: /\bfor all\b/i,
    code: "absolute.for-all",
    description: "uses universal quantification",
    points: 6,
  },
  {
    pattern: /\bin every case\b/i,
    code: "absolute.every-case",
    description: "uses universal-case wording",
    points: 6,
  },
  {
    pattern: /\bnone\b/i,
    code: "absolute.none",
    description: "uses absolute negative quantification",
    points: 4,
  },
];

const MATHEMATICAL_PATTERNS: Array<{
  pattern: RegExp;
  code: string;
  description: string;
  points: number;
}> = [
  {
    pattern: /\bO\([^)]+\)/,
    code: "math.big-o",
    description: "contains asymptotic complexity notation",
    points: 6,
  },
  {
    pattern: /\bΘ\([^)]+\)/u,
    code: "math.theta",
    description: "contains Theta complexity notation",
    points: 6,
  },
  {
    pattern: /\bTheta\([^)]+\)/i,
    code: "math.theta-ascii",
    description: "contains Theta complexity notation",
    points: 6,
  },
  {
    pattern: /\bΩ\([^)]+\)/u,
    code: "math.omega",
    description: "contains Omega complexity notation",
    points: 6,
  },
  {
    pattern: /\bomega\([^)]+\)/i,
    code: "math.omega-ascii",
    description: "contains Omega complexity notation",
    points: 6,
  },
  {
    pattern: /\brank\b/i,
    code: "math.rank",
    description: "contains matrix-rank reasoning",
    points: 5,
  },
  {
    pattern: /\beigenvalue\b/i,
    code: "math.eigenvalue",
    description: "contains eigenvalue reasoning",
    points: 5,
  },
  {
    pattern: /\beigenvector\b/i,
    code: "math.eigenvector",
    description: "contains eigenvector reasoning",
    points: 5,
  },
  {
    pattern: /\bgradient\b/i,
    code: "math.gradient",
    description: "contains gradient reasoning",
    points: 4,
  },
  {
    pattern: /\bderivative\b/i,
    code: "math.derivative",
    description: "contains derivative reasoning",
    points: 4,
  },
  {
    pattern: /\bconvergence\b/i,
    code: "math.convergence",
    description: "contains convergence claims",
    points: 6,
  },
  {
    pattern: /\bprobability\b/i,
    code: "math.probability",
    description: "contains probability reasoning",
    points: 4,
  },
  {
    pattern: /\btheorem\b/i,
    code: "math.theorem",
    description: "contains theorem claims",
    points: 7,
  },
  {
    pattern: /\bproof\b/i,
    code: "math.proof",
    description: "contains proof reasoning",
    points: 7,
  },
  {
    pattern: /∑|∏|∫|≤|≥|≠|∀|∃/u,
    code: "math.symbols",
    description: "contains formal mathematical notation",
    points: 4,
  },
];

const VERSION_PATTERNS: Array<{
  pattern: RegExp;
  code: string;
  description: string;
  points: number;
}> = [
  {
    pattern: /\bversion\b/i,
    code: "version.explicit",
    description: "explicitly discusses software version",
    points: 7,
  },
  {
    pattern: /\bv\d+\.\d+(?:\.\d+)?\b/i,
    code: "version.number",
    description: "contains a concrete version number",
    points: 7,
  },
  {
    pattern: /\bdeprecated\b/i,
    code: "version.deprecated",
    description: "contains deprecation behavior",
    points: 7,
  },
  {
    pattern: /\bdefault\b/i,
    code: "version.default",
    description: "makes a default-behavior claim",
    points: 5,
  },
  {
    pattern: /\bAPI\b/,
    code: "implementation.api",
    description: "contains an API behavior claim",
    points: 7,
  },
  {
    pattern: /\bSDK\b/i,
    code: "implementation.sdk",
    description: "contains an SDK behavior claim",
    points: 6,
  },
  {
    pattern: /\bframework\b/i,
    code: "implementation.framework",
    description: "contains framework behavior",
    points: 4,
  },
  {
    pattern: /\blibrary\b/i,
    code: "implementation.library",
    description: "contains library behavior",
    points: 4,
  },
  {
    pattern: /\bimplementation\b/i,
    code: "implementation.explicit",
    description: "contains implementation-specific behavior",
    points: 5,
  },
];

const QUANTITATIVE_PATTERNS: Array<{
  pattern: RegExp;
  code: string;
  description: string;
  points: number;
}> = [
  {
    pattern: /\b\d+(?:\.\d+)?\s*%/,
    code: "quant.percent",
    description: "contains explicit percentage claim",
    points: 5,
  },
  {
    pattern: /\b\d+(?:\.\d+)?\s*(?:ms|s|GB|MB|TB|M|B|million|billion)\b/i,
    code: "quant.number-with-unit",
    description: "contains quantitative technical claim",
    points: 6,
  },
  {
    pattern: /\b\d+(?:\.\d+)?x\b/i,
    code: "quant.multiplier",
    description: "contains multiplier claim",
    points: 6,
  },
  {
    pattern: /\b\d+(?:\.\d+)?\s*times?\b/i,
    code: "quant.times",
    description: "contains multiplier claim",
    points: 6,
  },
];

const EMPIRICAL_COMPARISON_PATTERNS: Array<{
  pattern: RegExp;
  code: string;
  description: string;
  points: number;
}> = [
  {
    pattern: /\bbetter than\b/i,
    code: "empirical.better-than",
    description: "contains comparative performance claim",
    points: 6,
  },
  {
    pattern: /\bworse than\b/i,
    code: "empirical.worse-than",
    description: "contains comparative performance claim",
    points: 6,
  },
  {
    pattern: /\bfaster than\b/i,
    code: "empirical.faster-than",
    description: "contains comparative latency/performance claim",
    points: 6,
  },
  {
    pattern: /\bslower than\b/i,
    code: "empirical.slower-than",
    description: "contains comparative performance claim",
    points: 6,
  },
  {
    pattern: /\bmore accurate than\b/i,
    code: "empirical.accuracy",
    description: "contains comparative accuracy claim",
    points: 6,
  },
  {
    pattern: /\bimproves?\b/i,
    code: "empirical.improves",
    description: "contains improvement claim",
    points: 3,
  },
  {
    pattern: /\breduces?\b/i,
    code: "empirical.reduces",
    description: "contains reduction claim",
    points: 3,
  },
];

const CAUSAL_PATTERNS: Array<{
  pattern: RegExp;
  code: string;
  description: string;
  points: number;
}> = [
  {
    pattern: /\bcauses?\b/i,
    code: "logic.causal",
    description: "contains explicit causal claim",
    points: 5,
  },
  {
    pattern: /\bleads? to\b/i,
    code: "logic.causal",
    description: "contains causal-direction claim",
    points: 5,
  },
  {
    pattern: /\bresults? in\b/i,
    code: "logic.causal",
    description: "contains causal-direction claim",
    points: 5,
  },
  {
    pattern: /\btherefore\b/i,
    code: "logic.inference",
    description: "contains explicit inference/conclusion",
    points: 3,
  },
  {
    pattern: /\bimplies\b/i,
    code: "logic.implication",
    description: "contains implication claim",
    points: 5,
  },
  {
    pattern: /\biff\b/i,
    code: "logic.iff",
    description: "contains equivalence claim",
    points: 7,
  },
  {
    pattern: /\bif and only if\b/i,
    code: "logic.iff",
    description: "contains equivalence claim",
    points: 7,
  },
  {
    pattern: /\bnecessary\b/i,
    code: "logic.necessary",
    description: "contains necessary-condition claim",
    points: 6,
  },
  {
    pattern: /\bsufficient\b/i,
    code: "logic.sufficient",
    description: "contains sufficient-condition claim",
    points: 6,
  },
];

const CURRENT_TECH_PATTERNS: Array<{
  pattern: RegExp;
  code: string;
  description: string;
  points: number;
}> = [
  {
    pattern: /\bcurrent\b/i,
    code: "current.explicit",
    description: "makes a current-state claim",
    points: 5,
  },
  {
    pattern: /\blatest\b/i,
    code: "current.latest",
    description: "makes a latest-state claim",
    points: 7,
  },
  {
    pattern: /\bcurrently\b/i,
    code: "current.currently",
    description: "makes a current-state claim",
    points: 5,
  },
  {
    pattern: /\bsupports?\b/i,
    code: "current.support",
    description: "contains a capability/support claim",
    points: 4,
  },
  {
    pattern: /\bavailable\b/i,
    code: "current.available",
    description: "contains an availability/capability claim",
    points: 4,
  },
];

const ALL_PATTERN_GROUPS = [
  ABSOLUTE_PATTERNS,
  MATHEMATICAL_PATTERNS,
  VERSION_PATTERNS,
  QUANTITATIVE_PATTERNS,
  EMPIRICAL_COMPARISON_PATTERNS,
  CAUSAL_PATTERNS,
  CURRENT_TECH_PATTERNS,
];

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);

  let output = DEFAULT_OUTPUT;
  let minRisk: RiskLevel = "low";
  let limit: number | undefined;
  let sample: number | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--output") {
      const value = args[i + 1];

      if (!value) {
        throw new Error("--output requires a path");
      }

      output = path.resolve(ROOT, value);
      i++;
      continue;
    }

    if (arg === "--min-risk") {
      const value = args[i + 1];

      if (value !== "low" && value !== "medium" && value !== "high") {
        throw new Error("--min-risk must be low, medium, or high");
      }

      minRisk = value;
      i++;
      continue;
    }

    if (arg === "--limit") {
      const value = args[i + 1];

      if (!value || !/^\d+$/.test(value)) {
        throw new Error("--limit must be a positive integer");
      }

      limit = Number(value);
      i++;
      continue;
    }

    if (arg === "--sample") {
      const value = args[i + 1];

      if (!value || !/^\d+$/.test(value)) {
        throw new Error("--sample must be a positive integer");
      }

      sample = Number(value);
      i++;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    output,
    minRisk,
    limit,
    sample,
  };
}

function printHelp(): void {
  console.log(`
Build correctness verification worklist.

Usage:
  node --experimental-strip-types scripts/verify-question-candidates.ts [options]

Options:
  --output <path>     Output JSONL path
  --min-risk <level>  low | medium | high
  --limit <n>         Maximum number of ranked candidates
  --sample <n>        Add n random calibration questions
  --help              Show help

Examples:
  node --experimental-strip-types scripts/verify-question-candidates.ts

  node --experimental-strip-types scripts/verify-question-candidates.ts \
    --min-risk medium --sample 50

  node --experimental-strip-types scripts/verify-question-candidates.ts \
    --min-risk high --limit 200
`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isQuestionLike(value: unknown): value is QuestionLike {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" && typeof value.question === "string"
  );
}

function loadQuestions(file: string): QuestionLike[] {
  const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));

  if (Array.isArray(parsed)) {
    return parsed.filter(isQuestionLike);
  }

  if (!isRecord(parsed)) {
    return [];
  }

  if (Array.isArray(parsed.questions)) {
    return parsed.questions.filter(isQuestionLike);
  }

  return isQuestionLike(parsed) ? [parsed] : [];
}

function collectQuestionFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const result: string[] = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name === "node_modules" ||
      entry.name.startsWith(".") ||
      entry.name === "archive"
    ) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      result.push(...collectQuestionFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".json")) {
      result.push(fullPath);
    }
  }

  return result;
}

function detectFormat(question: QuestionLike): QuestionFormat {
  const choice = question.formats?.choice;

  if (choice?.type === "single") {
    return "single";
  }

  if (choice?.type === "multiple") {
    return "multiple";
  }

  if (question.formats?.open) {
    return "open";
  }

  if (choice) {
    return "unknown";
  }

  return "open";
}

function toText(value: unknown): string {
  if (Array.isArray(value)) {
    return value.filter((v) => typeof v === "string").join(" ");
  }
  if (typeof value === "string") {
    return value;
  }
  return "";
}

function getFullText(question: QuestionLike): string {
  const choiceOptions = question.formats?.choice?.options;

  const options = Array.isArray(choiceOptions)
    ? choiceOptions.join("\n")
    : typeof choiceOptions === "string"
      ? choiceOptions
      : "";

  const referenceAnswer =
    question.formats?.open?.referenceAnswer ?? "";

  const coreConcepts = toText(question.concepts?.core);

  const supportingConcepts = toText(question.concepts?.supporting);

  const assessment = [
    question.assessment?.target ?? "",
    question.assessment?.reasoningGoal ?? "",
  ].join(" ");

  return [
    question.question ?? "",
    options,
    question.explanation ?? "",
    referenceAnswer,
    coreConcepts,
    supportingConcepts,
    assessment,
  ]
    .filter(Boolean)
    .join("\n");
}

function countMatches(
  text: string,
  patterns: Array<{
    pattern: RegExp;
    code: string;
    description: string;
    points: number;
  }>,
): EvidenceSignal[] {
  const matches: EvidenceSignal[] = [];

  for (const item of patterns) {
    if (!item.pattern.test(text)) {
      continue;
    }

    matches.push({
      code: item.code,
      description: item.description,
      points: item.points,
    });
  }

  return matches;
}

function hasAnyCode(
  signals: EvidenceSignal[],
  prefix: string,
): boolean {
  return signals.some((signal) => signal.code.startsWith(prefix));
}

function addCompoundSignals(
  text: string,
  signals: EvidenceSignal[],
): void {
  const hasAbsolute = hasAnyCode(signals, "absolute.");
  const hasQuantitative = hasAnyCode(signals, "quant.");
  const hasEmpirical = hasAnyCode(signals, "empirical.");
  const hasVersion = hasAnyCode(signals, "version.");
  const hasImplementation = hasAnyCode(signals, "implementation.");
  const hasLogic = hasAnyCode(signals, "logic.");
  const hasMath = hasAnyCode(signals, "math.");
  const hasCurrent = hasAnyCode(signals, "current.");

  /**
   * The important part of this scoring system is composition.
   *
   * "RAG" or "hard" alone gives zero points.
   * "always" alone gives some points.
   * "always" + quantitative/empirical/model/API behavior is materially
   * riskier because it represents a strong claim with a specific technical
   * consequence.
   */
  if (
    hasAbsolute &&
    (hasEmpirical || hasQuantitative || hasVersion || hasImplementation || hasCurrent)
  ) {
    signals.push({
      code: "compound.absolute-technical",
      description:
        "absolute claim combined with empirical/current/implementation claim",
      points: 7,
    });
  }

  if (hasMath && (hasAbsolute || hasLogic || hasQuantitative)) {
    signals.push({
      code: "compound.math-strong-claim",
      description:
        "non-trivial mathematical claim combined with strong logical or quantitative wording",
      points: 6,
    });
  }

  if (hasVersion && (hasAbsolute || hasCurrent || hasQuantitative)) {
    signals.push({
      code: "compound.version-strong-claim",
      description:
        "version-sensitive behavior combined with strong/current/quantitative wording",
      points: 7,
    });
  }

  if (hasEmpirical && (hasAbsolute || hasQuantitative || hasCurrent)) {
    signals.push({
      code: "compound.empirical-strong-claim",
      description:
        "empirical comparison combined with strong, quantitative, or current-state wording",
      points: 6,
    });
  }

  /**
   * Explicitly avoid generic domain scoring.
   *
   * These are intentionally no-op:
   * * category == AI
   * * topic contains LLM/RAG/agent
   * * difficulty == hard
   *
   * They should never increase correctness risk by themselves.
   */
  void text;
}

function detectSemanticContradictionSignals(
  question: QuestionLike,
  text: string,
): EvidenceSignal[] {
  const signals: EvidenceSignal[] = [];

  const choice = question.formats?.choice;

  if (!choice) {
    return signals;
  }

  const answer = choice.answer ?? [];

  if (!answer.length) {
    return signals;
  }

  const explanation = question.explanation ?? "";

  if (!explanation) {
    return signals;
  }

  /**
   * This is deliberately conservative.
   *
   * We only flag explicit option-number / option-letter references when
   * they contradict the stored key. We do not attempt full natural-language
   * semantic interpretation here.
   */
  const answerLetters = answer
    .map((index) => String.fromCharCode(65 + index))
    .map((letter) => letter.toUpperCase());

  const wrongLetterMatches = explanation.match(
    /\b(?:option|choice|answer)\s*([A-Z])\b/gi,
  );

  if (wrongLetterMatches?.length) {
    const referencedLetters = wrongLetterMatches
      .map((value) => {
        const match = value.match(/\b([A-Z])\b$/i);
        return match?.[1]?.toUpperCase() ?? null;
      })
      .filter((value): value is string => value !== null);

    const hasExplicitNonAnswerReference = referencedLetters.some(
      (letter) => !answerLetters.includes(letter),
    );

    if (hasExplicitNonAnswerReference) {
      signals.push({
        code: "consistency.explanation-option-mismatch",
        description:
          "explanation explicitly references an option outside the stored answer set",
        points: 12,
      });
    }
  }

  /**
   * A conservative contradiction pattern:
   * "X is correct" / "X is the correct answer".
   *
   * Only add a signal when the explicit option letter disagrees with the key.
   */
  const correctPatterns = [
    /\b([A-D])\s+is\s+(?:the\s+)?correct\b/i,
    /\b([A-D])\s+is\s+correct\b/i,
    /\bcorrect\s+(?:answer|option)\s*(?:is|:)\s*([A-D])\b/i,
  ];

  for (const pattern of correctPatterns) {
    const match = explanation.match(pattern);

    if (!match) {
      continue;
    }

    const statedLetter = match[1]?.toUpperCase();

    if (statedLetter && !answerLetters.includes(statedLetter)) {
      signals.push({
        code: "consistency.explicit-correctness-conflict",
        description:
          "explanation explicitly names a correct option that conflicts with stored answer",
        points: 18,
      });

      break;
    }
  }

  void text;

  return signals;
}

function buildCandidate(
  question: QuestionLike,
  file: string,
): Candidate | null {
  if (!question.id || !question.question) {
    return null;
  }

  const text = getFullText(question);

  const signals: EvidenceSignal[] = [];

  for (const group of ALL_PATTERN_GROUPS) {
    signals.push(...countMatches(text, group));
  }

  addCompoundSignals(text, signals);

  signals.push(...detectSemanticContradictionSignals(question, text));

  /**
   * Collapse duplicate codes while keeping the highest score for the code.
   */
  const byCode = new Map<string, EvidenceSignal>();

  for (const signal of signals) {
    const existing = byCode.get(signal.code);

    if (!existing || signal.points > existing.points) {
      byCode.set(signal.code, signal);
    }
  }

  const uniqueSignals = [...byCode.values()];

  if (!uniqueSignals.length) {
    return null;
  }

  const riskScore = uniqueSignals.reduce(
    (sum, signal) => sum + signal.points,
    0,
  );

  /**
   * Explicit thresholds intentionally leave room below HIGH.
   *
   * Verification priority does not mean "question severity".
   * It means verification urgency.
   */
  let riskLevel: RiskLevel;

  if (riskScore >= 18) {
    riskLevel = "high";
  } else if (riskScore >= 9) {
    riskLevel = "medium";
  } else {
    riskLevel = "low";
  }

  /**
   * Map the risk level to a review queue label.
   *
   * IMPORTANT:
   * HIGH here means "verify this first", not "confirmed defect".
   * Defect severity (P0/P1/P2) is decided later by the
   * verify-question-correctness skill, never by this scanner.
   */
  let verificationPriority: VerificationPriority;

  if (riskLevel === "high") {
    verificationPriority = "HIGH";
  } else if (riskLevel === "medium") {
    verificationPriority = "MEDIUM";
  } else {
    verificationPriority = "LOW";
  }

  return {
    id: question.id,
    file: path.relative(ROOT, file),
    format: detectFormat(question),
    riskScore,
    riskLevel,
    verificationPriority,
    reasons: uniqueSignals.map((signal) => signal.description),
    signals: uniqueSignals.map((signal) => signal.code),
    metadata: {
      category: question.category,
      topic: question.topic,
      difficulty: question.difficulty,
      angle: question.angle,
      cognitiveTask: question.cognitiveTask,
    },
  };
}

function getRiskMinimum(level: RiskLevel): number {
  switch (level) {
    case "high":
      return 18;
    case "medium":
      return 9;
    case "low":
      return 1;
  }
}

function randomSample<T>(items: T[], count: number): T[] {
  if (count <= 0 || items.length === 0) {
    return [];
  }

  const copy = [...items];

  /**
   * Fisher-Yates shuffle.
   */
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy.slice(0, Math.min(count, copy.length));
}

function readAllQuestions(): Array<{
  question: QuestionLike;
  file: string;
}> {
  if (!fs.existsSync(QUESTION_ROOT)) {
    throw new Error(
      `Question directory does not exist: ${QUESTION_ROOT}`,
    );
  }

  const files = collectQuestionFiles(QUESTION_ROOT).sort();

  const results: Array<{
    question: QuestionLike;
    file: string;
  }> = [];

  for (const file of files) {
    let questions: QuestionLike[];

    try {
      questions = loadQuestions(file);
    } catch (error) {
      console.warn(
        `[warn] failed to parse ${path.relative(ROOT, file)}:`,
        error,
      );
      continue;
    }

    for (const question of questions) {
      results.push({
        question,
        file,
      });
    }
  }

  return results;
}

function main(): void {
  const args = parseArgs();

  const allQuestions = readAllQuestions();

  const candidates: Candidate[] = [];

  for (const item of allQuestions) {
    const candidate = buildCandidate(item.question, item.file);

    if (!candidate) {
      continue;
    }

    if (candidate.riskScore < getRiskMinimum(args.minRisk)) {
      continue;
    }

    candidates.push(candidate);
  }

  candidates.sort((a, b) => {
    if (b.riskScore !== a.riskScore) {
      return b.riskScore - a.riskScore;
    }

    if (a.verificationPriority !== b.verificationPriority) {
      return a.verificationPriority.localeCompare(b.verificationPriority);
    }

    return a.id.localeCompare(b.id);
  });

  const selectedCandidates =
    typeof args.limit === "number"
      ? candidates.slice(0, args.limit)
      : candidates;

  /**
   * Calibration sample:
   *
   * This is intentionally sampled from all questions that are NOT already
   * in the ranked worklist. It prevents the triage system from becoming a
   * closed-world detector that never evaluates its own blind spots.
   */
  const selectedIds = new Set(
    selectedCandidates.map((candidate) => candidate.id),
  );

  let calibration: Candidate[] = [];

  if (args.sample && args.sample > 0) {
    const unselected = allQuestions.filter(
      (item) => item.question.id && !selectedIds.has(item.question.id),
    );

    calibration = randomSample(unselected, args.sample).map((item) => ({
      id: item.question.id!,
      file: path.relative(ROOT, item.file),
      format: detectFormat(item.question),
      riskScore: 0,
      riskLevel: "low",
      verificationPriority: "LOW",
      reasons: ["random calibration sample"],
      signals: ["calibration.random-sample"],
      metadata: {
        category: item.question.category,
        topic: item.question.topic,
        difficulty: item.question.difficulty,
        angle: item.question.angle,
        cognitiveTask: item.question.cognitiveTask,
      },
    }));
  }

  const finalItems = [...selectedCandidates, ...calibration];

  fs.mkdirSync(path.dirname(args.output), { recursive: true });

  fs.writeFileSync(
    args.output,
    finalItems
      .map((item) => JSON.stringify(item))
      .join("\n") + (finalItems.length ? "\n" : ""),
    "utf8",
  );

  const high = selectedCandidates.filter(
    (candidate) => candidate.riskLevel === "high",
  ).length;

  const medium = selectedCandidates.filter(
    (candidate) => candidate.riskLevel === "medium",
  ).length;

  const low = selectedCandidates.filter(
    (candidate) => candidate.riskLevel === "low",
  ).length;

  const contradictionCount = selectedCandidates.filter((candidate) =>
    candidate.signals.some((signal) => signal.startsWith("consistency.")),
  ).length;

  console.log("");
  console.log("Question Correctness Risk Triage");
  console.log("================================");
  console.log(
    `Question files: ${new Set(allQuestions.map((item) => item.file)).size}`,
  );
  console.log(`Questions scanned: ${allQuestions.length}`);
  console.log(`Ranked candidates: ${selectedCandidates.length}`);
  console.log(`  high: ${high}`);
  console.log(`  medium: ${medium}`);
  console.log(`  low: ${low}`);
  console.log(`Semantic contradiction signals: ${contradictionCount}`);
  console.log(`Calibration sample: ${calibration.length}`);
  console.log(`Total output rows: ${finalItems.length}`);
  console.log(`Output: ${path.relative(ROOT, args.output)}`);
  console.log("");
  console.log(
    "NOTE: verificationPriority (HIGH/MEDIUM/LOW) is triage urgency only.",
  );
  console.log("It is NOT a correctness verdict and NOT a severity rating.");
  console.log(
    "Severity (P0/P1/P2) is assigned later by verify-question-correctness.",
  );
  console.log(
    "The worklist must be processed by the verify-question-correctness skill.",
  );
  console.log("");
}

main();
