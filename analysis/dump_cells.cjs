// analysis/dump_cells.cjs <topic> <angle> [<topic> <angle> ...]
// Dumps overloaded same-(topic×angle) cells' questions compactly for content review.
const fs = require('fs');
const p = 'src/data/questions';
const all = [];
for (const f of fs.readdirSync(p)) {
  if (f.endsWith('.json')) {
    for (const q of JSON.parse(fs.readFileSync(p + '/' + f, 'utf8'))) all.push(q);
  }
}
const cells = {};
for (const q of all) {
  const k = (q.topic || '?') + '|' + (q.angle || 'none');
  (cells[k] || (cells[k] = [])).push(q);
}
const over = Object.entries(cells).filter(([, v]) => v.length >= 4).sort((a, b) => b[1].length - a[1].length);

function dumpCell(k, items) {
  const topic = k.split('|')[0];
  const angle = k.split('|')[1];
  let out = '\n########## ' + k + '   (n=' + items.length + ') ##########\n';
  items.sort((a, b) => (a.difficulty > b.difficulty ? 1 : -1));
  for (const q of items) {
    const ch = q.formats && q.formats.choice;
    const conc = (q.concepts || []).join('/');
    out += '\n• ' + q.id + '  [' + q.difficulty + ']  concepts=' + conc + '\n';
    out += '   Q: ' + q.question + '\n';
    if (ch) {
      ch.options.forEach((o, i) => {
        const mark = (ch.answer || []).includes(i) ? ' ✓' : '  ';
        const t = o.length > 120 ? o.slice(0, 120) + '…' : o;
        out += '     ' + i + mark + ' ' + t + '\n';
      });
    }
    if (q.explanation) out += '   A: ' + (q.explanation.length > 160 ? q.explanation.slice(0, 160) + '…' : q.explanation) + '\n';
  }
  return out;
}

let out = '';
if (process.argv.length > 2) {
  for (let i = 2; i < process.argv.length; i += 2) {
    const k = process.argv[i] + '|' + process.argv[i + 1];
    if (cells[k]) out += dumpCell(k, cells[k]);
  }
} else {
  out = 'TOTAL overloaded cells(>=4): ' + over.length + '\n';
  for (const [k, items] of over) out += dumpCell(k, items);
}
process.stdout.write(out);
