// 复验：用**真实 domain 模块**（不是探测脚本里的副本）跑全池，确认门禁的拦脏/误杀。
// 同时对 1300+ 道 canonical 做精度验证——人工/已有流程产出的好内容不该被拦。
import fs from 'node:fs';
import path from 'node:path';
import { checkLanguageSanity, formatSanityIssues } from '../src/domain/languageSanity';
import type { Question } from '../src/schemas/question';

const ROOT = process.cwd();
const qDir = path.join(ROOT, 'src/data/questions');
const vDir = path.join(ROOT, 'src/data/variants');

const questions: Question[] = [];
for (const f of fs.readdirSync(qDir)) {
  if (!f.endsWith('.json')) continue;
  const arr = JSON.parse(fs.readFileSync(path.join(qDir, f), 'utf8'));
  questions.push(...(Array.isArray(arr) ? arr : arr.questions ?? []));
}
const byId = new Map(questions.map((q) => [q.id, q]));

const pct = (n: number, d: number) => ((n / d) * 100).toFixed(1) + '%';

// ── 1. 精度验证：canonical 自查（好内容不该被拦）──
console.log('══ 1. 精度验证：1300+ 道 canonical 自查 ══');
let canonFlagged = 0;
const canonFlags = new Map<string, number>();
for (const q of questions) {
  const r = checkLanguageSanity(
    { stem: q.question, options: q.formats?.choice?.options },
    { stem: q.question, options: q.formats?.choice?.options },
  );
  if (!r.ok) {
    canonFlagged++;
    if (canonFlagged <= 8) console.log(`  ✗ ${q.id}: ${formatSanityIssues(r)}`);
    for (const c of r.blockCodes) canonFlags.set(c, (canonFlags.get(c) ?? 0) + 1);
  }
}
console.log(`  被拦：${canonFlagged}/${questions.length}（${pct(canonFlagged, questions.length)}）`);
for (const [c, n] of [...canonFlags.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${c}: ${n}`);

// ── 2. 变体池：拦脏 / 误杀 ──
console.log('\n══ 2. 变体池 ══');
const rows: Array<{ file: string; kind: string; id: string; ok: boolean; detail: string; warn: string[] }> = [];
for (const f of fs.readdirSync(vDir)) {
  if (!f.endsWith('.json')) continue;
  const pool = JSON.parse(fs.readFileSync(path.join(vDir, f), 'utf8'));
  for (const [qid, list] of Object.entries(pool.variants ?? {}) as Array<[string, any[]]>) {
    const canon = byId.get(qid);
    if (!canon) continue;
    for (const v of list) {
      const r = checkLanguageSanity(
        { stem: v.question, options: v.options },
        { stem: canon.question, options: canon.formats?.choice?.options },
      );
      rows.push({ file: f, kind: v.kind, id: v.id, ok: r.ok, detail: r.ok ? '' : formatSanityIssues(r), warn: r.warnCodes });
    }
  }
}
const dirty = rows.filter((r) => r.file.startsWith('evaluation.') && r.kind === 'context-options');
const clean = rows.filter((r) => !(r.file.startsWith('evaluation.') && r.kind === 'context-options'));
const dBlocked = dirty.filter((r) => !r.ok).length;
const cBlocked = clean.filter((r) => !r.ok).length;
console.log(`  脏（evaluation/context-options）n=${dirty.length} → 拦 ${dBlocked}（${pct(dBlocked, dirty.length)}）`);
console.log(`  干净 n=${clean.length} → 误杀 ${cBlocked}（${pct(cBlocked, clean.length)}）`);
console.log(`  全池合计 ${rows.length} 条，拦 ${rows.filter((r) => !r.ok).length} 条`);

console.log('\n  误杀明细（应为空或极少）:');
for (const r of clean.filter((x) => !x.ok)) console.log(`    ${r.file} ${r.kind} ${r.id}\n      ${r.detail}`);

console.log('\n  按 kind 统计误杀:');
const byKind = new Map<string, { n: number; blocked: number }>();
for (const r of clean) {
  const k = r.kind;
  if (!byKind.has(k)) byKind.set(k, { n: 0, blocked: 0 });
  const s = byKind.get(k)!;
  s.n++;
  if (!r.ok) s.blocked++;
}
for (const [k, s] of byKind) console.log(`    ${k.padEnd(18)} ${s.blocked}/${s.n}`);

console.log('\n  漏放的脏样本（需人工/LLM 复核）:');
for (const r of dirty.filter((x) => x.ok)) console.log(`    ${r.id}`);

console.log('\n══ 3. 软信号（WARN）统计 ══');
const warnCount = new Map<string, number>();
for (const r of rows) for (const w of r.warn) warnCount.set(w, (warnCount.get(w) ?? 0) + 1);
for (const [w, n] of warnCount) console.log(`  ${w}: ${n}/${rows.length}（${pct(n, rows.length)}）`);
