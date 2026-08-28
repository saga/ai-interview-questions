import { z } from 'zod';
import { knowledgeAreaSchema, knowledgePrioritySchema, questionAngleSchema } from './common';

export const knowledgeNodeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  area: knowledgeAreaSchema,
  // 域（area）下的中间层级主题，如 Inference / RAG / Agents（见 src/data/taxonomy.ts）。
  // 与 id（Concept slug）共同构成 Domain → Topic → Concept 三级路径。
  topic: z.string().min(1),
  priority: knowledgePrioritySchema,
  summary: z.string().min(1),
  required: z.array(z.string().min(1)),
  misconceptions: z.array(z.string()),
  angles: z.array(questionAngleSchema),
});

export type KnowledgeNode = z.infer<typeof knowledgeNodeSchema>;

export const knowledgeBankSchema = z.array(knowledgeNodeSchema);

export function parseKnowledgeNode(input: unknown): KnowledgeNode {
  return knowledgeNodeSchema.parse(input);
}

export function parseKnowledgeBank(input: unknown): KnowledgeNode[] {
  const result = knowledgeBankSchema.safeParse(input);
  if (!result.success) throw result.error;
  return result.data;
}
