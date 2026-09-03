// 校准 v4：验证「生造词率」能否抓到 clause 倒置 / 标点规则都漏掉的翻译腔。
//
// 思路：不去判断「什么是自然中文」（做不到，也没有词典）。
//       只判断：变体**新引入**的 CJK bigram 里，有多少是题库 1300+ 道 canonical
//       从没用过的。合法重述会用常见词（"任务成功率"→"任务的成功率"，bigram 都在题库里）；
//       机器翻译腔会造词（"运行迹线"/"流程失误"/"失利 Trace"/"单元检验"/"保养开销"）。
//
// 白名单只从 canonical 题库建立（不含变体池），否则脏数据会自己进白名单。
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

const STRIP = /[\s，,。；;、：:？?！!（）()\[\]【】"'“”‘’·—\-/\\|]/g;
function bigrams(s) {
  const c = (s ?? '').replace(STRIP, '');
  const out = new Set();
  for (let i = 0; i < c.length - 1; i++) out.add(c.slice(i, i + 2));
  return out;
}

// ── 题库全局 bigram 白名单（canonical 题干 + 选项 + 解析）──
const wl = new Map();
function feed(s) { for (const b of bigrams(s)) wl.set(b, (wl.get(b) ?? 0) + 1); }
for (const q of questions) {
  feed(q.question); feed(q.explanation);
  for (const o of q.formats?.choice?.options ?? []) feed(o);
  for (const o of q.formats?.open ? [q.formats.open.referenceAnswer] : []) feed(o);
}
const WHITELIST_MIN = 2; // 只出现过 1 次的 bigram 视为噪声，不算白名单
const white = new Set([...wl.entries()].filter(([, n]) => n >= WHITELIST_MIN).map(([b]) => b));
console.log(`题库 bigram 白名单：${wl.size} 个原始，出现 ≥${WHITELIST_MIN} 次的保留 ${white.size} 个\n`);

/** 变体相对 canonical 新引入的 bigram 中，不在白名单里的比例（0~100）。 */
function neologismRate(canonOpt, varOpt) {
  const cb = bigrams(canonOpt);
  const vb = bigrams(varOpt);
  const novel = [...vb].filter((b) => !cb.has(b));
  if (novel.length === 0) return { rate: 0, novel: 0, unknown: 0 };
  const unknown = novel.filter((b) => !white.has(b));
  return { rate: (unknown.length / novel.length) * 100, novel: novel.length, unknown: unknown.length };
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
      let rSum = 0, rMax = 0;
      for (let i = 0; i < cf.options.length; i++) {
        const r = neologismRate(cf.options[i], v.options[i]).rate;
        rSum += r; rMax = Math.max(rMax, r);
      }
      rows.push({ file: f, kind: v.kind, id: v.id, neo: rSum / cf.options.length, neoMax: rMax });
    }
  }
}

const q = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a[Math.floor((a.length - 1) * p)]; };
const f1 = (n) => (n ?? 0).toFixed(1);
const pct = (n, d) => ((n / d) * 100).toFixed(1) + '%';

const groups = new Map();
for (const r of rows) {
  const k = `${r.file.replace('.wb-llm-2026090', '@').replace('.json', '')} / ${r.kind}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(r);
}
console.log('══ 生造词率（neoMax，%）按 文件 × kind ══');
for (const [k, g] of [...groups.entries()].sort()) {
  const a = g.map((r) => r.neoMax);
  console.log(`${k.padEnd(46)} n=${String(g.length).padStart(3)}  p50=${f1(q(a, 0.5))} p75=${f1(q(a, 0.75))} p90=${f1(q(a, 0.9))} p95=${f1(q(a, 0.95))}`);
}

const dirty = rows.filter((r) => r.file.startsWith('evaluation.') && r.kind === 'context-options');
const clean = rows.filter((r) => !(r.file.startsWith('evaluation.') && r.kind === 'context-options'));
console.log(`\n══ 分离度：脏 ${dirty.length} / 干净 ${clean.length} ══`);
console.log(`  脏   p25=${f1(q(dirty.map((r) => r.neoMax), 0.25))} p50=${f1(q(dirty.map((r) => r.neoMax), 0.5))}`);
console.log(`  干净 p50=${f1(q(clean.map((r) => r.neoMax), 0.5))} p90=${f1(q(clean.map((r) => r.neoMax), 0.9))} p95=${f1(q(clean.map((r) => r.neoMax), 0.95))}`);
console.log('\n══ 阈值 ══');
for (const t of [30, 40, 50, 60, 70]) {
  const kd = dirty.filter((r) => r.neoMax >= t).length;
  const kc = clean.filter((r) => r.neoMax >= t).length;
  console.log(`  neoMax >= ${t}: 拦脏 ${String(kd).padStart(3)}/${dirty.length}（${pct(kd, dirty.length)}）  误杀 ${String(kc).padStart(3)}/${clean.length}（${pct(kc, clean.length)}）`);
}

console.log('\n══ 脏样本里被生造词率抓到、但形式规则漏掉的（这正是要补的）══');
const cjk = /[㐀-䶿一-鿿豈-﫿]/;
const FORMAL = ['badUnicode', 'doublePunct', 'unbalParen', 'trailComma', 'tooShort', 'repeatedClause'];
const TRAIL = /[，,、；;：:]$/;
const DOUBLE = /[。；;，,、：:！!？?.]{2,}/;
const formalHit = (v) => (v.options ?? []).some((o) => TRAIL.test((o ?? '').trim()) || DOUBLE.test(o ?? ''));
for (const r of dirty) {
  if (formalHit(rows.find((x) => x.id === r.id) ? { options: [] } : { options: [] })) continue;
  if (r.neoMax >= 50) console.log(`  neoMax=${r.neoMax.toFixed(0)}  ${r.id}`);
}
console.log('\n（上面是形式规则漏掉、但生造词率 ≥50 的脏样本）');
