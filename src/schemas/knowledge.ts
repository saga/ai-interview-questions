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
  // 概念地图（可选，PR0 实验引入）：把本知识节点拆出的子概念“面”，
  // 用于 concept-coverage —— 让抽题从“选哪道题”变成“先选最该验证哪个 concept”。
  // 与 Question.tests 配套；当前仅 transformer 节点试点，不强制其它节点。
  concepts: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        importance: z.number().min(0).max(1),
      }),
    )
    .optional(),
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
