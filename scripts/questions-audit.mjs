import { spawnSync } from "node:child_process";

const checks = [
  ["Question audit", ["python", "analysis/question_audit.py"]],
  ["Schema validation", ["node", "scripts/validate-questions.ts"]],
  ["Question identity", ["node", "scripts/check-question-identity.ts"]],
  ["Question quality", ["node", "scripts/audit-question-quality.ts"]],
  ["Bank integrity", ["node", "scripts/audit-bank-integrity.ts"]],
  ["Bias lint", ["node", "scripts/lint-bias.ts"]],
  ["Length lint", ["node", "scripts/lint-length.ts"]],
  ["Misconception coverage", ["node", "scripts/misconception-coverage.ts"]],
  ["Question coverage", ["node", "scripts/question-coverage.ts"]],
  ["Knowledge coverage", ["vite-node", "scripts/audit-knowledge-question-coverage.ts"]],
];

for (const [label, command] of checks) {
  console.log(`\n▶ ${label}`);
  const [bin, ...args] = command;
  const result = spawnSync(bin, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log("\nQuestion bank audit passed.");
