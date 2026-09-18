import { describe, expect, it } from 'vitest';
import {
  partitionByCompletedIdempotency,
  requiresRevisionReservation,
} from '../src/server/sync/revision-policy';

describe('sync revision policy', () => {
  const mutations = [{ id: 'a' }, { id: 'b' }];

  it('does not reserve a new revision when a lost-response retry is already fully applied', () => {
    const partition = partitionByCompletedIdempotency(
      mutations,
      new Set(['a', 'b']),
    );
    expect(partition.done.map((row) => row.id)).toEqual(['a', 'b']);
    expect(partition.unapplied).toEqual([]);
    expect(requiresRevisionReservation(partition)).toBe(false);
  });

  it('reserves a revision only for genuinely unapplied work', () => {
    const partition = partitionByCompletedIdempotency(
      mutations,
      new Set(['a']),
    );
    expect(partition.done.map((row) => row.id)).toEqual(['a']);
    expect(partition.unapplied.map((row) => row.id)).toEqual(['b']);
    expect(requiresRevisionReservation(partition)).toBe(true);
  });
});
