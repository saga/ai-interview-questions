import type { QuestionBank } from '../types';
import type { Question } from '../schemas/question';
import type { KnowledgeNode } from '../schemas/knowledge';
import type { LearnerProfile, SessionRecord } from '../schemas/learner';
import { LEARNING_TRACKS, type LearningTrackId } from '../data/learningTracks';
import { knowledgeNodes } from '../data/knowledgeMap';
import { questionBank } from '../data/questionBank';

export function courseIdOfNode(node: KnowledgeNode): LearningTrackId | string {
  return node.courseId ?? (node.area === 'data-platform' ? 'snowflake' : 'ai');
}

export function courseIdOfQuestion(
  question: Question,
  nodesById: ReadonlyMap<string, KnowledgeNode>,
): LearningTrackId | string {
  if (question.courseId) return question.courseId;
  const node = nodesById.get(question.knowledgeId ?? question.topic);
  return node ? courseIdOfNode(node) : 'ai';
}

export function questionsForTrack(
  questions: Question[],
  trackId: LearningTrackId,
  nodes: KnowledgeNode[] = knowledgeNodes,
): Question[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  return questions.filter((question) => courseIdOfQuestion(question, nodesById) === trackId);
}

export function questionBankForTrack(
  bank: QuestionBank,
  trackId: LearningTrackId,
  nodes: KnowledgeNode[] = knowledgeNodes,
): QuestionBank {
  const questions = questionsForTrack(bank.questions, trackId, nodes);
  return { questions, categories: [...new Set(questions.map((question) => question.category))] };
}

/**
 * Select questions for one KnowledgeNode.
 * Newer question records carry an explicit knowledgeId; it is authoritative.
 * Legacy records without knowledgeId retain the old topic=nodeId convention.
 */
export function questionsForKnowledgeNode(
  questions: Question[],
  knowledgeNodeId: string,
): Question[] {
  return questions.filter((question) =>
    question.knowledgeId
      ? question.knowledgeId === knowledgeNodeId
      : question.topic === knowledgeNodeId,
  );
}

export function knowledgeForTrack(
  nodes: KnowledgeNode[],
  trackId: LearningTrackId,
): KnowledgeNode[] {
  return nodes.filter((node) => courseIdOfNode(node) === trackId);
}

function sessionBelongsToTrack(
  session: SessionRecord,
  trackId: LearningTrackId,
  topicKeys: ReadonlySet<string>,
): boolean {
  if (session.courseId) return session.courseId === trackId;
  // Backward compatibility for records saved before courseId existed: infer from their topic IDs.
  return session.questionResults.length > 0 && session.questionResults.every((result) =>
    result.courseId ? result.courseId === trackId : topicKeys.has(result.topic),
  );
}

/**
 * Project the global local-first learner profile onto one course.
 * Learner evidence can exist under Question.topic (the exact node ID) and under the
 * shared KnowledgeNode.topic key. Preserve both when projecting a course profile.
 * Session totals, recents and cross-topic evidence are projected separately.
 */
export function profileForTrack(
  profile: LearnerProfile,
  trackId: LearningTrackId,
  allNodes: KnowledgeNode[] = knowledgeNodes,
): LearnerProfile {
  const nodes = knowledgeForTrack(allNodes, trackId);
  // 当前题库 Question.topic / topicStats 可能按节点 ID 分桶；KnowledgeNode.topic
  // 则是共享上级分类。两种历史/当前键都需要保留，不能只投影 parent topic。
  const topicKeys = new Set(nodes.flatMap((node) => [node.id, node.topic]));
  const sessions = profile.sessions.filter((session) => sessionBelongsToTrack(session, trackId, topicKeys));
  const latestRated = sessions.filter((session) => session.questionResults.length > 0).slice(0, 10);
  const overallScore = latestRated.length
    ? Math.round(latestRated.reduce((sum, session) => sum + session.overall, 0) / latestRated.length)
    : 0;
  const filterTopicKeys = <T,>(source: Record<string, T> | undefined): Record<string, T> =>
    Object.fromEntries(Object.entries(source ?? {}).filter(([key]) =>
      [...topicKeys].some((topic) => key === topic || key.startsWith(`${topic}|`)),
    ));

  return {
    ...profile,
    totalSessions: sessions.filter((session) => session.questionResults.length > 0).length,
    totalQuestions: sessions.reduce((sum, session) => sum + session.questionResults.length, 0),
    overallScore,
    topicStats: Object.fromEntries(Object.entries(profile.topicStats).filter(([topic]) => topicKeys.has(topic))),
    knowledgeStats: Object.fromEntries(Object.entries(profile.knowledgeStats ?? {}).filter(([knowledgeId]) => nodes.some((node) => node.id === knowledgeId))),
    angleCoverage: filterTopicKeys(profile.angleCoverage),
    assessmentCoverage: filterTopicKeys(profile.assessmentCoverage),
    conceptEvidence: filterTopicKeys(profile.conceptEvidence),
    misconceptionHits: filterTopicKeys(profile.misconceptionHits),
    sessions,
  };
}

export function courseTopicIds(trackId: LearningTrackId): Set<string> {
  return new Set(knowledgeForTrack(knowledgeNodes, trackId).flatMap((node) => [node.id, node.topic]));
}

export function inferTrackForLegacySession(session: SessionRecord): LearningTrackId | null {
  for (const track of LEARNING_TRACKS) {
    const ids = courseTopicIds(track.id);
    if (sessionBelongsToTrack(session, track.id, ids)) return track.id;
  }
  return null;
}

/** Small explicit export keeps callers from having to reach into the global singleton. */
export function allQuestionsForTrack(trackId: LearningTrackId): Question[] {
  return questionsForTrack(questionBank.questions, trackId, knowledgeNodes);
}
