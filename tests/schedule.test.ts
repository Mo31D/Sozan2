import { describe, expect, it } from 'vitest';
import {
  canGenerateOccurrences,
  effectiveOccurrenceDate,
  effectiveOccurrenceStart,
  validateRecurringSchedule,
} from '../src/modules/tutoring/domain/schedule';

describe('schedule planning', () => {
  it('never generates occurrences from pending schedules', () => {
    expect(canGenerateOccurrences({ status: 'pending', weekday: 2, startTime: '16:30' })).toBe(false);
    expect(canGenerateOccurrences({ status: 'pending', weekday: null, startTime: null })).toBe(false);
  });

  it('generates only from complete confirmed schedules', () => {
    expect(canGenerateOccurrences({ status: 'confirmed', weekday: 2, startTime: '16:30' })).toBe(true);
    expect(canGenerateOccurrences({ status: 'confirmed', weekday: null, startTime: null })).toBe(false);
  });

  it('allows pending schedules without a final day or time', () => {
    expect(() => validateRecurringSchedule({ status: 'pending', weekday: null, startTime: null })).not.toThrow();
    expect(() => validateRecurringSchedule({ status: 'confirmed', weekday: null, startTime: null })).toThrow();
  });

  it('keeps one-off rescheduling separate from the recurring schedule', () => {
    expect(effectiveOccurrenceDate('2026-09-16', '2026-09-18')).toBe('2026-09-18');
    expect(effectiveOccurrenceDate('2026-09-16', null)).toBe('2026-09-16');
    expect(effectiveOccurrenceStart('15:00', '14:00', '17:30')).toBe('17:30');
    expect(effectiveOccurrenceStart(null, '14:00', null)).toBe('14:00');
  });
});
