import type { RecurringSession } from '../../../modules/tutoring/domain/session';
import type { LocalOccurrence } from '../data';

export type PageKey = 'today' | 'money' | 'schedule' | 'manage';
export type MoneyMode = 'none' | 'receipt' | 'expense';
export type ScheduleMode = 'week' | 'month' | 'free' | 'edit';
export type AddDraft = { weekday: number; startTime: string } | null;

export type ScheduledEntry = {
  session: RecurringSession;
  occurrence: LocalOccurrence | null;
  date: string;
  startTime: string | null;
  status: LocalOccurrence['status'] | 'scheduled';
};
