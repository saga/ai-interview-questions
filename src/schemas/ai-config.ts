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
