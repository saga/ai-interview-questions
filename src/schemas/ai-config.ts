import { z } from 'zod';
import { providerIdSchema } from './common';

const providerEntrySchema = z.object({
  id: providerIdSchema,
  enabled: z.boolean().default(true),
  model: z.string().default(''),
  apiKey: z.string().default(''),
  baseUrl: z.string().optional(),
  accountId: z.string().optional(),
});

const promptConfigSchema = z.object({
  /**
   * 用户自定义指令（目标 / 风格 / 偏好层）。
   * 它**只追加**在不可覆盖的安全层与契约层之后（见 `buildAgentSystemPrompt`），
   * 永远不会替换或覆盖内置 system prompt。缺省为空（仅用安全层 + 契约层）。
   */
  agentInstructions: z.string().optional(),
  /** Agent 开场指令（首轮 user 消息）：本轮流程与停止条件。缺省用 `INTERVIEW_AGENT_OPENING_INSTRUCTION`。 */
  agentOpening: z.string().optional(),
});

export const proficiencyConfigSchema = z.object({
  choiceWeight: z.number().positive().default(1),
  openWeight: z.number().positive().default(5),
  baseCoefficient: z.number().min(0).max(1).default(0.15),
  questionCoefficient: z.number().min(0).max(1).default(0.6),
  practiceCoefficient: z.number().min(0).max(1).default(0.25),
  questionConfidenceSmoothing: z.number().positive().default(4),
  practiceConfidenceSmoothing: z.number().positive().default(2),
});
export type ProficiencyConfig = z.infer<typeof proficiencyConfigSchema>;
const DEFAULT_PROFICIENCY: ProficiencyConfig = {
  choiceWeight: 1,
  openWeight: 5,
  baseCoefficient: 0.15,
  questionCoefficient: 0.6,
  practiceCoefficient: 0.25,
  questionConfidenceSmoothing: 4,
  practiceConfidenceSmoothing: 2,
};

export const aiConfigSchema = z.object({
  providers: z.array(providerEntrySchema),
  generateOpenQuestions: z.preprocess((v) => v === true, z.boolean().default(false)),
  questionChallengerEnabled: z.preprocess((v) => v === true, z.boolean().default(false)),
  /**
   * 运行时变体开关（双模式 Variant 设计）。
   * 默认 OFF：训练时只走 Offline Variant Pool（题库资产，零 LLM 落地）；
   * 仅当 Pool 命中失败时，且本开关开启、且存在可用 provider 时，才退化到 1 次 LLM 运行时生成。
   * 运行时生成结果**不写回**题库（晋升路径：telemetry → 离线 review → promote）。
   * 用 preprocess 把一切非显式 true 的值（缺省 / 字符串 / 数字）清洗为 false，与 generateOpenQuestions 同口径。
   */
  runtimeVariantEnabled: z.preprocess((v) => v === true, z.boolean().default(false)),
  masteryThreshold: z.number().int().min(0).max(100).default(75),
  disabledCategories: z.array(z.string()).default([]),
  proficiency: proficiencyConfigSchema.default(DEFAULT_PROFICIENCY),
  prompts: promptConfigSchema.optional(),
});

export type ProviderEntry = z.infer<typeof providerEntrySchema>;
export type AIConfig = z.infer<typeof aiConfigSchema>;

export function parseAIConfig(input: unknown): AIConfig {
  return aiConfigSchema.parse(input);
}

export function safeParseAIConfig(input: unknown) {
  return aiConfigSchema.safeParse(input);
}
