import type { RecurringSession } from '../../../modules/tutoring/domain/session';
import {
  activeCycleFor,
  planFor,
  type SimpleWorkspaceData,
} from '../data';
import type { ScheduledEntry } from './types';

export const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

export function scheduleEntriesForDate(data: SimpleWorkspaceData, date: string): ScheduledEntry[] {
  const weekday = weekdayForIso(date);
  const byId = new Map<string, ScheduledEntry>();

  for (const session of data.sessions) {
    if (session.scheduleStatus !== 'confirmed' || session.weekday !== weekday) continue;
    const occurrence = data.occurrences.find((row) => row.recurringSessionId === session.id && row.sessionDate === date) ?? null;
    if (occurrence?.rescheduledToDate && occurrence.rescheduledToDate !== date) continue;
    byId.set(session.id, {
      session,
      occurrence,
      date,
      startTime: validClockTime(occurrence?.scheduledStart)
        ? occurrence?.scheduledStart ?? null
        : validClockTime(session.startTime) ? session.startTime : null,
      status: occurrence?.status ?? 'scheduled',
    });
  }

  for (const occurrence of data.occurrences.filter((row) => row.rescheduledToDate === date)) {
    const session = data.sessions.find((row) => row.id === occurrence.recurringSessionId);
    if (!session) continue;
    byId.set(session.id, {
      session,
      occurrence,
      date,
      startTime: validClockTime(occurrence.rescheduledToStart)
        ? occurrence.rescheduledToStart
        : validClockTime(session.startTime) ? session.startTime : null,
      status: occurrence.status,
    });
  }

  return [...byId.values()].sort((a, b) =>
    (a.startTime ?? '99:99').localeCompare(b.startTime ?? '99:99')
    || a.session.title.localeCompare(b.session.title, 'ar'),
  );
}

export function recentMoneyRows(data: SimpleWorkspaceData, currencyLabel: string) {
  return [
    ...data.receipts.map((row) => ({
      id: `r-${row.id}`,
      date: row.receivedAt,
      kind: 'in' as const,
      title: data.students.find((student) => student.id === row.payerRefId)?.name
        ? `تحصيل من ${data.students.find((student) => student.id === row.payerRefId)?.name}`
        : 'تحصيل',
      value: `+ ${money(row.amountPence, currencyLabel)}`,
    })),
    ...data.expenses.map((row) => ({
      id: `e-${row.id}`,
      date: row.expenseDate,
      kind: 'out' as const,
      title: `مصروف · ${row.category}`,
      value: `− ${money(row.amountPence, currencyLabel)}`,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
}

export function dueTotal(data: SimpleWorkspaceData): number {
  return data.billingCycles.filter((cycle) => cycle.status === 'due').reduce((total, cycle) => {
    const allocated = data.allocations
      .filter((row) => row.targetId === cycle.id)
      .reduce((value, row) => value + row.amountPence, 0);
    return total + Math.max(0, cycle.pricePence - allocated);
  }, 0);
}

export function packageProgress(data: SimpleWorkspaceData, studentId: string): string {
  const plan = planFor(data, studentId);
  const cycle = activeCycleFor(data, studentId);
  const done = cycle ? cycle.openingCompletedCount + cycle.realCompletedCount : 0;
  const size = cycle?.sessionLimit ?? plan?.packageSize ?? 8;
  return `${done}/${size}`;
}

export function compareSessionTime(a: RecurringSession, b: RecurringSession): number {
  return (a.startTime ?? '99:99').localeCompare(b.startTime ?? '99:99') || a.title.localeCompare(b.title, 'ar');
}

export function sessionTypeLabel(type: RecurringSession['sessionType']): string {
  return ({
    private_student_home: 'خاص عند الطالب',
    private_tutor_home: 'خاص عند المدرس',
    online: 'أونلاين',
    center_group: 'السنتر',
    own_group: 'مجموعة خاصة',
  } as const)[type];
}

export function money(pence: number, label: string): string {
  return `${(pence / 100).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ${label}`;
}

export function sum(values: number[]): number {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

export function toPence(value: FormDataEntryValue | null, allowZero = false): number {
  const numeric = Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(numeric) || numeric < 0 || (!allowZero && numeric <= 0)) throw new Error('AMOUNT_INVALID');
  return Math.round(numeric * 100);
}

export function todayIso(): string {
  return localDate(new Date());
}

export function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDate(date);
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function weekdayForIso(iso: string): number {
  return new Date(`${iso}T12:00:00`).getDay();
}

export function validClockTime(value: string | null | undefined): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/u.test(String(value ?? ''));
}

export function timeToMinutes(value: string | null | undefined): number | null {
  if (!validClockTime(value)) return null;
  const [hours, minutes] = String(value).split(':').map(Number);
  return hours * 60 + minutes;
}

export function minutesToTime(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function arabicNumber(value: number, minimumIntegerDigits = 1): string {
  return value.toLocaleString('ar-EG-u-nu-arab', {
    useGrouping: false,
    minimumIntegerDigits,
  });
}

export function formatClockTime(value: string | null | undefined): string {
  const total = timeToMinutes(value);
  if (total === null) return 'غير محدد';
  const hour24 = Math.floor(total / 60) % 24;
  const minute = total % 60;
  const hour12 = hour24 % 12 || 12;
  const period = hour24 < 12 ? 'صباحًا' : 'مساءً';
  return minute === 0
    ? `${arabicNumber(hour12)} ${period}`
    : `${arabicNumber(hour12)}:${arabicNumber(minute, 2)} ${period}`;
}

export function formatDurationArabic(totalMinutes: number): string {
  const safe = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;
  if (hours === 0) return `${arabicNumber(minutes)} دقيقة`;

  const hourText = hours === 1
    ? 'ساعة'
    : hours === 2
      ? 'ساعتين'
      : hours >= 3 && hours <= 10
        ? `${arabicNumber(hours)} ساعات`
        : `${arabicNumber(hours)} ساعة`;

  return minutes === 0 ? hourText : `${hourText} و${arabicNumber(minutes)} دقيقة`;
}

export function formatArabicDate(iso: string): string {
  return new Intl.DateTimeFormat('ar-EG-u-nu-arab', { weekday: 'long', day: 'numeric', month: 'long' })
    .format(new Date(`${iso}T12:00:00`));
}

export function formatShortDate(value: string): string {
  const iso = value.slice(0, 10);
  try {
    return new Intl.DateTimeFormat('ar-EG-u-nu-arab', { day: 'numeric', month: 'short' })
      .format(new Date(`${iso}T12:00:00`));
  } catch {
    return iso;
  }
}

export function greetingForHour(hour: number): string {
  return hour < 12 ? 'صباح الخير' : 'مساء الخير';
}

export function messageFor(cause: unknown): string {
  const code = cause instanceof Error ? cause.message : 'UNKNOWN';
  const messages: Record<string, string> = {
    AMOUNT_INVALID: 'اكتبي مبلغًا صحيحًا.',
    EXPENSE_AMOUNT_INVALID: 'اكتبي مبلغ المصروف بشكل صحيح.',
    EXPENSE_CATEGORY_REQUIRED: 'اكتبي تصنيف المصروف.',
    BILLING_MODE_LOCKED_BY_HISTORY: 'لا يمكن تغيير نظام الحساب بعد وجود تاريخ مالي؛ يمكن تعديل تفاصيل الباقة نفسها.',
    OPENING_PROGRESS_EXCEEDS_PACKAGE: 'عدد الحصص المكتملة لا يمكن أن يتجاوز حجم الدورة الحالية.',
    OPENING_PROGRESS_LOCKED_BY_REAL_LESSONS: 'بعد تسجيل حصص جديدة، تقدم البداية بيتقفل والتقدم الحالي بيتحدث تلقائيًا.',
    OCCURRENCE_STATE_INVALID: 'حالة الحصة لا تسمح بهذا التعديل.',
    SESSION_NOT_FOUND: 'الموعد لم يعد موجودًا.',
    SCHEDULE_DAY_REQUIRED: 'اختاري يومًا للموعد المؤكد.',
    SCHEDULE_TIME_REQUIRED: 'اختاري وقتًا للموعد المؤكد.',
    COMPLETED_REQUIRES_CORRECTION_FLOW: 'الحصة مكتملة؛ استخدمي إعادة الفتح قبل تعديلها.',
    CORRECTION_REQUIRES_SYNC: 'يلزم مزامنة الحساب مرة واحدة قبل تصحيح هذه الحصة القديمة.',
    ATTENDANCE_COMPLETED_COLLECTION_FAILED: 'الحصة اتسجلت كمكتملة، لكن التحصيل لم يُسجل. سجلي التحصيل مرة أخرى من نفس الحصة أو من «فلوسي».',
  };
  return messages[code] ?? `تعذر إكمال العملية (${code})`;
}
