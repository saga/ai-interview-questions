// analysis/_remove_ids.cjs <file> <id1> [<id2> ...]
// Removes questions by id from a question JSON file, preserving original formatting
// (pretty 2-space if the file uses it, else one-object-per-line compact).
const fs = require('fs');
const file = process.argv[2];
const ids = new Set(process.argv.slice(3));
const raw = fs.readFileSync(file, 'utf8');
const arr = JSON.parse(raw);
const before = arr.length;
const pretty = /\n\s*\{/.test(raw); // newline + spaces + { => pretty-printed
const kept = arr.filter((q) => !ids.has(q.id));
if (kept.length === before) {
  console.error('NO MATCH for ids', [...ids], 'in', file);
  process.exit(1);
}
const removed = before - kept.length;
const out = pretty
  ? JSON.stringify(kept, null, 2) + '\n'
  : '[' + kept.map((q) => JSON.stringify(q)).join(',\n') + ']\n';
fs.writeFileSync(file, out);
console.log('removed', removed, 'from', file, '(', before, '->', kept.length, ')');
