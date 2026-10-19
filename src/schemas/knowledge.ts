import { z } from 'zod';
import { knowledgeAreaSchema, knowledgePrioritySchema, questionAngleSchema } from './common.ts';

export const knowledgeNodeSchema = z.object({
  id: z.string().min(1),
  /** 顶层学习体系 id；存量 AI 节点缺省时按 ai 处理。 */
  courseId: z.string().min(1).optional(),
  name: z.string().min(1),
  area: knowledgeAreaSchema,
  // AI 节点中的 area 是 AI 能力域；Snowflake 节点通过 courseId 归入独立课程，area=data-platform 仅作课程内分类元数据。
  // topic 表示所属主题，id 是课程内知识点（Concept）标识。
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
