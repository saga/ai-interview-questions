import { db, type QuestionReviewRating, type StoredQuestionReview } from './db';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

function intervalHours(
  rating: QuestionReviewRating,
  previous?: StoredQuestionReview,
): number {
  switch (rating) {
    case 'again':
      return 1 / 6; // 10 minutes: a short retry window
    case 'hard':
      return previous && previous.repetitions > 0
        ? Math.max(24, previous.intervalHours * 1.2)
        : 24;
    case 'good':
      return previous && previous.repetitions > 0
        ? Math.max(72, previous.intervalHours * 2.2)
        : 72;
    case 'easy':
      return previous && previous.repetitions > 0
        ? Math.max(168, previous.intervalHours * 3)
        : 168;
  }
}

/** Record a learner's recall rating and schedule the next review.
 * This table is intentionally separate from LearnerProfile and assessment mastery.
 */
export async function recordQuestionReviewRating(
  trackId: string,
  questionId: string,
  rating: QuestionReviewRating,
  now = Date.now(),
): Promise<StoredQuestionReview | null> {
  const id = `${trackId}:${questionId}`;
  try {
    return await db.transaction('rw', db.questionReviews, async () => {
      const previous = await db.questionReviews.get(id);
      const hours = intervalHours(rating, previous);
      const row: StoredQuestionReview = {
        id,
        trackId,
        questionId,
        intervalHours: hours,
        repetitions: rating === 'again' ? 0 : (previous?.repetitions ?? 0) + 1,
        lastRating: rating,
        lastReviewedAt: now,
        dueAt: now + hours * HOUR_MS,
        updatedAt: now,
      };
      await db.questionReviews.put(row);
      return row;
    });
  } catch {
    return null;
  }
}

/** Return due questions for one LearningTrack, oldest due first. */
export async function getDueQuestionReviews(
  trackId: string,
  now = Date.now(),
  limit = 20,
): Promise<StoredQuestionReview[]> {
  try {
    const rows = await db.questionReviews
      .where('trackId')
      .equals(trackId)
      .filter((row) => row.dueAt <= now)
      .sortBy('dueAt');
    return rows.slice(0, Math.max(0, limit));
  } catch {
    return [];
  }
}
