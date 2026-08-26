// PR2：把 PR0 试点映射（scripts/pilot/transformer-concept-tests.json）的 tests
// 并回生产题库 src/data/questions/transformer.json。幂等：重复运行只覆盖 tests。
// 纯 fs 操作，不依赖 Vite / TS 加载器。

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const qFile = fileURLToPath(new URL('../../src/data/questions/transformer.json', import.meta.url));
const mapFile = here + 'transformer-concept-tests.json';

const questions = JSON.parse(readFileSync(qFile, 'utf8'));
const mapping = JSON.parse(readFileSync(mapFile, 'utf8')).mapping;

let merged = 0;
for (const q of questions) {
  const t = mapping[q.id];
  if (t) {
    q.tests = t;
    merged++;
  }
}

writeFileSync(qFile, JSON.stringify(questions, null, 2) + '\n', 'utf8');
console.log(`merged tests into ${merged} / ${questions.length} questions in transformer.json`);
