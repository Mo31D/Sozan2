import { describe, expect, it } from 'vitest';
import {
  legacyOccurrenceAllocationTarget,
  legacyTotalSessionPayer,
  uniqueLegacyParticipants,
} from '../src/server/migration/legacy-tutoring-policy';

describe('Sozan1 tutoring migration policy', () => {
  it('deduplicates repeated legacy session rows into one participant list', () => {
    expect(uniqueLegacyParticipants(['student-a', 'student-a', 'student-b']))
      .toEqual(['student-a', 'student-b']);
  });

  it('infers a total-session payer only when ownership is unambiguous', () => {
    expect(legacyTotalSessionPayer('total_session', ['student-a'])).toBe('student-a');
    expect(legacyTotalSessionPayer('total_session', ['student-a', 'student-b'])).toBeNull();
    expect(legacyTotalSessionPayer('per_student', ['student-a'])).toBeNull();
  });

  it('maps legacy occurrence allocations to payer-scoped targets only for a linked participant', () => {
    expect(legacyOccurrenceAllocationTarget(
      'occurrence-1',
      'student-a',
      ['student-a', 'student-b'],
    )).toEqual({
      type: 'student_occurrence',
      id: 'occurrence-1:student-a',
    });

    expect(legacyOccurrenceAllocationTarget(
      'occurrence-1',
      'student-c',
      ['student-a', 'student-b'],
    )).toBeNull();

    expect(legacyOccurrenceAllocationTarget(
      'occurrence-1',
      null,
      ['student-a'],
    )).toBeNull();
  });
});
