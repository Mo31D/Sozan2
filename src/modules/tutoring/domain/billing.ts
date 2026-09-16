export type PackageProgress = {
  size: number;
  openingCompleted: number;
  realCompleted: number;
  completed: number;
  remaining: number;
  nextPosition: number | null;
  due: boolean;
};

function assertCount(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
}

export function packageUnitShare(totalPence: number, size: number, position: number): number {
  if (!Number.isSafeInteger(totalPence) || totalPence < 0) {
    throw new Error('Package price must be non-negative integer pence');
  }
  if (!Number.isSafeInteger(size) || size < 1 || size > 100) {
    throw new Error('Package size must be an integer between 1 and 100');
  }
  if (!Number.isSafeInteger(position) || position < 1 || position > size) {
    throw new Error('Package position is outside the cycle');
  }

  return Math.floor((totalPence * position) / size)
    - Math.floor((totalPence * (position - 1)) / size);
}

export function packageProgress(
  size: number,
  openingCompleted: number,
  realCompleted: number,
): PackageProgress {
  if (!Number.isSafeInteger(size) || size < 1 || size > 100) {
    throw new Error('Package size must be an integer between 1 and 100');
  }
  assertCount(openingCompleted, 'Opening progress');
  assertCount(realCompleted, 'Real progress');

  if (openingCompleted > size) throw new Error('Opening progress cannot exceed package size');
  if (openingCompleted + realCompleted > size) {
    throw new Error('Package progress cannot exceed package size');
  }

  const completed = openingCompleted + realCompleted;
  const remaining = size - completed;

  return {
    size,
    openingCompleted,
    realCompleted,
    completed,
    remaining,
    nextPosition: remaining > 0 ? completed + 1 : null,
    due: completed === size,
  };
}

export function canChangeOpeningProgress(
  currentOpeningCompleted: number,
  requestedOpeningCompleted: number,
  realCompleted: number,
  openingProgressLocked = false,
): boolean {
  assertCount(currentOpeningCompleted, 'Current opening progress');
  assertCount(requestedOpeningCompleted, 'Requested opening progress');
  assertCount(realCompleted, 'Real progress');

  return currentOpeningCompleted === requestedOpeningCompleted
    || (!openingProgressLocked && realCompleted === 0);
}
