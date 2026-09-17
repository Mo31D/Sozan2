import type { SimpleWorkspaceData } from '../data';
import type { ScheduledEntry } from './types';
import { addDays, scheduleEntriesForDate } from './utils';

export type PendingAttendanceReview = ScheduledEntry & { assumedCompleted: true };

/**
 * Past recurring lessons are treated as visually assumed-completed until the
 * tutor confirms or cancels them. No finance/package mutation is created by
 * this projection; canonical attendance is written only after confirmation.
 */
export function pendingAttendanceReviews(
  data: SimpleWorkspaceData,
  today: string,
  lookbackDays = 30,
): PendingAttendanceReview[] {
  const reviews: PendingAttendanceReview[] = [];
  const days = Math.max(1, Math.min(90, Math.trunc(lookbackDays)));

  for (let offset = 1; offset <= days; offset += 1) {
    const date = addDays(today, -offset);
    for (const entry of scheduleEntriesForDate(data, date)) {
      if (entry.status !== 'scheduled') continue;
      reviews.push({ ...entry, assumedCompleted: true });
    }
  }

  return reviews.sort((a, b) => b.date.localeCompare(a.date) || (a.startTime ?? '99:99').localeCompare(b.startTime ?? '99:99'));
}
