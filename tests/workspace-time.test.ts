import { describe, expect, it } from 'vitest';
import { calendarDateInTimeZone } from '../src/platform/time/calendar-date';

describe('workspace calendar date', () => {
  it('uses the workspace timezone rather than UTC at the day boundary', () => {
    const instant = new Date('2026-09-17T23:30:00.000Z');

    expect(calendarDateInTimeZone('Europe/London', instant)).toBe('2026-09-18');
    expect(calendarDateInTimeZone('America/New_York', instant)).toBe('2026-09-17');
  });

  it('handles daylight-saving boundaries through the IANA timezone', () => {
    const instant = new Date('2026-03-29T23:30:00.000Z');
    expect(calendarDateInTimeZone('Europe/London', instant)).toBe('2026-03-30');
  });

  it('rejects an invalid workspace timezone instead of silently using server time', () => {
    expect(() => calendarDateInTimeZone('Not/A_Timezone', new Date()))
      .toThrow('WORKSPACE_TIMEZONE_INVALID');
  });
});
