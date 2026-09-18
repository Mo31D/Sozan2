export const STUDENT_OCCURRENCE_TARGET_TYPE = 'student_occurrence' as const;

/**
 * Finance allocations are scoped to both the lesson occurrence and the payer.
 * Using the occurrence id alone lets one student's payment accidentally satisfy
 * another student's debt in the same group lesson.
 */
export function studentOccurrenceTargetId(occurrenceId: string, studentId: string): string {
  return `${occurrenceId}:${studentId}`;
}

export function studentOccurrenceTarget(occurrenceId: string, studentId: string) {
  return {
    module: 'tutoring',
    type: STUDENT_OCCURRENCE_TARGET_TYPE,
    id: studentOccurrenceTargetId(occurrenceId, studentId),
  } as const;
}
