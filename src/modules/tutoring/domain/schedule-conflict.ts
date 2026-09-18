import type { RecurringSession } from './session';

export type SchedulableSession = Pick<
  RecurringSession,
  'id' | 'scheduleStatus' | 'weekday' | 'startTime' | 'durationMinutes' | 'travelMinutes'
>;

const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/u;

export type ScheduleInterval = {
  start: number;
  end: number;
};

/**
 * Reserve travel on both sides of a lesson. This is intentionally conservative:
 * travel is a transition requirement between appointments, not teaching time
 * that belongs only after one lesson.
 */
export function occupiedScheduleInterval(session: SchedulableSession): ScheduleInterval | null {
  if (
    session.scheduleStatus !== 'confirmed'
    || session.weekday === null
    || !session.startTime
    || !CLOCK_TIME.test(session.startTime)
  ) {
    return null;
  }
  const [hours, minutes] = session.startTime.split(':').map(Number);
  const start = hours * 60 + minutes;
  const travel = Math.max(0, Number(session.travelMinutes || 0));
  const duration = Math.max(0, Number(session.durationMinutes || 0));
  return {
    start: Math.max(0, start - travel),
    end: Math.min(24 * 60, start + duration + travel),
  };
}

export function sessionsConflict(left: SchedulableSession, right: SchedulableSession): boolean {
  if (left.id === right.id || left.weekday === null || left.weekday !== right.weekday) return false;
  const a = occupiedScheduleInterval(left);
  const b = occupiedScheduleInterval(right);
  if (!a || !b) return false;
  return a.start < b.end && b.start < a.end;
}

export function conflictingSessionIds(
  candidate: SchedulableSession,
  existing: readonly SchedulableSession[],
): string[] {
  return existing.filter((row) => sessionsConflict(candidate, row)).map((row) => row.id);
}

export function assertNoScheduleConflict(
  candidate: SchedulableSession,
  existing: readonly SchedulableSession[],
): void {
  if (conflictingSessionIds(candidate, existing).length) {
    throw new Error('SCHEDULE_CONFLICT');
  }
}
