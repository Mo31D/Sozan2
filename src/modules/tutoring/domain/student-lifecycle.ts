import type { RecurringSession } from './session';

export type StudentArchiveSessionChange =
  | { kind: 'unchanged'; session: RecurringSession }
  | { kind: 'deactivated'; session: RecurringSession }
  | { kind: 'detached'; session: RecurringSession };

/**
 * Archiving a student must preserve history while removing future work:
 * - a session that only belongs to this student is deactivated, but keeps its
 *   participant link so historical context remains recoverable;
 * - a shared session remains active and only detaches this student;
 * - if the archived student was the total-session payer, the payer becomes
 *   explicitly unknown rather than being guessed from the remaining students.
 */
export function archiveStudentFromRecurringSession(
  session: RecurringSession,
  studentId: string,
): StudentArchiveSessionChange {
  if (!session.active || !session.studentIds.includes(studentId)) {
    return { kind: 'unchanged', session };
  }

  const remaining = session.studentIds.filter((id) => id !== studentId);
  if (remaining.length === 0) {
    return {
      kind: 'deactivated',
      session: {
        ...session,
        active: false,
      },
    };
  }

  return {
    kind: 'detached',
    session: {
      ...session,
      studentIds: remaining,
      payerStudentId: session.payerStudentId === studentId ? null : session.payerStudentId,
      expectedStudentCount: Math.max(
        1,
        remaining.length,
        session.expectedStudentCount - 1,
      ),
    },
  };
}
