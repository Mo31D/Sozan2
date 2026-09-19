import { describe, expect, it } from 'vitest';
import type { ScheduledEntry } from '../src/client/simple/v2/types';
import {
  activeBandIndex,
  layoutWeekGridEntries,
  saturdayWeekDates,
  saturdayWeekStart,
  WEEK_GRID_DAY_ORDER,
} from '../src/client/simple/v2/screens/schedule/week-grid';
import type { RecurringSession } from '../src/modules/tutoring/domain/session';

const workspaceId = '10000000-0000-4000-8000-000000000001';

function entry(
  id: string,
  startTime: string | null,
  durationMinutes: number,
  travelMinutes = 0,
): ScheduledEntry {
  const session: RecurringSession = {
    id,
    workspaceId,
    title: id,
    sessionType: 'private_student_home',
    scheduleStatus: 'confirmed',
    weekday: 1,
    startTime,
    durationMinutes,
    travelMinutes,
    location: null,
    priceBasis: 'total_session',
    defaultPricePence: 0,
    expectedStudentCount: 1,
    centerCutBps: 0,
    active: true,
    studentIds: [],
    payerStudentId: null,
  };
  return {
    session,
    occurrence: null,
    date: '2026-09-14',
    startTime,
    status: 'scheduled',
  };
}

describe('weekly timetable grid', () => {
  it('uses Saturday through Friday without changing domain weekday numbering', () => {
    expect(WEEK_GRID_DAY_ORDER).toEqual([6, 0, 1, 2, 3, 4, 5]);
    expect(saturdayWeekStart('2026-09-17')).toBe('2026-09-12');
    expect(saturdayWeekDates('2026-09-17')).toEqual([
      '2026-09-12',
      '2026-09-13',
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
      '2026-09-17',
      '2026-09-18',
    ]);
  });

  it('positions a 09:00 90-minute lesson proportionally inside the 08:00–23:00 axis', () => {
    const { visible, outside } = layoutWeekGridEntries([
      entry('session-a', '09:00', 90),
    ]);

    expect(outside).toHaveLength(0);
    expect(visible).toHaveLength(1);
    expect(visible[0].topPercent).toBeCloseTo(6.666667, 4);
    expect(visible[0].heightPercent).toBeCloseTo(10, 4);
  });

  it('keeps a lesson that crosses a 3-hour visual band as one continuous block', () => {
    const { visible } = layoutWeekGridEntries([
      entry('session-a', '10:30', 90),
    ]);

    expect(visible).toHaveLength(1);
    expect(visible[0].startMinute).toBe(630);
    expect(visible[0].endMinute).toBe(720);
    expect(visible[0].heightPercent).toBeCloseTo(10, 4);
  });

  it('keeps teaching time separate while using travel buffers to reserve timetable lanes', () => {
    const { visible } = layoutWeekGridEntries([
      entry('session-a', '10:00', 60, 30),
      entry('session-b', '11:05', 60, 0),
    ]);

    const a = visible.find((row) => row.entry.session.id === 'session-a');
    const b = visible.find((row) => row.entry.session.id === 'session-b');

    expect(a?.startMinute).toBe(10 * 60);
    expect(a?.endMinute).toBe(11 * 60);
    expect(a?.travelBeforeMinutes).toBe(15);
    expect(a?.travelAfterMinutes).toBe(15);
    expect(a?.occupiedStartMinute).toBe(9 * 60 + 45);
    expect(a?.occupiedEndMinute).toBe(11 * 60 + 15);
    expect(a?.visibleTravelBeforeStartMinute).toBe(9 * 60 + 45);
    expect(a?.visibleTravelBeforeEndMinute).toBe(10 * 60);
    expect(a?.visibleTravelAfterStartMinute).toBe(11 * 60);
    expect(a?.visibleTravelAfterEndMinute).toBe(11 * 60 + 15);
    expect(a?.laneCount).toBe(2);
    expect(b?.laneCount).toBe(2);
    expect(a?.lane).not.toBe(b?.lane);
  });

  it('places overlapping lessons in separate lanes and returns to full width afterward', () => {
    const { visible } = layoutWeekGridEntries([
      entry('session-a', '10:00', 90),
      entry('session-b', '10:30', 60),
      entry('session-c', '13:00', 60),
    ]);

    const a = visible.find((row) => row.entry.session.id === 'session-a');
    const b = visible.find((row) => row.entry.session.id === 'session-b');
    const c = visible.find((row) => row.entry.session.id === 'session-c');

    expect(a?.laneCount).toBe(2);
    expect(b?.laneCount).toBe(2);
    expect(a?.lane).not.toBe(b?.lane);
    expect(c?.laneCount).toBe(1);
  });

  it('shows evening lessons through 23:00 and keeps only truly outside/unknown lessons out of the grid', () => {
    const result = layoutWeekGridEntries([
      entry('early', '07:30', 90),
      entry('eight-pm', '20:00', 60),
      entry('nine-thirty', '21:30', 90),
      entry('late-clipped', '22:30', 90),
      entry('outside', '23:00', 60),
      entry('unknown', null, 60),
    ]);

    expect(result.visible).toHaveLength(4);
    expect(result.outside.map((row) => row.session.id)).toEqual(['outside', 'unknown']);
    expect(result.visible.find((row) => row.entry.session.id === 'early')?.clippedBefore).toBe(true);
    expect(result.visible.find((row) => row.entry.session.id === 'late-clipped')?.clippedAfter).toBe(true);
    expect(result.visible.find((row) => row.entry.session.id === 'eight-pm')?.clippedAfter).toBe(false);
    expect(result.visible.find((row) => row.entry.session.id === 'nine-thirty')?.clippedAfter).toBe(false);
  });

  it('activates exactly one of the five 3-hour time bands from 08:00 to 23:00', () => {
    expect(activeBandIndex(8 * 60)).toBe(0);
    expect(activeBandIndex(10 * 60 + 59)).toBe(0);
    expect(activeBandIndex(11 * 60)).toBe(1);
    expect(activeBandIndex(14 * 60)).toBe(2);
    expect(activeBandIndex(17 * 60)).toBe(3);
    expect(activeBandIndex(20 * 60)).toBe(4);
    expect(activeBandIndex(22 * 60 + 59)).toBe(4);
    expect(activeBandIndex(23 * 60)).toBeNull();
  });
});
