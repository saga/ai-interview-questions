import { questionBank } from '../src/data/questionBank.ts';
import { knowledgeNodes } from '../src/data/knowledgeMap.ts';
import { resolveKnowledgeTargetsForQuestion } from '../src/domain/learner.ts';

const nodesByTopic = new Map<string, typeof knowledgeNodes>();
for (const node of knowledgeNodes) {
  const group = nodesByTopic.get(node.topic) ?? [];
  group.push(node);
  nodesByTopic.set(node.topic, group);
}

const bySource = new Map<string, number>();
const byReason = new Map<string, number>();
const unresolvedByTopic = new Map<string, { count: number; candidates: Set<string>; questionIds: string[] }>();
let mapped = 0;
for (const question of questionBank.questions) {
  const resolution = resolveKnowledgeTargetsForQuestion(question);
  bySource.set(resolution.source, (bySource.get(resolution.source) ?? 0) + 1);
  if (resolution.targets.length > 0) {
    mapped++;
    continue;
  }
  const reason = resolution.reason ?? 'unknown';
  byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
  const key = question.courseId ? `${question.courseId}:${question.topic}` : question.topic;
  const group = unresolvedByTopic.get(key) ?? { count: 0, candidates: new Set<string>(), questionIds: [] };
  group.count++;
  for (const node of nodesByTopic.get(question.topic) ?? []) group.candidates.add(node.id);
  if (group.questionIds.length < 8) group.questionIds.push(question.id);
  unresolvedByTopic.set(key, group);
}

const total = questionBank.questions.length;
const report = {
  totalQuestions: total,
  mappedQuestions: mapped,
  unmappedQuestions: total - mapped,
  mappingRate: total ? Number((mapped / total * 100).toFixed(2)) : 100,
  bySource: Object.fromEntries([...bySource].sort(([a], [b]) => a.localeCompare(b))),
  byReason: Object.fromEntries([...byReason].sort(([a], [b]) => a.localeCompare(b))),
  unresolvedTopics: [...unresolvedByTopic]
    .map(([topic, value]) => ({ topic, count: value.count, candidateKnowledgeIds: [...value.candidates].sort(), sampleQuestionIds: value.questionIds }))
    .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic)),
};
console.log(JSON.stringify(report, null, 2));
