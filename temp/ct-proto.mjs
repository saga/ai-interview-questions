import fs from 'node:fs';

const dir = 'src/data/questions';
const qs = [];
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
  const a = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8'));
  if (Array.isArray(a)) qs.push(...a);
}

const NUMERIC = /约为多少|是多少|多少个|多少条|多少倍|比例约为|节省比例|占用多少|需要多少|为多少|求解|算出|计算.*约为|等于多少/;
const ROOT_CAUSE = /根因|归因|诊断|定位原因|最可能的原因|原因是什么|为什么会出现|为什么会|为何会|怎么排查|如何排查|如何定位|为何出现/;
const DESIGN_ASK = /如何设计|怎样设计|如何构建|如何搭建|如何规划|如何组织|如何落地|如何协调|请设计|设计一个|设计一套|设计该|你会如何|你会怎么|你会怎样|如何做|如何处理|如何应对|应包含哪些|应设置|应该拦截|需要哪些机制/;
const STATEMENT_PICK = /(下列|以下)[^？]{0,48}(说法是正确的|描述是正确的|是正确的|说法准确|是有效的|是必需的|是必要的|是合理的|应采取|应包括|最佳实践|属于|应当包含|是可行)/;
const COMPARE_ASK = /有什么区别|有何区别|与.*相比|相比之下|对比一下|试比较|优于|优缺点|异同|两者的区别/;
const EVAL_ASK = /权衡|取舍|是否值得|应该优先|你会选|你会选择|哪个更|值得吗|代价|利弊|如何选|怎么选|是否应该|是否合理|能否取代|能否替代/;
const PREDICT_ASK = /会怎样|将会|后果是|会发生|会出现|会导致什么|未来趋势|预测一下/;

function infer(q) {
  const s = q.question || '';
  const angle = q.angle;
  // 1) 题面显式提问方式（最高精度，先于 angle）
  if (NUMERIC.test(s)) return 'infer';
  if (ROOT_CAUSE.test(s)) return 'diagnose';
  if (COMPARE_ASK.test(s)) return 'compare';
  if (EVAL_ASK.test(s)) return 'evaluate';
  if (PREDICT_ASK.test(s)) return 'predict';
  // 2) angle 先验（seed 校准过：comparison=compare 9/9、tradeoff=evaluate 8/8、
  //    debugging=diagnose 2/2、calculation=infer 2/2、design=design 1/1）
  switch (angle) {
    case 'calculation': return 'infer';
    case 'debugging': return 'diagnose';
    case 'comparison': return 'compare';
    case 'tradeoff': return 'evaluate';
    case 'design': return 'design';
    case 'system-design':
    case 'scenario':
      if (DESIGN_ASK.test(s)) return 'design';
      if (STATEMENT_PICK.test(s)) return 'identify';
      return null;
    case 'mechanism': return ROOT_CAUSE.test(s) ? 'diagnose' : 'explain';
    case 'definition': return 'identify';
    case 'fundamental': return null;
    default: return null;
  }
}

const seeded = qs.filter((q) => q.cognitiveTask);
let ok = 0;
const miss = [];
for (const q of seeded) {
  const got = infer(q);
  if (got === q.cognitiveTask) ok++;
  else miss.push({ id: q.id, angle: q.angle, want: q.cognitiveTask, got, stem: (q.question || '').slice(0, 46) });
}
console.log(`seed 一致性 ${ok}/${seeded.length}`);
for (const m of miss) console.log(`  ✗ [${m.angle}] want=${m.want} got=${m.got} · ${m.id} · ${m.stem}`);

// 全量分布
const dist = {};
let nul = 0;
for (const q of qs) {
  const t = infer(q);
  if (!t) { nul++; continue; }
  dist[t] = (dist[t] || 0) + 1;
}
console.log('全量分布', dist, 'null', nul);

const nullByAngle = {};
let shown = 0;
for (const q of qs) {
  if (infer(q)) continue;
  nullByAngle[q.angle] = (nullByAngle[q.angle] || 0) + 1;
  if (shown < 16) { shown++; console.log('  · [' + q.angle + '] ' + (q.question || '').slice(0, 62)); }
}
console.log('null 按 angle', nullByAngle);
