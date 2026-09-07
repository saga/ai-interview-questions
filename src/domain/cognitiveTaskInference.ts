/**
 * 认知任务（cognitiveTask）离线推断 —— 只做**判定**，不做生成。
 *
 * 背景：1354 题里只有 43 题带 cognitiveTask（assessment contract 的第四维），缺失时
 * adaptive 的 assessment-cell 证据会回退到 angle 粒度。而 angle→cognitiveTask 不是单射
 * （mechanism 可以是 explain / diagnose / apply），**不能按 angle 静默批量写**。
 *
 * 因此这里的策略与 `assessmentInference` 一致：**只在能证明时给值，否则返回 null**。
 * 判定顺序是「题面显式提问方式」→「angle 先验」，前者覆盖后者。所有 angle 先验都对着
 * 已有的 43 条人工标注校准过（见 tests 与 CHANGELOG 2026-09-07）：
 *   comparison→compare 9/9 · tradeoff→evaluate 8/8 · debugging→diagnose 2/2
 *   calculation→infer 2/2 · design→design 1/1 · mechanism→explain 13/15
 *
 * 推断不出（system-design / scenario 里既没有设计动词也不是陈述辨析、fundamental 全量）
 * 一律返回 null，交人工撰写 —— 宁可留空，也不灌一个 50/50 的值。
 */

import type { CognitiveTask } from '../schemas/common.ts';
import type { QuestionAngle } from '../schemas/common.ts';

export interface CognitiveTaskInference {
  task: CognitiveTask;
  /** 命中哪条规则（审计用：可追溯到具体信号，而不是黑箱）。 */
  rule: string;
}

/** ① 题面显式提问方式：精度最高，先于 angle 先验。 */
const NUMERIC_ASK =
  /约为多少|是多少|多少个|多少条|多少倍|比例约为|节省比例|占用多少|需要多少|为多少|求解|算出|等于多少/;
const ROOT_CAUSE_ASK =
  /根因|归因|诊断|定位原因|最可能的原因|原因是什么|为什么会出现|为什么会|为何会|怎么排查|如何排查|如何定位|为何出现/;
const COMPARE_ASK = /有什么区别|有何区别|与[^，。]{1,20}相比|相比之下|对比一下|试比较|优于|优缺点|异同|两者的区别/;
const EVALUATE_ASK =
  /权衡|取舍|是否值得|应该优先|你会选|你会选择|哪个更|值得吗|代价|利弊|如何选|怎么选|是否应该|是否合理|能否取代|能否替代/;
const PREDICT_ASK = /会怎样|将会|后果是|会发生|会出现|会导致什么|未来趋势|预测一下/;

/** ② system-design / scenario 的二次分流信号。 */
const DESIGN_ASK =
  /如何设计|怎样设计|如何构建|如何搭建|如何规划|如何组织|如何落地|如何协调|请设计|设计一个|设计一套|设计该|设计完整的|架构设计|设计方案|你会如何|你会怎么|你会怎样|如何做|如何处理|如何应对|应包含哪些|应设置|应该拦截|需要哪些机制/;
const STATEMENT_PICK =
  /(下列|以下)[^？]{0,48}(说法是正确的|描述是正确的|是正确的|说法准确|是有效的|是必需的|是必要的|是合理的|应采取|应包括|最佳实践|属于|应当包含|是可行)/;

export function inferCognitiveTask(input: {
  question: string;
  angle?: QuestionAngle;
}): CognitiveTaskInference | null {
  const s = input.question ?? '';
  const angle = input.angle;

  // ① 题面显式提问方式
  if (NUMERIC_ASK.test(s)) return { task: 'infer', rule: 'numeric-ask' };
  if (ROOT_CAUSE_ASK.test(s)) return { task: 'diagnose', rule: 'root-cause-ask' };
  if (COMPARE_ASK.test(s)) return { task: 'compare', rule: 'compare-ask' };
  if (EVALUATE_ASK.test(s)) return { task: 'evaluate', rule: 'evaluate-ask' };
  if (PREDICT_ASK.test(s)) return { task: 'predict', rule: 'predict-ask' };

  // ② angle 先验（seed 校准）
  switch (angle) {
    case 'calculation':
      return { task: 'infer', rule: 'angle:calculation' };
    case 'debugging':
      return { task: 'diagnose', rule: 'angle:debugging' };
    case 'comparison':
      return { task: 'compare', rule: 'angle:comparison' };
    case 'tradeoff':
      return { task: 'evaluate', rule: 'angle:tradeoff' };
    case 'design':
      return { task: 'design', rule: 'angle:design' };
    case 'system-design':
    case 'scenario':
      // 这两类既可能是「请你设计」，也可能是「判断哪些说法正确」——必须看题面。
      if (DESIGN_ASK.test(s)) return { task: 'design', rule: 'design-ask' };
      if (STATEMENT_PICK.test(s)) return { task: 'identify', rule: 'statement-pick' };
      return null;
    case 'mechanism':
      return { task: 'explain', rule: 'angle:mechanism' };
    case 'definition':
      return { task: 'identify', rule: 'angle:definition' };
    // fundamental 在 seed 里 explain / identify 各半（「关系」类偏 explain、「性质与存在条件」类偏
    // identify），规则分不开，一律留空交人工。
    default:
      return null;
  }
}
