/// <reference types="vite/client" />
// 临时调试：打印每条手写变体逐项 token_set_ratio 与是否命中禁用指代。
import { questionBank } from '../src/data/questionBank';
import { normalizeOptionText } from '../src/domain/options';
import * as fuzz from 'fuzzball';
import { AUTHORED } from './build-variants-wb';

const FORBIDDEN = ['原题', '上述', '下文', '本文', '原文章', '原方案', '该方案', '前文', '题目中', '题干中'];

const byId = new Map(questionBank.questions.map((q) => [q.id, q]));

for (const [qid, list] of Object.entries(AUTHORED)) {
  const canonical = byId.get(qid)!;
  const cf = canonical.formats.choice!;
  list.forEach((a, seq) => {
    const fb = FORBIDDEN.filter((w) => a.question.includes(w));
    if (fb.length) console.log(`[FORBIDDEN] ${qid} [${a.kind}] 命中：${fb.join(',')}`);
    a.options.forEach((o, i) => {
      const r = fuzz.token_set_ratio(normalizeOptionText(cf.options[i]), normalizeOptionText(o));
      if (r < 60) console.log(`[RATIO ${r}] ${qid} [${a.kind}] 选项#${i + 1}: ${cf.options[i]}  <=>  ${o}`);
    });
  });
}
console.log('debug done');
