// 手写变体题干草稿（临时文件，构建后删除）。每题 2 条：surface-options + context-options。
// 注意：题干里避免「下文」等禁用子串（validateVariant 只查变体题干）。
export interface Authored {
  kind: 'surface-options' | 'context-options' | 'surface' | 'context';
  question: string;
}

export const AUTHORED: Record<string, Authored[]> = {
  'wikiskill-persistent-knowledge-rollback': [
    { kind: 'surface-options', question: '一个自我演化 Agent 已经做到「验证集失败就回滚 Skill」和「审计日志只追加不删」，但连续三代候选还是反复触发同一类失败。要排查状态管理层，最该先确认哪两项？' },
    { kind: 'context-options', question: '你接手运维一个自我演化 Agent，监控显示它已实现失败回滚与只读审计，可连续三代候选仍倒在同一类验证失败上。站在状态管理视角，最该先核查哪两点？' },
  ],
  'wikiskill-runtime-context-isolation': [
    { kind: 'surface-options', question: '在技能演化框架里，知识库中的原始条目要经过「编译」才会变成执行 Agent 加载的 Skill。这一步编译在机制上主要完成哪两项？' },
    { kind: 'context-options', question: '你在落地一套技能演化框架，原始知识条目要先编译成执行 Agent 能直接加载的 Skill。从机制层面看，这一步编译主要干了哪两件事？' },
  ],
  'wikiskill-meta-optimizer-context-overflow': [
    { kind: 'surface-options', question: 'Proposer 得从远超自身 context 容量的执行轨迹里归纳失败模式。在「扩大覆盖广度」和「控制 context 成本」之间，下列哪些取舍判断成立？' },
    { kind: 'context-options', question: '你的 Proposer 要从数万行执行轨迹里归纳失败模式，而它的 context 窗口远装不下全量样本。在覆盖广度与 context 成本之间，哪些取舍判断是成立的？' },
  ],
  'wikiskill-cross-model-skill-transfer': [
    { kind: 'surface-options', question: '强模型自我演化出的 Skill 直接交给弱模型执行时，表现可能超过弱模型自己演化出的 Skill。关于这一现象背后的原理，下列哪些判断成立？' },
    { kind: 'context-options', question: '评测报告里有个反直觉现象：强模型演化出的 Skill 直接给弱模型跑，效果竟好过弱模型自己演化的 Skill。这背后哪些原理判断站得住脚？' },
  ],
  'wikiskill-anti-looping-impact-tracker': [
    { kind: 'surface-options', question: '为避免 Optimizer 反复提出已被验证集拒绝的同类修改，需要把历史判决反馈回优化循环。下列哪些设计能让这份反馈真正影响下一次提议？' },
    { kind: 'context-options', question: '你带的优化器陷入怪圈：总在提验证集早已否决过的同类修改。要把历史判决真正接回优化回路，下面哪些设计才有效？' },
  ],
  'wikiskill-model-scaling-synergy': [
    { kind: 'surface-options', question: '关于程序化技能（Evolved Procedural Skills）与模型规模（Model Scaling）的关系，下列哪些基本判断符合当前工程观察？' },
    { kind: 'context-options', question: '你在做缩放实验，想弄清楚程序化技能与模型规模到底是相互替代还是互补协同。下列哪些基本判断符合工程观察？' },
  ],
  'wikiskill-three-layer-architecture-design': [
    { kind: 'surface-options', question: 'Raw / Wiki / Skill 三层工作区常被拿来和「单一可变状态存储」或「全量历史拼接进 context」比较。下列哪些对比判断准确描述了三层分离的实质优势？' },
    { kind: 'context-options', question: '架构评审上有人质疑：三层工作区相比「单一可变存储」或「全量历史拼进 context」到底好在哪。要准确说出三层分离的实质好处，哪些对比是对的？' },
  ],
  'wikiskill-supp-001': [
    { kind: 'surface-options', question: '候选 Skill 从生成到上线，哪组发布流程能避免半成品版本进入执行路径？' },
    { kind: 'context-options', question: '发布流程出过一次事故：半成品候选被推进了执行路径。你复盘时想要一组能挡住这类问题的发布流程，哪组靠谱？' },
  ],
  'wikiskill-supp-002': [
    { kind: 'surface-options', question: 'Skill 发布失败后，怎样设计知识记录与版本指针，既能回到稳定执行版本又不抹掉失败证据？' },
    { kind: 'context-options', question: '一次回滚后团队吵起来：到底该保留失败证据还是清掉它。Skill 上线失败后，知识记录与版本指针该怎么设计？' },
  ],
  'wikiskill-supp-003': [
    { kind: 'surface-options', question: '执行 context 同时需要编译 Skill 和 Wiki 证据时，哪种权限边界最稳妥？' },
    { kind: 'context-options', question: '你在搭执行 context，既要注入编译好的 Skill 又要引用 Wiki 证据。画出怎样的权限边界最稳？' },
  ],
  'wikiskill-supp-004': [
    { kind: 'surface-options', question: '当执行 Agent 的 context 预算紧张时，哪种取舍更符合 Skill 运行时的职责边界？' },
    { kind: 'context-options', question: '线上执行 Agent 的 context 预算开始告急，你要在「保什么」和「怎么省」之间取舍。哪种取舍才贴合运行时职责边界？' },
  ],
  'wikiskill-supp-005': [
    { kind: 'surface-options', question: 'Proposer 要从超长执行数据中找出系统性失败模式时，哪种处理链路更合理？' },
    { kind: 'context-options', question: 'Proposer 面对远超 context 容量的执行数据，要找出系统性失败模式。哪条处理链路更合理？' },
  ],
  'wikiskill-supp-006': [
    { kind: 'surface-options', question: '如何让记忆系统与工具读取协同，而不是用固定截断掩盖 Proposer 的 context 超限？' },
    { kind: 'context-options', question: '你发现 Proposer 频繁 context 超限，而团队只是一遍遍做固定截断。怎样让记忆系统和工具读取真正协同？' },
  ],
  'wikiskill-supp-007': [
    { kind: 'surface-options', question: '在 Skill 生命周期中，发现、评估和执行三个阶段应如何分工，才能避免让执行模型承担不该承担的职责？' },
    { kind: 'context-options', question: '一个新人在设计 Skill 流水线，把发现、评估、执行搅在一起，结果发布不可审计。这三个阶段该怎么分工？' },
  ],
  'wikiskill-supp-008': [
    { kind: 'surface-options', question: '要把一个模型发现的 Skill 迁移给不同模型执行，哪种验证设计最能区分可迁移知识与模型特定假设？' },
    { kind: 'context-options', question: '你要把 A 模型发现的 Skill 迁到 B 模型去跑，担心某些结论只是 A 的偏好。怎样的验证设计最能区分可迁移知识与模型特定假设？' },
  ],
  'wikiskill-supp-009': [
    { kind: 'surface-options', question: '影响追踪器要识别语义近似的重复候选，最少应维护哪些结构化信号？' },
    { kind: 'context-options', question: '影响追踪器老把措辞稍变的同类候选当成全新方向。它最少要维护哪些结构化信号才能识别近重复？' },
  ],
  'wikiskill-supp-010': [
    { kind: 'surface-options', question: '自动 Skill 优化器在连续多轮没有有效提升时，哪种停止策略更容易审计和恢复？' },
    { kind: 'context-options', question: '自动优化器连续十轮没提升，却还在盲目采样。怎样的停止策略才更容易审计和恢复？' },
  ],
  'wikiskill-supp-011': [
    { kind: 'surface-options', question: '研究模型规模与 Skill 收益的交互时，哪种实验矩阵能支持可解释结论？' },
    { kind: 'context-options', question: '你在写技能演化的实验方案，要同时说清规模与 Skill 收益的关系。怎样的实验矩阵能支撑可解释结论？' },
  ],
  'wikiskill-supp-012': [
    { kind: 'surface-options', question: '发现小模型加 Skill 在部分任务上超过大模型无 Skill 后，下一步怎样验证这个结论的适用边界？' },
    { kind: 'context-options', question: '你看到小模型加 Skill 在部分任务反超大模型无 Skill，兴奋地想直接外推结论。下一步怎么验证这个结论的适用边界？' },
  ],
  'wikiskill-supp-013': [
    { kind: 'surface-options', question: 'Raw、Wiki、Skill 三层工作区如何设置写入权限和 promotion gate，才能防止未经验证的内容进入执行层？' },
    { kind: 'context-options', question: '审计发现有人绕过了验证门，把未经验证的内容直接写进了执行层。三层工作区该怎么设写入权限和 promotion gate 才能挡住这类事？' },
  ],
  'wikiskill-supp-014': [
    { kind: 'surface-options', question: '三层工作区发生 Skill 发布事故或存储故障时，怎样设计回滚指针与灾备，才能恢复服务并保留审计链？' },
    { kind: 'context-options', question: '三层工作区遇上 Skill 发布事故叠加存储故障，你既要恢复服务又要保住审计链。回滚指针与灾备该怎么设计？' },
  ],
};
