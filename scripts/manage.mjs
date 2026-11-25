import { spawnSync } from "node:child_process";

const tasks = {
  coverage: ["node", "scripts/question-coverage.ts"],
  blueprint: ["node", "scripts/question-blueprint.ts"],
  "question-audit": ["python", "analysis/question_audit.py"],
  analysis: ["uv", "run", "--project", "analysis", "--extra", "analysis", "python", "analysis/question_analysis.py"],
  add: ["node", "scripts/add-question.ts"],
  convert: ["node", "scripts/convert-blueprint-output.ts"],
  review: ["node", "scripts/review-question.ts"],
  curate: ["python", "analysis/question_curate.py"],
  "curate-semantic": ["sh", "-c", "uv run --project analysis --extra analysis python analysis/question_analysis.py --semantic --json > analysis/curation-semantic-report.json && python analysis/question_curate.py --semantic-report analysis/curation-semantic-report.json"],
  validate: ["node", "scripts/validate-questions.ts"],
  identity: ["node", "scripts/check-question-identity.ts"],
  quality: ["node", "scripts/audit-question-quality.ts"],
  integrity: ["node", "scripts/audit-bank-integrity.ts"],
  challenge: ["vite-node", "scripts/challenge-questions.ts"],
  variants: ["vite-node", "scripts/question-variants.ts"],
  "validate-variants": ["vite-node", "scripts/validate-variants.ts"],
  "lint-bias": ["node", "scripts/lint-bias.ts"],
  "lint-length": ["node", "scripts/lint-length.ts"],
  "fix-bias": ["node", "scripts/fix-bias.ts"],
  "backfill-misconceptions": ["node", "scripts/backfill-misconceptions.ts"],
  misconceptions: ["node", "scripts/misconception-coverage.ts"],
  "misconceptions-manual": ["node", "scripts/misconception-manual.ts"],
  assessment: ["node", "scripts/backfill-assessment.ts"],
  "cognitive-task": ["node", "scripts/backfill-cognitive-task.ts"],
  "variant-rehash": ["node", "scripts/refresh-variant-hash.ts"],
  "verify-candidates": ["node", "--experimental-strip-types", "scripts/verify-question-candidates.ts"],
  "refresh-node-index": ["node", "scripts/refresh-prompt-node-index.ts"],
  "knowledge-coverage": ["vite-node", "scripts/audit-knowledge-question-coverage.ts"],
};

const audits = [
  "validate", "identity", "quality", "integrity",
  "lint-bias", "lint-length", "misconceptions", "coverage", "knowledge-coverage",
];

const [action, ...args] = process.argv.slice(2);

function run(command, extraArgs = []) {
  const [bin, ...baseArgs] = command;
  const result = spawnSync(bin, [...baseArgs, ...extraArgs], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (action === "audit") {
  for (const name of audits) run(tasks[name]);
} else if (action === "list" || !action) {
  console.log("Content tasks:");
  for (const name of Object.keys(tasks)) console.log(`  ${name}`);
  console.log("\nUsage: npm run content -- <task> [args...]");
  console.log("       npm run content -- analysis --semantic --json");
  console.log("       npm run content -- audit");
} else if (action === "deploy") {
  if (args[0] === "pages") {
    run(["npm", "run", "build"]);
    run(["wrangler", "pages", "deploy", "dist", "--project-name", "ai-interview-questions"]);
  } else {
    run(["wrangler", "deploy"]);
  }
} else {
  const command = tasks[action];
  if (!command) {
    console.error(`Unknown task: ${action}. Run "npm run content" to list tasks.`);
    process.exit(2);
  }
  run(command, args);
}
