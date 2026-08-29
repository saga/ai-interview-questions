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

export const aiConfigSchema = z.object({
  providers: z.array(providerEntrySchema),
  generateOpenQuestions: z.preprocess((v) => v === true, z.boolean().default(false)),
  masteryThreshold: z.number().int().min(0).max(100).default(75),
});

export type ProviderEntry = z.infer<typeof providerEntrySchema>;
export type AIConfig = z.infer<typeof aiConfigSchema>;

export function parseAIConfig(input: unknown): AIConfig {
  return aiConfigSchema.parse(input);
}

export function safeParseAIConfig(input: unknown) {
  return aiConfigSchema.safeParse(input);
}
