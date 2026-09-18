import type { RecurringSession } from './session';

export type CompletedSessionFinancials = {
  grossPence: number;
  centerCutPence: number;
  earnedPence: number;
};

/**
 * Computes money from participants known to belong to the completed lesson.
 * expectedStudentCount is deliberately not accepted here: it is planning
 * metadata, not evidence that somebody attended or should be charged.
 */
export function completedSessionFinancials(
  session: Pick<RecurringSession, 'priceBasis' | 'defaultPricePence' | 'centerCutBps'>,
  participantCount: number,
): CompletedSessionFinancials {
  if (!Number.isSafeInteger(participantCount) || participantCount < 0) {
    throw new Error('SESSION_PARTICIPANT_COUNT_INVALID');
  }
  const grossPence = session.priceBasis === 'per_student'
    ? session.defaultPricePence * participantCount
    : session.defaultPricePence;
  const centerCutPence = Math.floor((grossPence * session.centerCutBps) / 10_000);
  return {
    grossPence,
    centerCutPence,
    earnedPence: Math.max(0, grossPence - centerCutPence),
  };
}
