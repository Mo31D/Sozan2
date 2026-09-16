export type ScheduleStatus = 'confirmed' | 'pending';

export type RecurringScheduleState = {
  status: ScheduleStatus;
  weekday: number | null;
  startTime: string | null;
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidWeekday(value: number | null): boolean {
  return value === null || (Number.isInteger(value) && value >= 0 && value <= 6);
}

export function isValidTime(value: string | null): boolean {
  return value === null || TIME_RE.test(value);
}

export function canGenerateOccurrences(schedule: RecurringScheduleState): boolean {
  return schedule.status === 'confirmed'
    && schedule.weekday !== null
    && isValidWeekday(schedule.weekday)
    && schedule.startTime !== null
    && isValidTime(schedule.startTime);
}

export function validateRecurringSchedule(schedule: RecurringScheduleState): void {
  if (!isValidWeekday(schedule.weekday)) throw new Error('Weekday must be between 0 and 6');
  if (!isValidTime(schedule.startTime)) throw new Error('Start time must use HH:MM');
  if (schedule.status === 'confirmed' && !canGenerateOccurrences(schedule)) {
    throw new Error('Confirmed schedules require a weekday and start time');
  }
}

export function effectiveOccurrenceDate(
  sessionDate: string,
  rescheduledToDate: string | null,
): string {
  return rescheduledToDate ?? sessionDate;
}

export function effectiveOccurrenceStart(
  scheduledStart: string | null,
  recurringStart: string | null,
  rescheduledToStart: string | null,
): string | null {
  return rescheduledToStart ?? scheduledStart ?? recurringStart;
}
