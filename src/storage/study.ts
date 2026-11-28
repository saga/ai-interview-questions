import { db, type StoredStudyProgress } from './db';

/** Reading activity is not an assessment result and must not change LearnerProfile mastery. */
export async function getStudyProgress(trackId: string): Promise<StoredStudyProgress[]> {
  try {
    return await db.studyProgress.where('trackId').equals(trackId).toArray();
  } catch {
    return [];
  }
}

async function updateProgress(
  trackId: string,
  nodeId: string,
  update: (current: StoredStudyProgress) => StoredStudyProgress,
): Promise<StoredStudyProgress | null> {
  const id = `${trackId}:${nodeId}`;
  try {
    return await db.transaction('rw', db.studyProgress, async () => {
      const current = (await db.studyProgress.get(id)) ?? {
        id,
        trackId,
        nodeId,
        completedArticleIds: [],
        updatedAt: Date.now(),
      };
      const next = { ...update(current), updatedAt: Date.now() };
      await db.studyProgress.put(next);
      return next;
    });
  } catch {
    return null;
  }
}

export function recordArticleOpened(
  trackId: string,
  nodeId: string,
  articleId: string,
): Promise<StoredStudyProgress | null> {
  return updateProgress(trackId, nodeId, (current) => ({
    ...current,
    lastArticleId: articleId,
  }));
}

export function markArticleCompleted(
  trackId: string,
  nodeId: string,
  articleId: string,
): Promise<StoredStudyProgress | null> {
  return updateProgress(trackId, nodeId, (current) => ({
    ...current,
    completedArticleIds: [...new Set([...current.completedArticleIds, articleId])],
    lastArticleId: articleId,
  }));
}
