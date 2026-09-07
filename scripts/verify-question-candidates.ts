#!/usr/bin/env npx tsx

/**
 * Build a correctness-verification worklist for the question bank.
 *
 * This script intentionally does NOT decide whether a question is correct.
 * It performs deterministic risk detection and emits candidates for the
 * verify-question-correctness Agent Skill.
 *
 * Usage:
 *
 *   npx tsx scripts/verify-question-candidates.ts
 *
 *   npx tsx scripts/verify-question-candidates.ts \
 *     --output reports/question-correctness-worklist.jsonl
 *
 *   npx tsx scripts/verify-question-candidates.ts \
 *     --min-risk high
 */

import fs from "node:fs";
import path from "node:path";

type QuestionFormat = "single" | "multiple" | "open";

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
  formats?: {
    choice?: {
      type?: "single" | "multiple";
      options?: string[];
      answer?: number[];
    };
    open?: {
      referenceAnswer?: string;
    };
  };
}

interface Candidate {
  id: string;
  file: string;
  format: QuestionFormat;
  riskScore: number;
  priority: "P0" | "P1" | "P2";
  reasons: string[];
  metadata: {
    category?: string;
    topic?: string;
    difficulty?: string;
    angle?: string;
    cognitiveTask?: string;
  };
}

const ROOT = process.cwd();

const DEFAULT_QUESTION_DIRS = [
  path.join(ROOT, "src/data/questions"),
  path.join(ROOT, "src/data"),
];

const ABSOLUTE_PATTERNS: RegExp[] = [
  /\balways\b/i,
  /\bnever\b/i,
  /\bguarantee(?:s|d)?\b/i,
  /\bmust\b/i,
  /\bcannot\b/i,
  /\bonly\b/i,
  /\bexactly\b/i,
  /\bbest\b/i,
  /\boptimal\b/i,
  /\bequivalent\b/i,
  /\bnecessarily\b/i,
  /\bfor all\b/i,
  /\bin every case\b/i,
  /\beliminat(?:e|es|ed)\b/i,
  /\bprevent(?:s|ed)?\b/i,
];

const MATH_PATTERNS: RegExp[] = [
  /\bO\([^)]+\)/,
  /\bTheta\([^)]+\)/i,
  /\bΩ\([^)]+\)/,
  /\brank\b/i,
  /\beigenvalue\b/i,
  /\beigenvector\b/i,
  /\bgradient\b/i,
  /\bderivative\b/i,
  /\bconvergence\b/i,
  /\bprobability\b/i,
  /\bvariance\b/i,
  /\bexpectation\b/i,
  /\bentropy\b/i,
  /\bKL\b/i,
  /\bdivergence\b/i,
  /\bmatrix\b/i,
  /\btheorem\b/i,
  /\bproof\b/i,
  /\\[a-zA-Z]+/,
  /\^2/,
  /∑|∏|∫|≤|≥|≠|∀|∃/,
];

const VERSION_PATTERNS: RegExp[] = [
  /\bversion\b/i,
  /\bv\d+\.\d+(?:\.\d+)?\b/i,
  /\bdefault\b/i,
  /\bdeprecated\b/i,
  /\bAPI\b/,
  /\bSDK\b/i,
  /\bframework\b/i,
  /\blibrary\b/i,
  /\bPyTorch\b/i,
  /\bTensorFlow\b/i,
  /\bLangChain\b/i,
  /\bLangGraph\b/i,
  /\bOpenAI\b/i,
  /\bAnthropic\b/i,
  /\bGemini\b/i,
  /\bDeepSeek\b/i,
  /\bMCP\b/,
];

const QUANTITATIVE_PATTERNS: RegExp[] = [
  /\b\d+(?:\.\d+)?\s*%/,
  /\b\d+(?:\.\d+)?\s*(?:ms|s|GB|MB|TB|M|B|million|billion)\b/i,
  /\b\d+(?:\.\d+)?x\b/i,
  /\b\d+(?:\.\d+)?\s*times?\b/i,
];

const AI_CLAIM_PATTERNS: RegExp[] = [
  /\bRAG\b/i,
  /\bLoRA\b/i,
  /\bQLoRA\b/i,
  /\bRLHF\b/i,
  /\bDPO\b/i,
  /\bKV cache\b/i,
  /\battention\b/i,
  /\bTransformer\b/i,
  /\bagent\b/i,
  /\btool calling\b/i,
  /\bfunction calling\b/i,
  /\breasoning\b/i,
  /\bchain[- ]of[- ]thought\b/i,
  /\bhallucination\b/i,
  /\bembedding\b/i,
  /\bquantization\b/i,
];

function parseArgs() {
  const args = process.argv.slice(2);

  let output = path.join(
    ROOT,
    "reports/question-correctness-worklist.jsonl",
  );

  let minRisk: "low" | "medium" | "high" = "low";

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
  }

  return {
    output,
    minRisk,
  };
}

function collectJsonFiles(dir: string): string[] {
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
      result.push(...collectJsonFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".json")) {
      result.push(fullPath);
    }
  }

  return result;
}

function loadQuestions(file: string): QuestionLike[] {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));

  if (Array.isArray(raw)) {
    return raw.filter(isQuestionLike);
  }

  if (raw && typeof raw === "object") {
    if (Array.isArray(raw.questions)) {
      return raw.questions.filter(isQuestionLike);
    }

    if (isQuestionLike(raw)) {
      return [raw];
    }
  }

  return [];
}

function isQuestionLike(value: unknown): value is QuestionLike {
  if (!value || typeof value !== "object") {
    return false;
  }

  const q = value as Record<string, unknown>;

  return typeof q.id === "string" && typeof q.question === "string";
}

function detectFormat(question: QuestionLike): QuestionFormat {
  if (question.formats?.choice) {
    return question.formats.choice.type === "multiple"
      ? "multiple"
      : "single";
  }

  return "open";
}

function getQuestionText(question: QuestionLike): string {
  const optionText =
    question.formats?.choice?.options?.join("\n") ?? "";

  const referenceAnswer =
    question.formats?.open?.referenceAnswer ?? "";

  return [
    question.question ?? "",
    optionText,
    question.explanation ?? "",
    referenceAnswer,
  ].join("\n");
}

function addReason(
  reasons: string[],
  score: { value: number },
  message: string,
  points: number,
) {
  reasons.push(message);
  score.value += points;
}

function inspectQuestion(
  question: QuestionLike,
  file: string,
): Candidate | null {
  if (!question.id || !question.question) {
    return null;
  }

  const text = getQuestionText(question);

  const reasons: string[] = [];
  const score = { value: 0 };

  if (ABSOLUTE_PATTERNS.some((pattern) => pattern.test(text))) {
    addReason(
      reasons,
      score,
      "contains universal/absolute wording",
      5,
    );
  }

  if (MATH_PATTERNS.some((pattern) => pattern.test(text))) {
    addReason(
      reasons,
      score,
      "contains mathematical/theoretical claims",
      6,
    );
  }

  if (VERSION_PATTERNS.some((pattern) => pattern.test(text))) {
    addReason(
      reasons,
      score,
      "contains version/API/implementation-sensitive claims",
      6,
    );
  }

  if (QUANTITATIVE_PATTERNS.some((pattern) => pattern.test(text))) {
    addReason(
      reasons,
      score,
      "contains quantitative/performance claims",
      5,
    );
  }

  if (AI_CLAIM_PATTERNS.some((pattern) => pattern.test(text))) {
    addReason(
      reasons,
      score,
      "contains AI/ML/LLM implementation or behavior claims",
      4,
    );
  }

  if (
    question.formats?.choice?.type === "single" &&
    (question.formats.choice.answer?.length ?? 0) !== 1
  ) {
    addReason(
      reasons,
      score,
      "single-choice answer cardinality requires verification",
      20,
    );
  }

  if (
    question.formats?.choice &&
    question.formats.choice.answer &&
    question.formats.choice.options &&
    question.formats.choice.answer.some(
      (index) =>
        index < 0 ||
        index >= question.formats!.choice!.options!.length,
    )
  ) {
    addReason(
      reasons,
      score,
      "answer index is structurally invalid",
      30,
    );
  }

  if (!question.explanation?.trim()) {
    addReason(
      reasons,
      score,
      "missing explanation/reference explanation",
      3,
    );
  }

  if (
    question.difficulty === "hard" ||
    question.difficulty === "expert"
  ) {
    addReason(
      reasons,
      score,
      "high-difficulty question",
      3,
    );
  }

  if (score.value === 0) {
    return null;
  }

  let priority: Candidate["priority"];

  if (score.value >= 15) {
    priority = "P0";
  } else if (score.value >= 8) {
    priority = "P1";
  } else {
    priority = "P2";
  }

  const relativeFile = path.relative(ROOT, file);

  return {
    id: question.id,
    file: relativeFile,
    format: detectFormat(question),
    riskScore: score.value,
    priority,
    reasons,
    metadata: {
      category: question.category,
      topic: question.topic,
      difficulty: question.difficulty,
      angle: question.angle,
      cognitiveTask: question.cognitiveTask,
    },
  };
}

function minimumScore(
  minRisk: "low" | "medium" | "high",
): number {
  switch (minRisk) {
    case "high":
      return 15;
    case "medium":
      return 8;
    case "low":
    default:
      return 1;
  }
}

function main() {
  const { output, minRisk } = parseArgs();

  const jsonFiles = Array.from(
    new Set(DEFAULT_QUESTION_DIRS.flatMap(collectJsonFiles)),
  ).sort();

  const candidates: Candidate[] = [];

  let questionCount = 0;

  for (const file of jsonFiles) {
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
      questionCount++;

      const candidate = inspectQuestion(question, file);

      if (!candidate) {
        continue;
      }

      if (candidate.riskScore < minimumScore(minRisk)) {
        continue;
      }

      candidates.push(candidate);
    }
  }

  candidates.sort((a, b) => {
    if (b.riskScore !== a.riskScore) {
      return b.riskScore - a.riskScore;
    }

    return a.id.localeCompare(b.id);
  });

  fs.mkdirSync(path.dirname(output), { recursive: true });

  fs.writeFileSync(
    output,
    candidates.map((candidate) => JSON.stringify(candidate)).join("\n") +
      (candidates.length ? "\n" : ""),
    "utf8",
  );

  const p0 = candidates.filter((c) => c.priority === "P0").length;
  const p1 = candidates.filter((c) => c.priority === "P1").length;
  const p2 = candidates.filter((c) => c.priority === "P2").length;

  console.log("");
  console.log("Question Correctness Verification Worklist");
  console.log("------------------------------------------");
  console.log(`Question files: ${jsonFiles.length}`);
  console.log(`Questions scanned: ${questionCount}`);
  console.log(`Candidates: ${candidates.length}`);
  console.log(`P0 candidates: ${p0}`);
  console.log(`P1 candidates: ${p1}`);
  console.log(`P2 candidates: ${p2}`);
  console.log(`Output: ${path.relative(ROOT, output)}`);
  console.log("");
}

main();
