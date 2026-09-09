import { z } from 'zod';

export const difficultySchema = z.enum(['easy', 'medium', 'hard']);

export const providerIdSchema = z.enum([
  'chrome',
  'local',
  'deepseek',
  'openrouter',
  'google',
  'cloudflare-workers-ai',
]);

export const formatIdSchema = z.enum(['choice', 'open']);

export const questionAngleSchema = z.enum([
  'definition',
  'fundamental',
  'mechanism',
  'comparison',
  'calculation',
  'tradeoff',
  'scenario',
  'debugging',
  'system-design',
  'design',
  // part1 §四新增（plan0903_3 / ADR-077）：diagnosis 专指"从现象定位机制/根因"的认知行为，
  // 与 debugging（工程排障场景，含止血/修复/验证）并存，由出题 skill 引用 spec 区分，不互相替代。
  'causal',
  'diagnosis',
  'prediction',
  'architecture',
  'boundary',
  'misconception',
  'quantitative',
  'implementation',
  'synthesis',
]);

// 6 大能力域（ADR-038）：以"面试能力域"组织题库，而非按技术名词平铺。
// 每个域下再分 topic（见 src/data/taxonomy.ts），topic 下才是 Concept（KnowledgeNode）。
export const knowledgeAreaSchema = z.enum([
  'ai-engineering', // 基础能力：DL/CNN/序列模型/Transformer
  'llm', // 大模型核心：基础/训练/推理/架构/多模态
  'llm-applications', // 大模型应用：RAG/嵌入/检索/上下文工程
  'agent-engineering', // 智能体工程：基础/工具/MCP/规划/记忆/多智能体
  'ai-systems', // AI 系统：架构/评估/可观测/成本/可靠性
  'ai-security', // AI 安全：注入/泄露/工具/智能体安全
]);

export const knowledgePrioritySchema = z.enum(['P0', 'P1', 'P2']);

export const evaluationDimensionSchema = z.enum([
  'correctness',
  'completeness',
  'architecture',
  'communication',
]);

/**
 * 评分预设（P2-5）：开放题的一刀切四维权重对 coding/debugging 等题型不自然
 * （代码写对了但"架构表达"弱，不该被扣 20%）。题目可选填一个 profile，
 * 评分时按预设权重聚合；不填则沿用全局 rubric。刻意只做 6 档枚举，
 * 不引入 scoring DSL——维度仍是固定的四维，只是权重按题型 shifting。
 */
export const evaluationProfileSchema = z.enum([
  'theory',
  'coding',
  'debugging',
  'system-design',
  'tradeoff',
  'behavioral',
]);

/**
 * 认知任务（plan0903_3 / ADR-077，由 docs/prompt_part1.md §五引入）。
 * 描述考生为作答必须执行的认知行为；与 `angle`（从什么视角切入）正交。
 *
 * 与 `angle`、`difficulty` 同属 **measurement surface**：
 *  - canonical **原地改写**时，这些字段变化 = 突变信号（questionIdentity.ts 的 AssessmentContract
 *    用于检测「沿用原 ID 改了身份」的隐性污染，D2）。
 *  - 但这**不构成**「新内容/必须 fork」的判据：pool 里的 **Assessment Variant（ADR-077）可自声明
 *    不同的 angle / cognitiveTask**，仍归因同一 canonical（v7.1：同 Knowledge + 同 propositions +
 *    原 options 可作答的新 observation entry ⇒ Variant；Knowledge/Boundary 变或 options 承载不了
 *    新题干 ⇒ 才 fork）。
 */
export const cognitiveTaskSchema = z.enum([
  'recall',
  'explain',
  'identify',
  'diagnose',
  'compare',
  'predict',
  'apply',
  'evaluate',
  'design',
  'troubleshoot',
  'infer',
  'synthesize',
]);

/**
 * 测量意图（plan0907 / 外部评审 P0-2；对应 docs/prompt_part1.md 的 blueprint 产出物）。
 *
 * `angle / cognitiveTask / difficulty` 只回答「从哪个视角、做什么认知动作、多难」，
 * 回答不了「考生具体要走完哪条推理链才算答对」。两道题完全可以 angle 与 cognitiveTask
 * 都相同却共用同一条 reasoning path（重复测量），也可以字段相同而测量意图不同。
 *
 * 因此把 Blueprint 声明的测量意图一并落库，作为：
 *   - blueprint → question 的契约（转换阶段不再丢弃）
 *   - 人工 review 的审计上下文
 *   - variant challenger 的比较依据（判断两条 reasoning path 是否真的不同）
 *   - 后续质量分析的输入
 *
 * **不参与 runtime selection**：不进 adaptive / coverage 索引，不用于选题。
 */
export const assessmentSchema = z.object({
  /** 测量目标：这道题要测出的能力/判断是什么（Blueprint 的 assessmentTarget）。 */
  target: z.string().min(1),
  /** 推理目标：考生为答对必须走完的推理链（Blueprint 的 reasoningGoal）。 */
  reasoningGoal: z.string().min(1),
});

export const idSchema = z.string().min(1);

// ── 单源类型导出（Zod 即契约，推导即类型） ──
export type Difficulty = z.infer<typeof difficultySchema>;
export type ProviderId = z.infer<typeof providerIdSchema>;
export type FormatId = z.infer<typeof formatIdSchema>;
export type QuestionAngle = z.infer<typeof questionAngleSchema>;
export type CognitiveTask = z.infer<typeof cognitiveTaskSchema>;
export type Assessment = z.infer<typeof assessmentSchema>;
export type KnowledgeArea = z.infer<typeof knowledgeAreaSchema>;
export type KnowledgePriority = z.infer<typeof knowledgePrioritySchema>;
export type EvaluationDimension = z.infer<typeof evaluationDimensionSchema>;
export type EvaluationProfile = z.infer<typeof evaluationProfileSchema>;
