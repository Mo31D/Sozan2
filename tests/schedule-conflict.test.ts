import { describe, expect, it } from 'vitest';
import {
  occupiedScheduleInterval,
  sessionsConflict,
  splitTravelMinutes,
} from '../src/modules/tutoring/domain/schedule-conflict';

const base = {
  id: 'session-a',
  scheduleStatus: 'confirmed' as const,
  weekday: 1,
  startTime: '16:00',
  durationMinutes: 90,
  travelMinutes: 30,
};

describe('schedule conflict policy', () => {
  it('splits the total travel allowance before and after a lesson', () => {
    expect(splitTravelMinutes(30)).toEqual({ before: 15, after: 15 });
    expect(splitTravelMinutes(25)).toEqual({ before: 12, after: 13 });
    expect(occupiedScheduleInterval(base)).toEqual({
      start: 15 * 60 + 45,
      end: 17 * 60 + 45,
    });
  });

  it('catches an impossible transition even when teaching times do not overlap', () => {
    const next = {
      ...base,
      id: 'session-b',
      startTime: '17:30',
      durationMinutes: 60,
      travelMinutes: 30,
    };
    expect(sessionsConflict(base, next)).toBe(true);
    expect(sessionsConflict(base, {
      ...base,
      id: 'session-c',
      startTime: '17:45',
      durationMinutes: 60,
      travelMinutes: 0,
    })).toBe(false);
  });

  it('allows separate days and genuinely separated lessons', () => {
    expect(sessionsConflict(base, { ...base, id: 'other-day', weekday: 2 })).toBe(false);
    expect(sessionsConflict(base, { ...base, id: 'later', startTime: '18:30', travelMinutes: 0 })).toBe(false);
  });
});
