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

export type TravelBuffer = {
  before: number;
  after: number;
};

/**
 * travelMinutes is the total transition allowance for one lesson.
 * By default it is split around the lesson so reports keep counting the same
 * total travel time while the planner can show the unavailable time on both sides.
 */
export function splitTravelMinutes(totalMinutes: number | null | undefined): TravelBuffer {
  const total = Math.max(0, Math.round(Number(totalMinutes ?? 0)));
  const before = Math.floor(total / 2);
  return { before, after: total - before };
}

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
  const travel = splitTravelMinutes(session.travelMinutes);
  const duration = Math.max(0, Number(session.durationMinutes || 0));
  return {
    start: Math.max(0, start - travel.before),
    end: Math.min(24 * 60, start + duration + travel.after),
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
