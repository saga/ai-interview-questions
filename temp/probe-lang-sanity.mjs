// 校准：确定性「语言质量」信号在真实池上的分离度。
//
// 关键问题：现有的漂移门禁 `cjkDice` 是**单字多重集 Dice**，
// 而机器翻译腔的破坏方式是「实词替换」（成功率→达成率、工具调用→器具唤起）——
// 单字层面仍大量重叠（率/成/调/用 都在），所以 char Dice 掉得不多，漂移门禁放行。
// 本探测验证：**字 bigram 覆盖率**这一条不同轴能否把脏数据分出来。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const qDir = path.join(ROOT, 'src/data/questions');
const vDir = path.join(ROOT, 'src/data/variants');

const questions = [];
for (const f of fs.readdirSync(qDir)) {
  if (!f.endsWith('.json')) continue;
  const arr = JSON.parse(fs.readFileSync(path.join(qDir, f), 'utf8'));
  questions.push(...(Array.isArray(arr) ? arr : arr.questions ?? []));
}
const byId = new Map(questions.map((q) => [q.id, q]));

// ── 现有漂移度量：单字多重集 Dice（与 src/domain/textSimilarity.cjkDice 同实现） ──
const CJK = /[㐀-䶿一-鿿豈-﫿]/;
function cjkTokenize(text) {
  const out = [];
  let buf = '';
  const flush = () => { if (buf) { out.push(buf); buf = ''; } };
  for (const ch of text.toLowerCase()) {
    if (CJK.test(ch)) { flush(); out.push(ch); }
    else if (/[a-z0-9]/.test(ch)) buf += ch;
    else flush();
  }
  flush();
  return out;
}
function cjkDice(x, y) {
  const a = cjkTokenize(x), b = cjkTokenize(y);
  if (a.length === 0 && b.length === 0) return 100;
  if (a.length === 0 || b.length === 0) return 0;
  const counts = new Map();
  for (const t of a) counts.set(t, (counts.get(t) ?? 0) + 1);
  let inter = 0;
  for (const t of b) { const n = counts.get(t) ?? 0; if (n > 0) { inter++; counts.set(t, n - 1); } }
  return (200 * inter) / (a.length + b.length);
}

// ── 候选语言度量：字 bigram 集合覆盖率（canonical 的实词 bigram 保留了多少） ──
const STRIP = /[\s，,。；;、：:？?！!（）()\[\]【】"'“”‘’·—\-/\\|]/g;
function bigrams(s) {
  const cleaned = (s ?? '').replace(STRIP, '');
  const out = new Set();
  for (let i = 0; i < cleaned.length - 1; i++) out.add(cleaned.slice(i, i + 2));
  if (cleaned.length === 1) out.add(cleaned);
  return out;
}
function coverage(canon, variant) {
  if (canon.size === 0) return 100;
  let inter = 0;
  for (const x of canon) if (variant.has(x)) inter++;
  return (inter / canon.size) * 100;
}

const rows = [];
for (const f of fs.readdirSync(vDir)) {
  if (!f.endsWith('.json')) continue;
  const pool = JSON.parse(fs.readFileSync(path.join(vDir, f), 'utf8'));
  for (const [qid, list] of Object.entries(pool.variants ?? {})) {
    const canon = byId.get(qid);
    if (!canon?.formats?.choice) continue;
    const cf = canon.formats.choice;
    for (const v of list) {
      if (!Array.isArray(v.options) || v.options.length !== cf.options.length) continue;
      let dSum = 0, cSum = 0, dMin = 100, cMin = 100;
      for (let i = 0; i < cf.options.length; i++) {
        const d = cjkDice(cf.options[i], v.options[i]);
        const c = coverage(bigrams(cf.options[i]), bigrams(v.options[i]));
        dSum += d; cSum += c;
        dMin = Math.min(dMin, d); cMin = Math.min(cMin, c);
      }
      rows.push({
        file: f.replace('.wb-llm-2026090', '@').replace('.json', ''),
        kind: v.kind,
        id: v.id,
        dice: dSum / cf.options.length,
        diceMin: dMin,
        cov: cSum / cf.options.length,
        covMin: cMin,
      });
    }
  }
}

const q = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a[Math.floor((a.length - 1) * p)]; };
const f1 = (n) => (n ?? 0).toFixed(1);

console.log('══ 两个度量的分离度：按 文件 × kind ══');
console.log('（dice=现有漂移度量，阈值<35 才拒；cov=新语言度量）\n');
const groups = new Map();
for (const r of rows) {
  const k = `${r.file} / ${r.kind}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(r);
}
for (const [k, g] of [...groups.entries()].sort()) {
  const dice = g.map((r) => r.dice), cov = g.map((r) => r.cov);
  console.log(
    `${k.padEnd(46)} n=${String(g.length).padStart(3)}  dice p5=${f1(q(dice, 0.05))} p50=${f1(q(dice, 0.5))}   cov p5=${f1(q(cov, 0.05))} p25=${f1(q(cov, 0.25))} p50=${f1(q(cov, 0.5))}`,
  );
}

console.log('\n══ 关键检验：脏数据是否被现有漂移门禁放行？══');
const DIRTY_FILE = 'evaluation@3';
const dirty = rows.filter((r) => r.file === DIRTY_FILE && r.kind === 'context-options');
const clean = rows.filter((r) => !(r.file === DIRTY_FILE && r.kind === 'context-options'));
console.log(`脏样本（evaluation/context-options）n=${dirty.length}`);
console.log(`  min dice = ${f1(Math.min(...dirty.map((r) => r.diceMin)))}  → 漂移阈值 35 之下有 ${dirty.filter((r) => r.diceMin < 35).length} 条被现有门禁拦住`);
console.log(`  cov p50  = ${f1(q(dirty.map((r) => r.cov), 0.5))}`);
console.log(`干净样本 n=${clean.length}  cov p5=${f1(q(clean.map((r) => r.cov), 0.05))} p25=${f1(q(clean.map((r) => r.cov), 0.25))}`);

console.log('\n══ 若用 covMin 作门禁，各阈值的误杀/漏放 ══');
for (const t of [40, 45, 50, 55, 60]) {
  const killDirty = dirty.filter((r) => r.covMin < t).length;
  const killClean = clean.filter((r) => r.covMin < t).length;
  console.log(
    `  阈值 covMin < ${t}: 拦脏 ${String(killDirty).padStart(3)}/${dirty.length}（${((killDirty / dirty.length) * 100).toFixed(0)}%）  误杀干净 ${String(killClean).padStart(3)}/${clean.length}（${((killClean / clean.length) * 100).toFixed(1)}%）`,
  );
}
