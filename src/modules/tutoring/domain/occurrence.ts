import { z } from 'zod';

export const rescheduleOccurrenceSchema = z.object({
  date: z.string().date(),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u).nullable().default(null),
  note: z.string().trim().max(300).nullable().optional().default(null),
});

export const completeOccurrenceSchema = z.object({
  completedAt: z.string().min(10).max(40).optional(),
  note: z.string().trim().max(500).nullable().optional().default(null),
  participantStudentIds: z.array(z.string().uuid()).max(100).optional(),
});

export type OccurrenceStatus = 'scheduled' | 'completed' | 'cancelled' | 'missed';

export type TutoringOccurrence = {
  id: string;
  workspaceId: string;
  recurringSessionId: string;
  sessionDate: string;
  scheduledStart: string | null;
  rescheduledToDate: string | null;
  rescheduledToStart: string | null;
  status: OccurrenceStatus;
  grossPence: number;
  centerCutPence: number;
  earnedPence: number;
  completedAt: string | null;
  note: string | null;
  /** Students who actually attended this occurrence. */
  studentIds: string[];
  durationMinutesSnapshot: number | null;
  travelMinutesSnapshot: number | null;
  sessionTypeSnapshot: string | null;
  locationSnapshot: string | null;
  priceBasisSnapshot: 'total_session' | 'per_student' | null;
  defaultPricePenceSnapshot: number | null;
  payerStudentIdSnapshot: string | null;
};

export function datesForWeekday(from: string, to: string, weekday: number): string[] {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    throw new Error('INVALID_DATE_RANGE');
  }
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    throw new Error('INVALID_WEEKDAY');
  }

  const result: string[] = [];
  const cursor = new Date(start);
  const delta = (weekday - cursor.getUTCDay() + 7) % 7;
  cursor.setUTCDate(cursor.getUTCDate() + delta);
  while (cursor <= end) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return result;
}
