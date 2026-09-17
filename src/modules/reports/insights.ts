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

export type WorkspaceReport = {
  fromDate: string;
  toDate: string;
  completedLessons: number;
  cancelledLessons: number;
  receivedPence: number;
  otherIncomePence: number;
  expensesPence: number;
  netCashPence: number;
  duePence: number;
  teachingMinutes: number;
  travelMinutes: number;
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

type ReportInput = {
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
  }>;
  receipts: Array<{ receivedAt: string; amountPence: number }>;
  expenses: ReportExpense[];
  otherIncome: Array<{ incomeDate: string; amountPence: number }>;
  billingPlans?: Array<{ studentId: string; billingMode: 'per_session' | 'package' }>;
  billingCycles: Array<{ id: string; status: 'open' | 'due' | 'paid' | 'cancelled'; pricePence: number }>;
  allocations: Array<{ targetId: string; amountPence: number }>;
};

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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

function currentDue(data: ReportInput): number {
  let due = data.billingCycles.filter((cycle) => cycle.status === 'due').reduce((total, cycle) => {
    const allocated = sum(data.allocations.filter((row) => row.targetId === cycle.id).map((row) => row.amountPence));
    return total + Math.max(0, cycle.pricePence - allocated);
  }, 0);

  const planByStudent = new Map((data.billingPlans ?? []).map((plan) => [plan.studentId, plan.billingMode]));
  const sessionById = new Map(data.sessions.map((session) => [session.id, session]));
  for (const occurrence of data.occurrences.filter((row) => row.status === 'completed' && row.id)) {
    const session = sessionById.get(occurrence.recurringSessionId);
    if (!session) continue;
    const perSessionStudents = (session.studentIds ?? []).filter((studentId) => (planByStudent.get(studentId) ?? 'per_session') === 'per_session');
    if (!perSessionStudents.length) continue;

    let obligation = 0;
    if (session.priceBasis === 'per_student') {
      obligation = Math.max(0, Number(session.defaultPricePence || 0)) * perSessionStudents.length;
    } else if (Number(session.expectedStudentCount ?? 1) === 1) {
      obligation = Math.max(0, Number(occurrence.grossPence ?? occurrence.earnedPence ?? 0));
    }
    if (!obligation) continue;
    const allocated = sum(data.allocations.filter((row) => row.targetId === occurrence.id).map((row) => row.amountPence));
    due += Math.max(0, obligation - allocated);
  }
  return due;
}

export function buildWorkspaceReport(data: ReportInput, today = new Date().toISOString().slice(0, 10)): WorkspaceReport {
  const from = addDays(today, -27);
  const inRange = (value: string) => value.slice(0, 10) >= from && value.slice(0, 10) <= today;
  const occurrences = data.occurrences.filter((row) => inRange(row.rescheduledToDate ?? row.sessionDate));
  const completed = occurrences.filter((row) => row.status === 'completed');
  const cancelled = occurrences.filter((row) => row.status === 'cancelled' || row.status === 'missed');
  const receivedPence = sum(data.receipts.filter((row) => inRange(row.receivedAt)).map((row) => row.amountPence));
  const expensesPence = sum(data.expenses.filter((row) => inRange(row.expenseDate)).map((row) => row.amountPence));
  const otherIncomePence = sum(data.otherIncome.filter((row) => inRange(row.incomeDate)).map((row) => row.amountPence));
  const sessionById = new Map(data.sessions.map((session) => [session.id, session]));
  let teachingMinutes = 0;
  let travelMinutes = 0;
  for (const occurrence of completed) {
    const session = sessionById.get(occurrence.recurringSessionId);
    if (!session) continue;
    teachingMinutes += Math.max(0, Number(session.durationMinutes || 0));
    travelMinutes += Math.max(0, Number(session.travelMinutes || 0));
  }
  const duePence = currentDue(data);
  const netCashPence = receivedPence + otherIncomePence - expensesPence;
  const productivePence = sum(completed.map((row) => row.earnedPence));
  const realMinutes = teachingMinutes + travelMinutes;
  const effectiveHourlyPence = realMinutes > 0 ? Math.round((productivePence * 60) / realMinutes) : 0;
  const pendingSchedules = data.sessions.filter((row) => row.scheduleStatus === 'pending').length;
  const duplicateExpenseRows = probableDuplicateExpenseIds(expenseDuplicateCandidates(data.expenses)).size;

  const insights: ReportInsight[] = [];
  if (duePence > 0) insights.push({ key: 'due', level: 'attention', title: 'فيه تحصيل محتاج متابعة', detail: `${duePence} قرش ما زالت مستحقة على حصص أو باقات مكتملة.` });
  if (pendingSchedules > 0) insights.push({ key: 'pending', level: 'attention', title: 'مواعيد لسه غير محددة', detail: `${pendingSchedules} موعد محتاج يوم أو ساعة.` });
  if (duplicateExpenseRows > 0) insights.push({ key: 'duplicate-expenses', level: 'attention', title: 'راجعي المصروفات المتشابهة', detail: `${duplicateExpenseRows} تسجيلات مصروف متشابهة في التاريخ والنوع والتصنيف والمبلغ؛ ممكن يكون بينها تكرار.` });
  if (cancelled.length >= Math.max(3, Math.ceil(completed.length * 0.25))) insights.push({ key: 'cancelled', level: 'attention', title: 'الإلغاءات مرتفعة نسبيًا', detail: `${cancelled.length} حصة ألغيت أو فاتت خلال آخر 28 يومًا.` });
  if (travelMinutes > teachingMinutes && completed.length > 0) insights.push({ key: 'travel', level: 'attention', title: 'وقت الانتقال كبير', detail: 'وقت الانتقال خلال الفترة أكبر من وقت التدريس؛ راجعي تجميع المواعيد القريبة.' });
  if (completed.length > 0 && duePence === 0 && pendingSchedules === 0 && duplicateExpenseRows === 0) insights.push({ key: 'stable', level: 'good', title: 'الصورة مستقرة', detail: 'لا توجد مستحقات مكتملة غير مسددة ولا مواعيد معلقة حاليًا.' });
  if (!insights.length) insights.push({ key: 'start', level: 'info', title: 'التقرير جاهز', detail: 'كلما زادت الحصص والتحصيلات سيصبح التحليل أكثر فائدة.' });

  return {
    fromDate: from,
    toDate: today,
    completedLessons: completed.length,
    cancelledLessons: cancelled.length,
    receivedPence,
    otherIncomePence,
    expensesPence,
    netCashPence,
    duePence,
    teachingMinutes,
    travelMinutes,
    effectiveHourlyPence,
    insights,
  };
}
