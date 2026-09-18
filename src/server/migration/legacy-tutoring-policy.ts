import { studentOccurrenceTargetId } from '../../modules/tutoring/domain/finance-target';

export type LegacyPriceBasis = 'total_session' | 'per_student';

export function uniqueLegacyParticipants(ids: readonly string[]): string[] {
  return [...new Set(ids.filter(Boolean))];
}

export function legacyTotalSessionPayer(
  priceBasis: LegacyPriceBasis,
  participantIds: readonly string[],
): string | null {
  const participants = uniqueLegacyParticipants(participantIds);
  return priceBasis === 'total_session' && participants.length === 1
    ? participants[0]
    : null;
}

export function legacyOccurrenceAllocationTarget(
  occurrenceId: string,
  payerStudentId: string | null | undefined,
  participantIds: readonly string[],
): { type: 'student_occurrence'; id: string } | null {
  if (!payerStudentId) return null;
  const participants = uniqueLegacyParticipants(participantIds);
  if (!participants.includes(payerStudentId)) return null;
  return {
    type: 'student_occurrence',
    id: studentOccurrenceTargetId(occurrenceId, payerStudentId),
  };
}
