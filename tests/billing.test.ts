import { describe, expect, it } from 'vitest';
import {
  canChangeOpeningProgress,
  packageProgress,
  packageUnitShare,
} from '../src/modules/tutoring/domain/billing';

describe('package billing', () => {
  it('allocates every penny of a package exactly once', () => {
    const total = 10001;
    const size = 8;
    const shares = Array.from({ length: size }, (_, index) =>
      packageUnitShare(total, size, index + 1),
    );

    expect(shares.reduce((sum, value) => sum + value, 0)).toBe(total);
    expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
  });

  it('combines opening progress with real lessons', () => {
    expect(packageProgress(8, 3, 2)).toEqual({
      size: 8,
      openingCompleted: 3,
      realCompleted: 2,
      completed: 5,
      remaining: 3,
      nextPosition: 6,
      due: false,
    });
    expect(packageProgress(8, 3, 5).due).toBe(true);
    expect(packageProgress(8, 3, 5).nextPosition).toBeNull();
  });

  it('does not silently rewrite opening history after real lessons begin', () => {
    expect(canChangeOpeningProgress(3, 4, 0)).toBe(true);
    expect(canChangeOpeningProgress(3, 3, 2)).toBe(true);
    expect(canChangeOpeningProgress(3, 4, 2)).toBe(false);
  });

  it('rejects impossible progress', () => {
    expect(() => packageProgress(8, 9, 0)).toThrow();
    expect(() => packageProgress(8, 4, 5)).toThrow();
  });
});
