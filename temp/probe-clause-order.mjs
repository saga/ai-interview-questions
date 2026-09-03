// 校准 v2：验证「从句顺序倒置」能否把机器翻译腔与合法重述分开。
//
// 机器翻译腔的形式特征（本池实测）：
//   原文：A，B；因为 C，D。
//   变体：D。C，因为 B，A，        ← 从句整块倒装 + 结尾悬空逗号
// 合法重述改写会换词、换句式，但**保留叙述顺序**（先结论后理由 → 仍先结论后理由）。
//
// 度量：把选项按句读切成 clause，每个变体 clause 贪心匹配最相似的 canonical clause，
//      得到 index 序列，算其逆序对比例（Kendall tau 距离）= clauseInversion。
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

const CJK = /[㐀-䶿一-鿿豈-﫿]/;
function cjkTokenize(text) {
  const out = []; let buf = '';
  const flush = () => { if (buf) { out.push(buf); buf = ''; } };
  for (const ch of text.toLowerCase()) {
    if (CJK.test(ch)) { flush(); out.push(ch); }
    else if (/[a-z0-9]/.test(ch)) buf += ch;
    else flush();
  }
  flush(); return out;
}
function dice(x, y) {
  const a = cjkTokenize(x), b = cjkTokenize(y);
  if (!a.length && !b.length) return 100;
  if (!a.length || !b.length) return 0;
  const counts = new Map();
  for (const t of a) counts.set(t, (counts.get(t) ?? 0) + 1);
  let inter = 0;
  for (const t of b) { const n = counts.get(t) ?? 0; if (n > 0) { inter++; counts.set(t, n - 1); } }
  return (200 * inter) / (a.length + b.length);
}

/** 按句读切 clause（保留标点作为末尾，便于判断悬空）。 */
function clauses(s) {
  return (s ?? '')
    .split(/(?<=[。；;！!？?，,、])/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

/** clause 顺序倒置比例 0~1：变体 clause 匹配到的 canonical clause 下标序列的逆序对比。 */
function clauseInversion(canonText, variantText) {
  const cs = clauses(canonText);
  const vs = clauses(variantText);
  if (cs.length < 2 || vs.length < 2) return 0;
  const idx = [];
  for (const vc of vs) {
    let best = -1, bestScore = -1;
    for (let i = 0; i < cs.length; i++) {
      const sc = dice(cs[i], vc);
      if (sc > bestScore) { bestScore = sc; best = i; }
    }
    idx.push(best);
  }
  let inv = 0, tot = 0;
  for (let i = 0; i < idx.length; i++)
    for (let j = i + 1; j < idx.length; j++) { tot++; if (idx[i] > idx[j]) inv++; }
  return tot === 0 ? 0 : inv / tot;
}

const STRIP = /[\s，,。；;、：:？?！!（）()\[\]【】"'“”‘’·—\-/\\|]/g;
function bigrams(s) {
  const c = (s ?? '').replace(STRIP, '');
  const out = new Set();
  for (let i = 0; i < c.length - 1; i++) out.add(c.slice(i, i + 2));
  if (c.length === 1) out.add(c);
  return out;
}
function coverage(a, b) {
  if (a.size === 0) return 100;
  let inter = 0; for (const x of a) if (b.has(x)) inter++;
  return (inter / a.size) * 100;
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
      let invSum = 0, invMax = 0, covSum = 0;
      for (let i = 0; i < cf.options.length; i++) {
        const inv = clauseInversion(cf.options[i], v.options[i]);
        const cov = coverage(bigrams(cf.options[i]), bigrams(v.options[i]));
        invSum += inv; invMax = Math.max(invMax, inv); covSum += cov;
      }
      rows.push({
        file: f.replace('.wb-llm-2026090', '@').replace('.json', ''),
        kind: v.kind, id: v.id,
        inv: (invSum / cf.options.length) * 100,
        invMax: invMax * 100,
        cov: covSum / cf.options.length,
      });
    }
  }
}

const q = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a[Math.floor((a.length - 1) * p)]; };
const f1 = (n) => (n ?? 0).toFixed(1);

console.log('══ clause 倒置率（invMax，%）按 文件 × kind ══\n');
const groups = new Map();
for (const r of rows) {
  const k = `${r.file} / ${r.kind}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(r);
}
for (const [k, g] of [...groups.entries()].sort()) {
  const inv = g.map((r) => r.invMax);
  console.log(`${k.padEnd(46)} n=${String(g.length).padStart(3)}  invMax p50=${f1(q(inv, 0.5))} p75=${f1(q(inv, 0.75))} p90=${f1(q(inv, 0.9))}`);
}

const dirty = rows.filter((r) => r.file === 'evaluation@3' && r.kind === 'context-options');
const clean = rows.filter((r) => !(r.file === 'evaluation@3' && r.kind === 'context-options'));
console.log(`\n══ 分离度：脏 n=${dirty.length} / 干净 n=${clean.length} ══`);
console.log(`  脏   invMax p50=${f1(q(dirty.map((r) => r.invMax), 0.5))} p25=${f1(q(dirty.map((r) => r.invMax), 0.25))}`);
console.log(`  干净 invMax p50=${f1(q(clean.map((r) => r.invMax), 0.5))} p75=${f1(q(clean.map((r) => r.invMax), 0.75))} p90=${f1(q(clean.map((r) => r.invMax), 0.9))} p95=${f1(q(clean.map((r) => r.invMax), 0.95))}`);

console.log('\n══ 若用 invMax 作门禁 ══');
for (const t of [40, 50, 60, 70, 80]) {
  const killD = dirty.filter((r) => r.invMax >= t).length;
  const killC = clean.filter((r) => r.invMax >= t).length;
  console.log(`  invMax >= ${t}: 拦脏 ${String(killD).padStart(3)}/${dirty.length}（${((killD / dirty.length) * 100).toFixed(0)}%）  误杀干净 ${String(killC).padStart(3)}/${clean.length}（${((killC / clean.length) * 100).toFixed(1)}%）`);
}

console.log('\n══ invMax 与 cov 联合 ══');
for (const [it, ct] of [[50, 55], [60, 55], [50, 65], [60, 65]]) {
  const killD = dirty.filter((r) => r.invMax >= it || r.cov < ct).length;
  const killC = clean.filter((r) => r.invMax >= it || r.cov < ct).length;
  console.log(`  invMax>=${it} 或 cov<${ct}: 拦脏 ${String(killD).padStart(3)}/${dirty.length}（${((killD / dirty.length) * 100).toFixed(0)}%）  误杀干净 ${String(killC).padStart(3)}/${clean.length}（${((killC / clean.length) * 100).toFixed(1)}%）`);
}
