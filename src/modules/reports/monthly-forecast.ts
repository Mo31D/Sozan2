import { currentDuePence } from './insights';

export type ForecastConfidence = 'high' | 'medium' | 'limited';

export type MonthlyForecastInsight = {
  key: string;
  level: 'info' | 'attention' | 'good';
  title: string;
  detail: string;
};

export type MonthlyForecast = {
  monthStart: string;
  monthEnd: string;
  actualEarnedPence: number;
  projectedRemainingEarnedPence: number;
  projectedMonthEarnedPence: number;
  historicalAverageEarnedPence: number | null;
  incomeTrendPct: number | null;

  businessExpensesToDatePence: number;
  historicalAverageBusinessExpensesPence: number | null;
  projectedBusinessExpensesPence: number;
  expenseVarianceToDatePct: number | null;

  projectedOperatingNetPence: number;

  currentDuePence: number;
  projectedNewDuePence: number;
  projectedPackageCompletions: number;

  completedLessonsToDate: number;
  futureConfirmedLessons: number;
  projectedWorkMinutes: number;
  historicalCompletionRatePct: number | null;

  expenseHistoryMonths: number;
  activityHistoryMonths: number;
  pendingScheduleCount: number;
  excludedPendingScheduleCount: number;
  unpricedFutureLessons: number;

  confidence: ForecastConfidence;
  confidenceScore: number;
  confidenceReasons: string[];
  insights: MonthlyForecastInsight[];
};

type ForecastSession = {
  id: string;
  scheduleStatus: 'confirmed' | 'pending';
  weekday: number | null;
  startTime?: string | null;
  durationMinutes: number;
  travelMinutes: number;
  studentIds?: string[];
  priceBasis?: 'total_session' | 'per_student';
  defaultPricePence?: number;
  expectedStudentCount?: number;
  centerCutBps?: number;
  payerStudentId?: string | null;
};

type ForecastOccurrence = {
  id?: string;
  recurringSessionId: string;
  sessionDate: string;
  rescheduledToDate: string | null;
  rescheduledToStart?: string | null;
  status: 'scheduled' | 'completed' | 'cancelled' | 'missed';
  earnedPence: number;
  studentIds?: string[];
  durationMinutesSnapshot?: number | null;
  travelMinutesSnapshot?: number | null;
  priceBasisSnapshot?: 'total_session' | 'per_student' | null;
  defaultPricePenceSnapshot?: number | null;
  payerStudentIdSnapshot?: string | null;
};

type ForecastBillingPlan = {
  studentId: string;
  billingMode: 'per_session' | 'package';
  packageSize?: number | null;
  packagePricePence?: number | null;
  effectiveFrom?: string;
};

type ForecastBillingCycle = {
  id: string;
  studentId?: string;
  sequenceNo?: number;
  sessionLimit?: number;
  openingCompletedCount?: number;
  realCompletedCount?: number;
  status: 'open' | 'due' | 'paid' | 'cancelled';
  pricePence: number;
};

type ForecastBillingAccount = {
  id: string;
  active: boolean;
  countingMode: 'shared_occurrence' | 'per_member_quota';
  primaryStudentId: string;
  packageSize: number;
  packagePricePence: number;
  effectiveFrom: string;
};

type ForecastBillingAccountMember = {
  billingAccountId: string;
  studentId: string;
  active: boolean;
};

type ForecastBillingAccountCycle = {
  id: string;
  billingAccountId: string;
  sequenceNo: number;
  status: 'open' | 'due' | 'paid' | 'cancelled';
  pricePence: number;
};

type ForecastExpense = {
  expenseDate: string;
  scope?: 'business' | 'personal';
  category?: string;
  amountPence: number;
  deletedAt?: string | null;
};

export type MonthlyForecastInput = {
  sessions: ForecastSession[];
  archivedSessions?: ForecastSession[];
  occurrences: ForecastOccurrence[];
  receipts: Array<{ receivedAt: string; amountPence: number }>;
  expenses: ForecastExpense[];
  otherIncome: Array<{ incomeDate: string; amountPence: number }>;
  billingPlans?: ForecastBillingPlan[];
  billingCycles: ForecastBillingCycle[];
  billingAccounts?: ForecastBillingAccount[];
  billingAccountMembers?: ForecastBillingAccountMember[];
  billingAccountCycles?: ForecastBillingAccountCycle[];
  allocations: Array<{ targetId: string; targetType?: string; amountPence: number }>;
};

type FutureSlot = {
  date: string;
  time: string | null;
  session: ForecastSession;
  occurrence: ForecastOccurrence | null;
};

type PackageProjectionState = {
  progress: number;
  size: number;
  pricePence: number;
  nextSize: number;
  nextPricePence: number;
  sequenceNo: number;
  completedSequences: Set<number>;
};

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

function monthEnd(iso: string): string {
  const [year, month] = iso.slice(0, 7).split('-').map(Number);
  return new Date(Date.UTC(year, month, 0, 12)).toISOString().slice(0, 10);
}

function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

function previousMonthKey(isoMonth: string, offset: number): string {
  const [year, month] = isoMonth.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 2 - offset, 1, 12));
  return date.toISOString().slice(0, 7);
}

function daysInMonth(iso: string): number {
  return Number(monthEnd(iso).slice(8, 10));
}

function dayOfMonth(iso: string): number {
  return Number(iso.slice(8, 10));
}

function weekday(iso: string): number {
  return new Date(`${iso}T12:00:00Z`).getUTCDay();
}

function effectiveOccurrenceDate(row: ForecastOccurrence): string {
  return row.rescheduledToDate ?? row.sessionDate;
}

function within(value: string, from: string, to: string): boolean {
  const date = value.slice(0, 10);
  return date >= from && date <= to;
}

function directSessionExpectedEarnedPence(session: ForecastSession, occurrence: ForecastOccurrence | null): number {
  const priceBasis = occurrence?.priceBasisSnapshot ?? session.priceBasis ?? 'total_session';
  const unitPrice = Math.max(0, Number(
    occurrence?.defaultPricePenceSnapshot ?? session.defaultPricePence ?? 0,
  ));
  const linkedCount = occurrence?.studentIds?.length ?? session.studentIds?.length ?? 0;
  const plannedCount = Math.max(1, Number(session.expectedStudentCount ?? (linkedCount || 1)));
  const gross = priceBasis === 'per_student' ? unitPrice * plannedCount : unitPrice;
  const centerCutBps = clamp(Math.round(Number(session.centerCutBps ?? 0)), 0, 10_000);
  const centerCut = Math.floor((gross * centerCutBps) / 10_000);
  return Math.max(0, gross - centerCut);
}

function expectedEarnedPenceForLesson(
  data: MonthlyForecastInput,
  session: ForecastSession,
  occurrence: ForecastOccurrence | null,
  date: string,
): number {
  const direct = directSessionExpectedEarnedPence(session, occurrence);
  if (direct > 0) return direct;

  const participants = occurrence?.studentIds ?? session.studentIds ?? [];
  const activeAccounts = (data.billingAccounts ?? []).filter((account) =>
    account.active && account.effectiveFrom <= date);
  const members = (data.billingAccountMembers ?? []).filter((member) => member.active);
  const accountsForParticipants = new Map<string, ForecastBillingAccount>();

  for (const studentId of participants) {
    const membership = members.find((member) => member.studentId === studentId);
    const account = membership
      ? activeAccounts.find((row) => row.id === membership.billingAccountId) ?? null
      : null;
    if (account) accountsForParticipants.set(account.id, account);
  }

  if (accountsForParticipants.size) {
    let earned = 0;
    for (const account of accountsForParticipants.values()) {
      const accountMembers = members.filter((member) => member.billingAccountId === account.id);
      if (account.countingMode === 'shared_occurrence') {
        earned += Math.round(account.packagePricePence / Math.max(1, account.packageSize));
        continue;
      }
      const participatingMembers = participants.filter((studentId) =>
        accountMembers.some((member) => member.studentId === studentId)).length;
      const entitlementCount = Math.max(1, account.packageSize * accountMembers.length);
      earned += Math.round((account.packagePricePence * participatingMembers) / entitlementCount);
    }
    return Math.max(0, earned);
  }

  const planByStudent = new Map((data.billingPlans ?? []).map((plan) => [plan.studentId, plan]));
  const priceBasis = occurrence?.priceBasisSnapshot ?? session.priceBasis ?? 'total_session';
  if (priceBasis === 'total_session') {
    const payerId = occurrence?.payerStudentIdSnapshot ?? session.payerStudentId ?? null;
    const plan = payerId ? planByStudent.get(payerId) : null;
    if (plan?.billingMode === 'package' && (!plan.effectiveFrom || plan.effectiveFrom <= date)) {
      return Math.round(
        Math.max(0, Number(plan.packagePricePence ?? 0))
        / Math.max(1, Number(plan.packageSize ?? 8)),
      );
    }
    return 0;
  }

  return participants.reduce((total, studentId) => {
    const plan = planByStudent.get(studentId);
    if (plan?.billingMode !== 'package' || (plan.effectiveFrom && plan.effectiveFrom > date)) return total;
    return total + Math.round(
      Math.max(0, Number(plan.packagePricePence ?? 0))
      / Math.max(1, Number(plan.packageSize ?? 8)),
    );
  }, 0);
}

function futureSlotsForMonth(
  data: MonthlyForecastInput,
  today: string,
  end: string,
): FutureSlot[] {
  if (today > end) return [];

  const sessionById = new Map(data.sessions.map((session) => [session.id, session]));
  const occurrenceBySessionAndOriginalDate = new Map<string, ForecastOccurrence>();
  for (const occurrence of data.occurrences) {
    occurrenceBySessionAndOriginalDate.set(
      `${occurrence.recurringSessionId}|${occurrence.sessionDate}`,
      occurrence,
    );
  }

  const slots: FutureSlot[] = [];
  const seen = new Set<string>();

  for (let date = today; date <= end; date = addDays(date, 1)) {
    const dateWeekday = weekday(date);

    for (const session of data.sessions) {
      if (session.scheduleStatus !== 'confirmed' || session.weekday !== dateWeekday) continue;
      const occurrence = occurrenceBySessionAndOriginalDate.get(`${session.id}|${date}`) ?? null;
      if (occurrence?.rescheduledToDate && occurrence.rescheduledToDate !== date) continue;
      if (occurrence && occurrence.status !== 'scheduled') continue;

      const key = occurrence?.id ? `occurrence:${occurrence.id}` : `recurring:${session.id}:${date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      slots.push({
        date,
        time: occurrence?.rescheduledToStart ?? session.startTime ?? null,
        session,
        occurrence,
      });
    }

    for (const occurrence of data.occurrences) {
      if (occurrence.rescheduledToDate !== date || occurrence.sessionDate === date) continue;
      if (occurrence.status !== 'scheduled') continue;
      const session = sessionById.get(occurrence.recurringSessionId);
      if (!session || session.scheduleStatus !== 'confirmed') continue;
      const key = occurrence.id ? `occurrence:${occurrence.id}` : `rescheduled:${session.id}:${occurrence.sessionDate}:${date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      slots.push({
        date,
        time: occurrence.rescheduledToStart ?? session.startTime ?? null,
        session,
        occurrence,
      });
    }
  }

  return slots.sort((a, b) =>
    a.date.localeCompare(b.date)
    || (a.time ?? '99:99').localeCompare(b.time ?? '99:99')
    || a.session.id.localeCompare(b.session.id),
  );
}

function priorActivityMonths(data: MonthlyForecastInput, today: string, limit = 3): string[] {
  const currentMonth = monthKey(today);
  const activityMonths = new Set<string>();

  for (const occurrence of data.occurrences) {
    if (occurrence.status === 'completed' || occurrence.status === 'cancelled' || occurrence.status === 'missed') {
      activityMonths.add(monthKey(effectiveOccurrenceDate(occurrence)));
    }
  }
  for (const receipt of data.receipts) activityMonths.add(monthKey(receipt.receivedAt));
  for (const expense of data.expenses) if (!expense.deletedAt) activityMonths.add(monthKey(expense.expenseDate));
  for (const income of data.otherIncome) activityMonths.add(monthKey(income.incomeDate));

  const selected: string[] = [];
  for (let offset = 0; offset < 18 && selected.length < limit; offset += 1) {
    const key = previousMonthKey(currentMonth, offset);
    if (activityMonths.has(key)) selected.push(key);
  }
  return selected;
}

function businessExpenseTotalForMonth(data: MonthlyForecastInput, key: string): number {
  return sum(data.expenses
    .filter((row) => !row.deletedAt && row.scope === 'business' && monthKey(row.expenseDate) === key)
    .map((row) => row.amountPence));
}

function earnedTotalForMonth(data: MonthlyForecastInput, key: string): number {
  return sum(data.occurrences
    .filter((row) => row.status === 'completed' && monthKey(effectiveOccurrenceDate(row)) === key)
    .map((row) => row.earnedPence));
}

function topExpenseCategoryInsight(
  data: MonthlyForecastInput,
  historyMonths: readonly string[],
  today: string,
  businessExpensesToDatePence: number,
  historicalAverageBusinessExpensesPence: number | null,
): MonthlyForecastInsight | null {
  if (historyMonths.length < 2 || !historicalAverageBusinessExpensesPence || historicalAverageBusinessExpensesPence <= 0) return null;

  const currentMonth = monthKey(today);
  const elapsedFraction = dayOfMonth(today) / daysInMonth(today);
  const categories = new Set<string>();

  for (const row of data.expenses) {
    if (row.deletedAt || row.scope !== 'business') continue;
    const category = row.category?.trim() || 'أخرى';
    if (monthKey(row.expenseDate) === currentMonth || historyMonths.includes(monthKey(row.expenseDate))) {
      categories.add(category);
    }
  }

  let best: { category: string; current: number; expected: number; pct: number; magnitude: number } | null = null;
  for (const category of categories) {
    const current = sum(data.expenses
      .filter((row) => !row.deletedAt
        && row.scope === 'business'
        && (row.category?.trim() || 'أخرى') === category
        && monthKey(row.expenseDate) === currentMonth)
      .map((row) => row.amountPence));

    const historicalMonthly = historyMonths.map((key) => sum(data.expenses
      .filter((row) => !row.deletedAt
        && row.scope === 'business'
        && (row.category?.trim() || 'أخرى') === category
        && monthKey(row.expenseDate) === key)
      .map((row) => row.amountPence)));
    const historicalAverage = Math.round(sum(historicalMonthly) / historyMonths.length);
    const expected = Math.round(historicalAverage * elapsedFraction);
    if (expected <= 0) continue;

    const difference = current - expected;
    const pct = Math.round((difference / expected) * 100);
    const magnitude = Math.abs(difference);
    const meaningful = magnitude >= Math.max(
      1,
      Math.round(historicalAverageBusinessExpensesPence * elapsedFraction * 0.08),
      Math.round(businessExpensesToDatePence * 0.08),
    );
    if (!meaningful || Math.abs(pct) < 30) continue;
    if (!best || magnitude > best.magnitude) best = { category, current, expected, pct, magnitude };
  }

  if (!best) return null;
  const direction = best.pct > 0 ? 'أعلى' : 'أقل';
  return {
    key: 'expense-category-anomaly',
    level: Math.abs(best.pct) >= 50 ? 'attention' : 'info',
    title: `${best.category} ${direction} من المعتاد`,
    detail: `${Math.abs(best.pct)}% ${direction} من المستوى المعتاد لنفس المرحلة من الشهر.`,
  };
}

function projectedNewDue(
  data: MonthlyForecastInput,
  slots: readonly FutureSlot[],
): { duePence: number; packageCompletions: number } {
  const planByStudent = new Map((data.billingPlans ?? []).map((plan) => [plan.studentId, plan]));
  const packageState = new Map<string, PackageProjectionState>();

  const activeFamilyAccounts = (data.billingAccounts ?? []).filter((account) => account.active);
  const familyMembers = (data.billingAccountMembers ?? []).filter((member) => member.active);
  const familyByStudent = new Map<string, ForecastBillingAccount>();
  for (const member of familyMembers) {
    const account = activeFamilyAccounts.find((row) => row.id === member.billingAccountId);
    if (account) familyByStudent.set(member.studentId, account);
  }

  for (const [studentId, plan] of planByStudent) {
    if (plan.billingMode !== 'package') continue;
    const studentCycles = data.billingCycles
      .filter((cycle) => cycle.studentId === studentId && cycle.status !== 'cancelled')
      .sort((a, b) => Number(a.sequenceNo ?? 0) - Number(b.sequenceNo ?? 0));
    const openCycle = [...studentCycles]
      .filter((cycle) => cycle.status === 'open')
      .sort((a, b) => Number(b.sequenceNo ?? 0) - Number(a.sequenceNo ?? 0))[0] ?? null;
    const latestSequence = studentCycles.reduce(
      (max, cycle) => Math.max(max, Number(cycle.sequenceNo ?? 0)),
      0,
    );

    const planSize = clamp(Math.round(Number(plan.packageSize ?? openCycle?.sessionLimit ?? 8)), 1, 100);
    const planPrice = Math.max(0, Math.round(Number(plan.packagePricePence ?? openCycle?.pricePence ?? 0)));
    const size = clamp(Math.round(Number(openCycle?.sessionLimit ?? planSize)), 1, 100);
    const price = Math.max(0, Math.round(Number(openCycle?.pricePence ?? planPrice)));
    const progress = openCycle
      ? clamp(
          Math.round(Number(openCycle.openingCompletedCount ?? 0)) + Math.round(Number(openCycle.realCompletedCount ?? 0)),
          0,
          size,
        )
      : 0;
    const completedSequences = new Set(studentCycles
      .filter((cycle) => (
        Math.round(Number(cycle.openingCompletedCount ?? 0))
        + Math.round(Number(cycle.realCompletedCount ?? 0))
      ) >= Math.round(Number(cycle.sessionLimit ?? planSize)))
      .map((cycle) => Number(cycle.sequenceNo ?? 0))
      .filter((sequenceNo) => sequenceNo > 0));

    packageState.set(studentId, {
      progress,
      size,
      pricePence: price,
      nextSize: planSize,
      nextPricePence: planPrice,
      sequenceNo: openCycle ? Number(openCycle.sequenceNo ?? (latestSequence || 1)) : latestSequence + 1,
      completedSequences,
    });
  }

  // Anything already complete before the forecast starts is current state, not
  // a newly projected charge, even if an old import omitted the family-cycle row.
  const familyCompleted = new Map<string, Set<number>>();
  for (const account of activeFamilyAccounts) {
    const requiredIds = account.countingMode === 'shared_occurrence'
      ? [account.primaryStudentId]
      : familyMembers
          .filter((member) => member.billingAccountId === account.id)
          .map((member) => member.studentId);
    const knownSequences = new Set<number>();
    for (const studentId of requiredIds) {
      for (const sequenceNo of packageState.get(studentId)?.completedSequences ?? []) {
        knownSequences.add(sequenceNo);
      }
    }
    const already = new Set<number>();
    for (const sequenceNo of knownSequences) {
      if (requiredIds.length && requiredIds.every((studentId) =>
        packageState.get(studentId)?.completedSequences.has(sequenceNo))) {
        already.add(sequenceNo);
      }
    }
    for (const cycle of data.billingAccountCycles ?? []) {
      if (cycle.billingAccountId === account.id && cycle.status !== 'cancelled') {
        already.add(Number(cycle.sequenceNo));
      }
    }
    familyCompleted.set(account.id, already);
  }

  let duePence = 0;
  let packageCompletions = 0;

  for (const slot of slots) {
    const session = slot.session;
    const participants = slot.occurrence?.studentIds ?? session.studentIds ?? [];
    const priceBasis = slot.occurrence?.priceBasisSnapshot ?? session.priceBasis ?? 'total_session';
    const unitPrice = Math.max(0, Number(
      slot.occurrence?.defaultPricePenceSnapshot ?? session.defaultPricePence ?? 0,
    ));

    if (priceBasis === 'per_student') {
      for (const studentId of participants) {
        const plan = planByStudent.get(studentId);
        if (plan?.billingMode !== 'per_session') continue;
        if (familyByStudent.has(studentId)) continue;
        if (plan.effectiveFrom && slot.date < plan.effectiveFrom) continue;
        duePence += unitPrice;
      }
    } else {
      const payerStudentId = slot.occurrence?.payerStudentIdSnapshot ?? session.payerStudentId ?? null;
      if (payerStudentId) {
        const payerPlan = planByStudent.get(payerStudentId);
        if (payerPlan?.billingMode === 'per_session'
          && !familyByStudent.has(payerStudentId)
          && (!payerPlan.effectiveFrom || slot.date >= payerPlan.effectiveFrom)) {
          duePence += unitPrice;
        }
      }
    }

    const packageStudentIds = priceBasis === 'total_session'
      && session.payerStudentId
      && (session.studentIds ?? []).includes(session.payerStudentId)
      ? [session.payerStudentId]
      : participants;

    for (const studentId of [...new Set(packageStudentIds)]) {
      const plan = planByStudent.get(studentId);
      if (plan?.billingMode !== 'package') continue;
      if (plan.effectiveFrom && slot.date < plan.effectiveFrom) continue;
      const state = packageState.get(studentId);
      if (!state) continue;

      state.progress += 1;
      if (state.progress < state.size) continue;

      const completedSequence = state.sequenceNo;
      state.completedSequences.add(completedSequence);

      if (!familyByStudent.has(studentId)) {
        duePence += state.pricePence;
        packageCompletions += 1;
      }

      state.progress = 0;
      state.size = state.nextSize;
      state.pricePence = state.nextPricePence;
      state.sequenceNo += 1;
    }

    // A family charge is emitted only when the same family sequence is complete
    // for all required members (or once for the primary progress in shared mode).
    for (const account of activeFamilyAccounts) {
      if (slot.date < account.effectiveFrom) continue;
      const requiredIds = account.countingMode === 'shared_occurrence'
        ? [account.primaryStudentId]
        : familyMembers
            .filter((member) => member.billingAccountId === account.id)
            .map((member) => member.studentId);
      if (!requiredIds.length) continue;

      const candidates = new Set<number>();
      for (const studentId of requiredIds) {
        for (const sequenceNo of packageState.get(studentId)?.completedSequences ?? []) {
          candidates.add(sequenceNo);
        }
      }
      const accounted = familyCompleted.get(account.id) ?? new Set<number>();
      for (const sequenceNo of [...candidates].sort((a, b) => a - b)) {
        if (accounted.has(sequenceNo)) continue;
        const complete = requiredIds.every((studentId) =>
          packageState.get(studentId)?.completedSequences.has(sequenceNo));
        if (!complete) continue;
        duePence += Math.max(0, Number(account.packagePricePence || 0));
        packageCompletions += 1;
        accounted.add(sequenceNo);
      }
      familyCompleted.set(account.id, accounted);
    }
  }

  return { duePence, packageCompletions };
}

function historicalCompletionRate(data: MonthlyForecastInput, today: string): { pct: number | null; resolved: number } {
  const from = addDays(today, -56);
  const rows = data.occurrences.filter((row) => {
    const date = effectiveOccurrenceDate(row);
    return date >= from
      && date < today
      && (row.status === 'completed' || row.status === 'cancelled' || row.status === 'missed');
  });
  if (rows.length < 5) return { pct: null, resolved: rows.length };
  const completed = rows.filter((row) => row.status === 'completed').length;
  return { pct: Math.round((completed / rows.length) * 100), resolved: rows.length };
}

export function buildMonthlyForecast(
  data: MonthlyForecastInput,
  today: string,
): MonthlyForecast {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(today)) throw new Error('FORECAST_DATE_INVALID');

  const start = monthStart(today);
  const end = monthEnd(today);
  const currentMonth = monthKey(today);
  const elapsedDays = dayOfMonth(today);
  const totalDays = daysInMonth(today);
  const remainingFraction = Math.max(0, (totalDays - elapsedDays) / totalDays);

  const monthCompleted = data.occurrences.filter((row) =>
    row.status === 'completed' && within(effectiveOccurrenceDate(row), start, today));
  const sessionById = new Map(
    [...data.sessions, ...(data.archivedSessions ?? [])].map((session) => [session.id, session]),
  );
  const actualEarnedPence = sum(monthCompleted.map((row) => {
    const session = sessionById.get(row.recurringSessionId);
    if (!session) return row.earnedPence;
    const derived = expectedEarnedPenceForLesson(
      data,
      session,
      row,
      effectiveOccurrenceDate(row),
    );
    return derived > 0 ? derived : row.earnedPence;
  }));

  const futureSlots = futureSlotsForMonth(data, today, end);
  const projectedRemainingEarnedPence = sum(futureSlots.map((slot) =>
    expectedEarnedPenceForLesson(data, slot.session, slot.occurrence, slot.date)));
  const projectedMonthEarnedPence = actualEarnedPence + projectedRemainingEarnedPence;

  const futureWorkMinutes = sum(futureSlots.map((slot) =>
    Math.max(0, Number(slot.occurrence?.durationMinutesSnapshot ?? slot.session.durationMinutes ?? 0))
    + Math.max(0, Number(slot.occurrence?.travelMinutesSnapshot ?? slot.session.travelMinutes ?? 0))));
  const actualWorkMinutes = sum(monthCompleted.map((row) => {
    const session = [...data.sessions, ...(data.archivedSessions ?? [])]
      .find((item) => item.id === row.recurringSessionId);
    return Math.max(0, Number(row.durationMinutesSnapshot ?? session?.durationMinutes ?? 0))
      + Math.max(0, Number(row.travelMinutesSnapshot ?? session?.travelMinutes ?? 0));
  }));

  const businessExpensesToDatePence = sum(data.expenses
    .filter((row) => !row.deletedAt
      && row.scope === 'business'
      && monthKey(row.expenseDate) === currentMonth
      && row.expenseDate.slice(0, 10) <= today)
    .map((row) => row.amountPence));

  const historyMonths = priorActivityMonths(data, today, 3);
  const historicalExpenseTotals = historyMonths.map((key) => businessExpenseTotalForMonth(data, key));
  const historicalEarnedTotals = historyMonths.map((key) => earnedTotalForMonth(data, key));
  const historicalAverageBusinessExpensesPence = historyMonths.length
    ? Math.round(sum(historicalExpenseTotals) / historyMonths.length)
    : null;
  const historicalAverageEarnedPence = historyMonths.length
    ? Math.round(sum(historicalEarnedTotals) / historyMonths.length)
    : null;

  const projectedBusinessExpensesPence = historicalAverageBusinessExpensesPence === null
    ? businessExpensesToDatePence
    : businessExpensesToDatePence
      + Math.round(historicalAverageBusinessExpensesPence * remainingFraction);

  const expectedExpensesToDate = historicalAverageBusinessExpensesPence === null
    ? 0
    : Math.round(historicalAverageBusinessExpensesPence * (elapsedDays / totalDays));
  const expenseVarianceToDatePct = expectedExpensesToDate > 0
    ? Math.round(((businessExpensesToDatePence - expectedExpensesToDate) / expectedExpensesToDate) * 100)
    : null;

  const incomeTrendPct = historicalAverageEarnedPence && historicalAverageEarnedPence > 0
    ? Math.round(((projectedMonthEarnedPence - historicalAverageEarnedPence) / historicalAverageEarnedPence) * 100)
    : null;

  const currentDue = currentDuePence(data);
  const projectedDue = projectedNewDue(data, futureSlots);
  const pendingScheduleCount = data.sessions.filter((row) => row.scheduleStatus === 'pending').length;
  const unpricedFutureLessons = futureSlots.filter((slot) =>
    expectedEarnedPenceForLesson(data, slot.session, slot.occurrence, slot.date) <= 0).length;
  const completion = historicalCompletionRate(data, today);

  let confidenceScore = 100;
  const confidenceReasons: string[] = [];

  if (pendingScheduleCount > 0) {
    confidenceScore -= Math.min(45, 10 + pendingScheduleCount * 2);
    confidenceReasons.push(`${pendingScheduleCount} موعد غير محدد مستبعد من توقع بقية الشهر`);
  }
  if (futureSlots.length === 0 && today < end) {
    confidenceScore -= 15;
    confidenceReasons.push('لا توجد مواعيد مؤكدة متبقية في الجدول لهذا الشهر');
  }
  if (unpricedFutureLessons > 0) {
    confidenceScore -= Math.min(20, 5 + unpricedFutureLessons * 2);
    confidenceReasons.push(`${unpricedFutureLessons} حصة مستقبلية بدون سعر مباشر`);
  }
  if (historyMonths.length === 0) {
    confidenceScore -= 20;
    confidenceReasons.push('لا يوجد تاريخ شهري كافٍ لمقارنة المصروفات والدخل');
  } else if (historyMonths.length === 1) {
    confidenceScore -= 10;
    confidenceReasons.push('خط الأساس مبني على شهر سابق واحد فقط');
  }
  if (completion.pct === null) {
    confidenceScore -= 8;
    confidenceReasons.push('تاريخ الحضور والإلغاء قصير لتقدير استقرار الجدول');
  } else if (completion.pct < 80) {
    confidenceScore -= 10;
    confidenceReasons.push(`معدل إتمام الحصص التاريخي ${completion.pct}%`);
  }

  confidenceScore = clamp(confidenceScore, 20, 100);
  const confidence: ForecastConfidence = confidenceScore >= 80
    ? 'high'
    : confidenceScore >= 55 ? 'medium' : 'limited';

  const insights: MonthlyForecastInsight[] = [];

  if (projectedDue.packageCompletions > 0) {
    insights.push({
      key: 'package-completions',
      level: 'info',
      title: projectedDue.packageCompletions === 1
        ? 'باقة متوقع اكتمالها هذا الشهر'
        : `${projectedDue.packageCompletions} باقات متوقع اكتمالها هذا الشهر`,
      detail: 'الحساب مبني على المواعيد المؤكدة الحالية وتقدم الباقات المسجل.',
    });
  }

  if (expenseVarianceToDatePct !== null && Math.abs(expenseVarianceToDatePct) >= 20) {
    const higher = expenseVarianceToDatePct > 0;
    insights.push({
      key: 'expense-variance',
      level: higher && expenseVarianceToDatePct >= 35 ? 'attention' : 'info',
      title: higher ? 'مصروفات الشغل أعلى من المعتاد' : 'مصروفات الشغل أقل من المعتاد',
      detail: `${Math.abs(expenseVarianceToDatePct)}% ${higher ? 'أعلى' : 'أقل'} من المستوى المعتاد لنفس المرحلة من الشهر.`,
    });
  }

  const categoryInsight = topExpenseCategoryInsight(
    data,
    historyMonths,
    today,
    businessExpensesToDatePence,
    historicalAverageBusinessExpensesPence,
  );
  if (categoryInsight) insights.push(categoryInsight);

  if (incomeTrendPct !== null && Math.abs(incomeTrendPct) >= 15) {
    const higher = incomeTrendPct > 0;
    insights.push({
      key: 'income-trend',
      level: higher ? 'good' : 'attention',
      title: higher ? 'الشهر متجه لقيمة شغل أعلى' : 'الشهر متجه لقيمة شغل أقل',
      detail: `${Math.abs(incomeTrendPct)}% ${higher ? 'أعلى' : 'أقل'} من متوسط الأشهر السابقة المستخدمة للمقارنة.`,
    });
  }

  if (completion.pct !== null && completion.pct < 80) {
    insights.push({
      key: 'completion-risk',
      level: 'attention',
      title: 'الإلغاءات قد تخفض التوقع',
      detail: `معدل إتمام الحصص خلال آخر 8 أسابيع ${completion.pct}%؛ التوقع المالي لا يفترض إلغاء مواعيد مستقبلية.`,
    });
  }

  if (pendingScheduleCount > 0) {
    insights.push({
      key: 'pending-excluded',
      level: 'attention',
      title: 'مواعيد غير محددة خارج التوقع',
      detail: `${pendingScheduleCount} موعد غير محدد لم يتم احتسابه ضمن دخل بقية الشهر حتى لا نخمن يومًا أو عدد مرات غير مؤكد.`,
    });
  }

  if (!insights.length) {
    insights.push({
      key: 'forecast-stable',
      level: 'good',
      title: 'التوقع مستقر مع البيانات الحالية',
      detail: 'لا توجد انحرافات كبيرة في المصروفات أو مؤشرات واضحة تستدعي التنبيه.',
    });
  }

  return {
    monthStart: start,
    monthEnd: end,
    actualEarnedPence,
    projectedRemainingEarnedPence,
    projectedMonthEarnedPence,
    historicalAverageEarnedPence,
    incomeTrendPct,
    businessExpensesToDatePence,
    historicalAverageBusinessExpensesPence,
    projectedBusinessExpensesPence,
    expenseVarianceToDatePct,
    projectedOperatingNetPence: projectedMonthEarnedPence - projectedBusinessExpensesPence,
    currentDuePence: currentDue,
    projectedNewDuePence: projectedDue.duePence,
    projectedPackageCompletions: projectedDue.packageCompletions,
    completedLessonsToDate: monthCompleted.length,
    futureConfirmedLessons: futureSlots.length,
    projectedWorkMinutes: actualWorkMinutes + futureWorkMinutes,
    historicalCompletionRatePct: completion.pct,
    expenseHistoryMonths: historyMonths.length,
    activityHistoryMonths: historyMonths.length,
    pendingScheduleCount,
    excludedPendingScheduleCount: pendingScheduleCount,
    unpricedFutureLessons,
    confidence,
    confidenceScore,
    confidenceReasons,
    insights,
  };
}
