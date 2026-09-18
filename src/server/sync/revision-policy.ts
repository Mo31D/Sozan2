export type MutationIdentity = { id: string };

export type IdempotencyPartition<T extends MutationIdentity> = {
  done: T[];
  unapplied: T[];
};

export function partitionByCompletedIdempotency<T extends MutationIdentity>(
  mutations: readonly T[],
  completedMutationIds: ReadonlySet<string>,
): IdempotencyPartition<T> {
  const done: T[] = [];
  const unapplied: T[] = [];
  for (const mutation of mutations) {
    (completedMutationIds.has(mutation.id) ? done : unapplied).push(mutation);
  }
  return { done, unapplied };
}

export function requiresRevisionReservation<T extends MutationIdentity>(
  partition: IdempotencyPartition<T>,
): boolean {
  return partition.unapplied.length > 0;
}
