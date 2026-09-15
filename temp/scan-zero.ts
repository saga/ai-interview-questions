import fs from 'node:fs';
import path from 'node:path';

const qDir = 'src/data/questions';
const vDir = 'src/data/variants';
const canonicals: any[] = [];
for (const f of fs.readdirSync(qDir).filter((f) => f.endsWith('.json'))) {
  const data = JSON.parse(fs.readFileSync(path.join(qDir, f), 'utf8'));
  const arr = Array.isArray(data) ? data : data.questions ?? [];
  for (const q of arr) canonicals.push({ ...q, __file: f });
}
const variantIds = new Set<string>();
for (const f of fs.readdirSync(vDir).filter((f) => f.endsWith('.json'))) {
  const data = JSON.parse(fs.readFileSync(path.join(vDir, f), 'utf8'));
  for (const k of Object.keys(data.variants ?? {})) variantIds.add(k);
}
const zero = canonicals.filter((q) => !variantIds.has(q.id) && q.formats?.choice);
console.log('canonicals', canonicals.length, 'zero-variant choice', zero.length);
console.log('multiple', zero.filter((q) => q.formats.choice.type === 'multiple').length,
  'single', zero.filter((q) => q.formats.choice.type === 'single').length);

const byTopic = new Map<string, number>();
for (const q of zero) byTopic.set(q.topic, (byTopic.get(q.topic) ?? 0) + 1);
console.log('\nzero-variant by topic (top 30):');
for (const [t, c] of [...byTopic.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log('  ' + c + '\t' + t);

const mode = process.argv[2] ?? 'multiple';
const limit = Number(process.argv[3] ?? 20);
const list = zero.filter((q) => q.formats.choice.type === mode);
const seen = new Set<string>();
const picked: any[] = [];
for (const q of list) if (!seen.has(q.topic)) { seen.add(q.topic); picked.push(q); }
console.log('\n=== ' + mode + ' diverse-topic picks: ' + picked.length + ' ===');
for (const q of picked.slice(0, limit)) {
  const opts: string[] = q.formats.choice.options;
  const lens = opts.map((o) => o.length);
  console.log('-'.repeat(70));
  console.log('ID ' + q.id + '  [' + q.__file + ']');
  console.log('topic=' + q.topic + ' sub=' + (q.subtopic ?? '-') + ' diff=' + q.difficulty + ' angle=' + q.angle + ' ct=' + (q.cognitiveTask ?? '-') + ' ans=' + JSON.stringify(q.formats.choice.answer) + ' ratio=' + (Math.max(...lens) / Math.min(...lens)).toFixed(2));
  console.log('Q: ' + q.question);
  opts.forEach((o, i) => console.log('  ' + String.fromCharCode(65 + i) + (q.formats.choice.answer.includes(i) ? ' <==' : '') + ' ' + o));
}
