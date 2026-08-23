import { z } from 'zod';

export const edgeTypeSchema = z.enum(['prerequisite', 'related']);

export const conceptEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  type: edgeTypeSchema,
});

export const conceptGraphSchema = z.object({
  edges: z.array(conceptEdgeSchema),
});

export type ConceptEdge = z.infer<typeof conceptEdgeSchema>;
export type ConceptGraph = z.infer<typeof conceptGraphSchema>;

export function parseConceptGraph(input: unknown): ConceptGraph {
  return conceptGraphSchema.parse(input);
}
