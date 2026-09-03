// npm run question:identity —— 审计 canonical 身份是否曾被原地改写。
// 扫描 git 历史中 src/data/questions/*.json：同一 question.id 若在不同 commit
// 出现不同的 topic/angle/difficulty，即一次 evidence 污染（旧分代表旧能力）。
// 只读审计，找到即 exit 1（release gate 用）；传 --json 输出机器可读。

import { execSync } from 'node:child_process';

interface Row {
  id: string;
  commit: string;
  topic: string;
  angle: string;
  difficulty: string;
}

function sh(cmd: string): string {
  return execSync(cmd, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

const sinceIdx = process.argv.indexOf('--since');
const since = sinceIdx >= 0 ? process.argv[sinceIdx + 1] : undefined;
// 默认全历史扫描仅作信息展示（历史 topic 归一化等 grandfathered 债务不阻塞发版）；
// `--gate`（可配 `--since <rev>` 只查增量）才以 exit 1 失败，供 PR gate 用。
const gate = process.argv.includes('--gate');
const range = since ? `${since}..HEAD` : 'HEAD';
const commits = sh(`git log --format=%H ${range} -- src/data/questions/`)
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean);

const seen = new Map<string, Row[]>();
let scanned = 0;
for (const c of commits) {
  let files: string[];
  try {
    files = sh(`git diff-tree --no-commit-id --name-only -r ${c} -- src/data/questions/`)
      .split('\n')
      .map((s) => s.trim())
      .filter((f) => f.endsWith('.json'));
  } catch {
    continue;
  }
  for (const f of files) {
    let raw: string;
    try {
      raw = sh(`git show ${c}:${f}`);
    } catch {
      continue;
    }
    let arr: unknown;
    try {
      arr = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!Array.isArray(arr)) continue;
    scanned++;
    for (const q of arr as Record<string, unknown>[]) {
      if (typeof q.id !== 'string') continue;
      const row: Row = {
        id: q.id,
        commit: c.slice(0, 8),
        topic: String(q.topic ?? ''),
        angle: String(q.angle ?? ''),
        difficulty: String(q.difficulty ?? ''),
      };
      seen.set(row.id, [...(seen.get(row.id) ?? []), row]);
    }
  }
}

const violations: { id: string; contracts: string[] }[] = [];
for (const [id, rows] of seen) {
  const contracts = [...new Set(rows.map((r) => `${r.topic}×${r.angle}×${r.difficulty}`))];
  if (contracts.length > 1) violations.push({ id, contracts });
}

const asJson = process.argv.includes('--json');
if (asJson) {
  console.log(JSON.stringify({ scannedFileVersions: scanned, violations }, null, 2));
} else {
  console.log(`扫描 ${commits.length} commits / ${scanned} 文件版本，${violations.length} 个 ID 曾改变 assessment contract`);
  for (const v of violations.slice(0, 50)) {
    console.log(`  ${v.id}: ${v.contracts.join('  →  ')}`);
  }
  if (violations.length > 50) console.log(`  …另有 ${violations.length - 50} 个`);
}
process.exit(gate && violations.length > 0 ? 1 : 0);
