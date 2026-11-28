import { spawnSync } from "node:child_process";

const tasks = {
  coverage: ["node", "scripts/question-coverage.ts"],
  validate: ["node", "scripts/validate-questions.ts"],
  identity: ["node", "scripts/check-question-identity.ts"],
  quality: ["node", "scripts/audit-question-quality.ts"],
  integrity: ["node", "scripts/audit-bank-integrity.ts"],
  "lint-bias": ["node", "scripts/lint-bias.ts"],
  "lint-length": ["node", "scripts/lint-length.ts"],
  add: ["node", "scripts/add-question.ts"],
  review: ["node", "scripts/review-question.ts"],
  blueprint: ["node", "scripts/question-blueprint.ts"],
  convert: ["node", "scripts/convert-blueprint-output.ts"],
  curate: ["python", "analysis/question_curate.py"],
  "curate-semantic": ["sh", "-c", "uv run --project analysis --extra analysis python analysis/question_analysis.py --semantic --json > analysis/curation-semantic-report.json && python analysis/question_curate.py --semantic-report analysis/curation-semantic-report.json"],
  challenge: ["vite-node", "scripts/challenge-questions.ts"],
  variants: ["vite-node", "scripts/question-variants.ts"],
  "validate-variants": ["vite-node", "scripts/validate-variants.ts"],
  "fix-bias": ["node", "scripts/fix-bias.ts"],
  "backfill-misconceptions": ["node", "scripts/backfill-misconceptions.ts"],
  "misconceptions-manual": ["node", "scripts/misconception-manual.ts"],
  assessment: ["node", "scripts/backfill-assessment.ts"],
  "cognitive-task": ["node", "scripts/backfill-cognitive-task.ts"],
  "variant-rehash": ["node", "scripts/refresh-variant-hash.ts"],
  "verify-candidates": ["node", "--experimental-strip-types", "scripts/verify-question-candidates.ts"],
  verify: ["node", "--experimental-strip-types", "scripts/verify-question-correctness.ts"],
  "refresh-node-index": ["node", "scripts/refresh-prompt-node-index.ts"],
};

const [action, ...args] = process.argv.slice(2);
if (!action || action === "help" || action === "--help") {
  console.log("Usage: npm run questions:manage -- <task> [args...]\n");
  console.log(Object.keys(tasks).join("\n"));
  process.exit(0);
}

const command = tasks[action];
if (!command) {
  console.error(`Unknown task: ${action}. Run "npm run questions:manage" to list tasks.`);
  process.exit(2);
}

const [bin, ...baseArgs] = command;
const result = spawnSync(bin, [...baseArgs, ...args], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
