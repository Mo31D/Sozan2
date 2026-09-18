import { studentOccurrenceTargetId } from '../tutoring/domain/finance-target';
import {
  probableDuplicateExpenseIds,
  type ExpenseDuplicateCandidate,
} from '../finance/duplicate-detection';

export type ReportInsight = {
  key: string;
  level: 'info' | 'attention' | 'good';
  title: string;
  detail: string;
};

export type ReportPreset = 'week' | 'month' | 'last28' | 'custom';

export type ReportDateRange = {
  preset: ReportPreset;
  fromDate: string;
  toDate: string;
  label: string;
};

export type WorkspaceReport = {
  fromDate: string;
  toDate: string;
  completedLessons: number;
  cancelledLessons: number;
  receivedPence: number;
  otherIncomePence: number;
  expensesPence: number;
  netCashPence: number;
  /** Current outstanding amount, intentionally independent from the report date range. */
  duePence: number;
  earnedPence: number;
  teachingMinutes: number;
  travelMinutes: number;
  workMinutes: number;
  effectiveHourlyPence: number;
  insights: ReportInsight[];
};

type ReportExpense = {
  id?: string;
  expenseDate: string;
  scope?: 'business' | 'personal';
  category?: string;
  amountPence: number;
  deletedAt?: string | null;
};

export type ReportInput = {
  sessions: Array<{
    id: string;
    scheduleStatus: 'confirmed' | 'pending';
    durationMinutes: number;
    travelMinutes: number;
    studentIds?: string[];
    priceBasis?: 'total_session' | 'per_student';
    defaultPricePence?: number;
    expectedStudentCount?: number;
  }>;
  occurrences: Array<{
    id?: string;
    recurringSessionId: string;
    sessionDate: string;
    rescheduledToDate: string | null;
    status: 'scheduled' | 'completed' | 'cancelled' | 'missed';
    grossPence?: number;
    earnedPence: number;
    studentIds?: string[];
    durationMinutesSnapshot?: number | null;
    travelMinutesSnapshot?: number | null;
    priceBasisSnapshot?: 'total_session' | 'per_student' | null;
    defaultPricePenceSnapshot?: number | null;
    payerStudentIdSnapshot?: string | null;
  }>;
  receipts: Array<{ receivedAt: string; amountPence: number }>;
  expenses: ReportExpense[];
  otherIncome: Array<{ incomeDate: string; amountPence: number }>;
  billingPlans?: Array<{ studentId: string; billingMode: 'per_session' | 'package' }>;
  billingCycles: Array<{ id: string; status: 'open' | 'due' | 'paid' | 'cancelled'; pricePence: number }>;
  allocations: Array<{ targetId: string; targetType?: string; amountPence: number }>;
};

export function localTodayIso(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function firstDayOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

function firstDayOfWeek(iso: string): string {
  const date = new Date(`${iso}T12:00:00Z`);
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  return addDays(iso, -mondayOffset);
}

function assertIsoDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new Error('REPORT_DATE_INVALID');
  return value;
}

export function reportRangeForPreset(
  preset: ReportPreset,
  today = localTodayIso(),
  custom?: { fromDate: string; toDate: string },
): ReportDateRange {
  const safeToday = assertIsoDate(today);
  if (preset === 'week') {
    return { preset, fromDate: firstDayOfWeek(safeToday), toDate: safeToday, label: 'هذا الأسبوع' };
  }
  if (preset === 'month') {
    return { preset, fromDate: firstDayOfMonth(safeToday), toDate: safeToday, label: 'هذا الشهر' };
  }
  if (preset === 'last28') {
    return { preset, fromDate: addDays(safeToday, -27), toDate: safeToday, label: 'آخر 28 يومًا' };
  }
  const requestedFrom = assertIsoDate(custom?.fromDate ?? safeToday);
  const requestedTo = assertIsoDate(custom?.toDate ?? safeToday);
  const fromDate = requestedFrom <= requestedTo ? requestedFrom : requestedTo;
  const toDate = requestedFrom <= requestedTo ? requestedTo : requestedFrom;
  return { preset, fromDate, toDate, label: 'فترة مخصصة' };
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

function expenseDuplicateCandidates(expenses: readonly ReportExpense[]): ExpenseDuplicateCandidate[] {
  return expenses.flatMap((expense) => {
    if (!expense.id || !expense.scope || typeof expense.category !== 'string') return [];
    return [{
      id: expense.id,
      expenseDate: expense.expenseDate,
      scope: expense.scope,
      category: expense.category,
      amountPence: expense.amountPence,
      deletedAt: expense.deletedAt ?? null,
    }];
  });
}

export function currentDuePence(data: ReportInput): number {
  let due = data.billingCycles.filter((cycle) => cycle.status === 'due').reduce((total, cycle) => {
    const allocated = sum(data.allocations
      .filter((row) => row.targetId === cycle.id && (!row.targetType || row.targetType === 'package_cycle'))
      .map((row) => row.amountPence));
    return total + Math.max(0, cycle.pricePence - allocated);
  }, 0);

  const planByStudent = new Map((data.billingPlans ?? []).map((plan) => [plan.studentId, plan.billingMode]));
  const sessionById = new Map(data.sessions.map((session) => [session.id, session]));

  for (const occurrence of data.occurrences.filter((row) => row.status === 'completed' && row.id)) {
    const session = sessionById.get(occurrence.recurringSessionId);
    if (!session) continue;

    const priceBasis = occurrence.priceBasisSnapshot ?? session.priceBasis;
    if (priceBasis === 'per_student') {
      const attendees = occurrence.studentIds ?? session.studentIds ?? [];
      const amount = Math.max(
        0,
        Number(occurrence.defaultPricePenceSnapshot ?? session.defaultPricePence ?? 0),
      );
      if (!amount) continue;

      for (const studentId of attendees) {
        if (planByStudent.get(studentId) !== 'per_session') continue;
        const targetId = studentOccurrenceTargetId(occurrence.id as string, studentId);
        const allocated = sum(data.allocations
          .filter((row) => row.targetId === targetId
            && (!row.targetType || row.targetType === 'student_occurrence'))
          .map((row) => row.amountPence));
        due += Math.max(0, amount - allocated);
      }
      continue;
    }

    const payerStudentId = occurrence.payerStudentIdSnapshot ?? session.payerStudentId ?? null;
    if (!payerStudentId || planByStudent.get(payerStudentId) !== 'per_session') continue;
    const obligation = Math.max(0, Number(occurrence.grossPence ?? occurrence.earnedPence ?? 0));
    if (!obligation) continue;
    const targetId = studentOccurrenceTargetId(occurrence.id as string, payerStudentId);
    const allocated = sum(data.allocations
      .filter((row) => row.targetId === targetId
        && (!row.targetType || row.targetType === 'student_occurrence'))
      .map((row) => row.amountPence));
    due += Math.max(0, obligation - allocated);
  }
  return due;
}

export function buildWorkspaceReportForRange(data: ReportInput, range: ReportDateRange): WorkspaceReport {
  const inRange = (value: string) => value.slice(0, 10) >= range.fromDate && value.slice(0, 10) <= range.toDate;
  const occurrences = data.occurrences.filter((row) => inRange(row.rescheduledToDate ?? row.sessionDate));
  const completed = occurrences.filter((row) => row.status === 'completed');
  const cancelled = occurrences.filter((row) => row.status === 'cancelled' || row.status === 'missed');
  const receivedPence = sum(data.receipts.filter((row) => inRange(row.receivedAt)).map((row) => row.amountPence));
  const expensesPence = sum(data.expenses.filter((row) => !row.deletedAt && inRange(row.expenseDate)).map((row) => row.amountPence));
  const otherIncomePence = sum(data.otherIncome.filter((row) => inRange(row.incomeDate)).map((row) => row.amountPence));
  const sessionById = new Map(data.sessions.map((session) => [session.id, session]));
  let teachingMinutes = 0;
  let travelMinutes = 0;
  for (const occurrence of completed) {
    const session = sessionById.get(occurrence.recurringSessionId);
    if (!session) continue;
    teachingMinutes += Math.max(0, Number(
      occurrence.durationMinutesSnapshot ?? session.durationMinutes ?? 0,
    ));
    travelMinutes += Math.max(0, Number(
      occurrence.travelMinutesSnapshot ?? session.travelMinutes ?? 0,
    ));
  }
  const duePence = currentDuePence(data);
  const netCashPence = receivedPence + otherIncomePence - expensesPence;
  const earnedPence = sum(completed.map((row) => row.earnedPence));
  const workMinutes = teachingMinutes + travelMinutes;
  const effectiveHourlyPence = workMinutes > 0 ? Math.round((earnedPence * 60) / workMinutes) : 0;
  const pendingSchedules = data.sessions.filter((row) => row.scheduleStatus === 'pending').length;
  const duplicateExpenseRows = probableDuplicateExpenseIds(expenseDuplicateCandidates(data.expenses)).size;

  const insights: ReportInsight[] = [];
  if (duePence > 0) insights.push({ key: 'due', level: 'attention', title: 'فيه تحصيل محتاج متابعة', detail: `${duePence} قرش مستحقة حاليًا على حصص أو باقات مكتملة.` });
  if (pendingSchedules > 0) insights.push({ key: 'pending', level: 'attention', title: 'مواعيد لسه غير محددة', detail: `${pendingSchedules} موعد محتاج يوم أو ساعة.` });
  if (duplicateExpenseRows > 0) insights.push({ key: 'duplicate-expenses', level: 'attention', title: 'راجعي المصروفات المتشابهة', detail: `${duplicateExpenseRows} تسجيلات مصروف متشابهة في التاريخ والنوع والتصنيف والمبلغ؛ ممكن يكون بينها تكرار.` });
  if (cancelled.length >= Math.max(3, Math.ceil(completed.length * 0.25))) insights.push({ key: 'cancelled', level: 'attention', title: 'الإلغاءات مرتفعة نسبيًا', detail: `${cancelled.length} حصة ألغيت أو فاتت خلال الفترة.` });
  if (travelMinutes > teachingMinutes && completed.length > 0) insights.push({ key: 'travel', level: 'attention', title: 'وقت الانتقال كبير', detail: 'وقت الانتقال خلال الفترة أكبر من وقت التدريس؛ راجعي تجميع المواعيد القريبة.' });
  if (completed.length > 0 && duePence === 0 && pendingSchedules === 0 && duplicateExpenseRows === 0) insights.push({ key: 'stable', level: 'good', title: 'الصورة مستقرة', detail: 'لا توجد مستحقات مكتملة غير مسددة ولا مواعيد معلقة حاليًا.' });
  if (!insights.length) insights.push({ key: 'start', level: 'info', title: 'التقرير جاهز', detail: 'كلما زادت الحصص والتحصيلات سيصبح التحليل أكثر فائدة.' });

  return {
    fromDate: range.fromDate,
    toDate: range.toDate,
    completedLessons: completed.length,
    cancelledLessons: cancelled.length,
    receivedPence,
    otherIncomePence,
    expensesPence,
    netCashPence,
    duePence,
    earnedPence,
    teachingMinutes,
    travelMinutes,
    workMinutes,
    effectiveHourlyPence,
    insights,
  };
}

export function buildWorkspaceReport(data: ReportInput, today = localTodayIso()): WorkspaceReport {
  return buildWorkspaceReportForRange(data, reportRangeForPreset('last28', today));
}
