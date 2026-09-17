import { describe, expect, it } from 'vitest';
import { freeSlotFits } from '../src/client/simple/v2/screens/schedule/free-time';

describe('free-time availability threshold', () => {
  it('requires two hours for a standard 90 minute lesson plus 30 minute travel window', () => {
    expect(freeSlotFits(9 * 60, 10 * 60, 120)).toBe(false);
    expect(freeSlotFits(9 * 60, 10 * 60 + 30, 120)).toBe(false);
    expect(freeSlotFits(9 * 60, 11 * 60, 120)).toBe(true);
  });

  it('supports shorter no-travel lessons and longer shared appointments explicitly', () => {
    expect(freeSlotFits(9 * 60, 10 * 60 + 30, 90)).toBe(true);
    expect(freeSlotFits(9 * 60, 11 * 60 + 59, 180)).toBe(false);
    expect(freeSlotFits(9 * 60, 12 * 60, 180)).toBe(true);
  });
});
