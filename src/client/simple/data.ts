import type { Student } from '../../modules/tutoring/domain/student';
import type { RecurringSession } from '../../modules/tutoring/domain/session';
import { openLocalDatabase, requestResult, STORES } from '../adapters/indexeddb/database';
import type { LocalBillingCycle, LocalBillingPlan, LocalReceipt } from '../tutoring/local-commands';

export type LocalOccurrence = {
  id: string;
  workspaceId: string;
  recurringSessionId: string;
  sessionDate: string;
  scheduledStart: string | null;
  rescheduledToDate: string | null;
  rescheduledToStart: string | null;
  status: 'scheduled' | 'completed' | 'cancelled' | 'missed';
  grossPence: number;
  centerCutPence: number;
  earnedPence: number;
  completedAt: string | null;
  note: string | null;
  studentIds?: string[];
};

export type LocalExpense = {
  id: string;
  workspaceId: string;
  expenseDate: string;
  scope: 'business' | 'personal';
  category: string;
  amountPence: number;
  note: string | null;
  deletedAt: string | null;
};

export type LocalOtherIncome = {
  id: string;
  workspaceId: string;
  incomeDate: string;
  category: string;
  amountPence: number;
  note: string | null;
  deletedAt: string | null;
};

export type LocalCashCheck = {
  id: string;
  workspaceId: string;
  checkDate: string;
  expectedBalancePence: number;
  actualBalancePence: number;
  differencePence: number;
  note: string | null;
  deletedAt: string | null;
};

export type LocalAllocation = {
  id: string;
  workspaceId: string;
  receiptId: string;
  targetModule: string;
  targetType: string;
  targetId: string;
  amountPence: number;
};

export type LocalWorkspaceSetting = {
  workspaceId: string;
  key: string;
  value: string;
};

export type SimpleWorkspaceData = {
  students: Student[];
  sessions: RecurringSession[];
  occurrences: LocalOccurrence[];
  billingPlans: LocalBillingPlan[];
  billingCycles: LocalBillingCycle[];
  receipts: LocalReceipt[];
  allocations: LocalAllocation[];
  expenses: LocalExpense[];
  otherIncome: LocalOtherIncome[];
  cashChecks: LocalCashCheck[];
  workspaceSettings: LocalWorkspaceSetting[];
  openingBalancePence: number;
};

export async function loadSimpleWorkspaceData(workspaceId: string): Promise<SimpleWorkspaceData> {
  const db = await openLocalDatabase();
  const stores = [
    STORES.coreWorkspaceSettings,
    STORES.tutoringStudents,
    STORES.tutoringSessions,
    STORES.tutoringOccurrences,
    STORES.tutoringBillingPlans,
    STORES.tutoringBillingCycles,
    STORES.financeReceipts,
    STORES.financeAllocations,
    STORES.financeExpenses,
    STORES.financeOtherIncome,
    STORES.financeCashChecks,
  ];
  const transaction = db.transaction(stores, 'readonly');
  const [settings, students, sessions, occurrences, billingPlans, billingCycles, receipts, allocations, expenses, otherIncome, cashChecks] = await Promise.all([
    requestResult<LocalWorkspaceSetting[]>(transaction.objectStore(STORES.coreWorkspaceSettings).getAll()),
    requestResult<Student[]>(transaction.objectStore(STORES.tutoringStudents).getAll()),
    requestResult<RecurringSession[]>(transaction.objectStore(STORES.tutoringSessions).getAll()),
    requestResult<LocalOccurrence[]>(transaction.objectStore(STORES.tutoringOccurrences).getAll()),
    requestResult<LocalBillingPlan[]>(transaction.objectStore(STORES.tutoringBillingPlans).getAll()),
    requestResult<LocalBillingCycle[]>(transaction.objectStore(STORES.tutoringBillingCycles).getAll()),
    requestResult<LocalReceipt[]>(transaction.objectStore(STORES.financeReceipts).getAll()),
    requestResult<LocalAllocation[]>(transaction.objectStore(STORES.financeAllocations).getAll()),
    requestResult<LocalExpense[]>(transaction.objectStore(STORES.financeExpenses).getAll()),
    requestResult<LocalOtherIncome[]>(transaction.objectStore(STORES.financeOtherIncome).getAll()),
    requestResult<LocalCashCheck[]>(transaction.objectStore(STORES.financeCashChecks).getAll()),
  ]);

  const mine = <T extends { workspaceId: string }>(rows: T[]) => rows.filter((row) => row.workspaceId === workspaceId);
  const workspaceSettings = mine(settings);
  const openingRaw = workspaceSettings.find((row) => row.key === 'finance.opening_balance_pence')?.value ?? '0';
  const openingBalancePence = Number.isFinite(Number(openingRaw)) ? Math.round(Number(openingRaw)) : 0;
  return {
    students: mine(students).filter((row) => row.active),
    sessions: mine(sessions).filter((row) => row.active),
    occurrences: mine(occurrences),
    billingPlans: mine(billingPlans),
    billingCycles: mine(billingCycles),
    receipts: mine(receipts).filter((row) => !row.deletedAt),
    allocations: mine(allocations),
    expenses: mine(expenses).filter((row) => !row.deletedAt),
    otherIncome: mine(otherIncome).filter((row) => !row.deletedAt),
    cashChecks: mine(cashChecks).filter((row) => !row.deletedAt),
    workspaceSettings,
    openingBalancePence,
  };
}

export function activeCycleFor(data: SimpleWorkspaceData, studentId: string): LocalBillingCycle | null {
  return data.billingCycles
    .filter((row) => row.studentId === studentId && row.status !== 'cancelled')
    .sort((a, b) => b.sequenceNo - a.sequenceNo)[0] ?? null;
}

export function planFor(data: SimpleWorkspaceData, studentId: string): LocalBillingPlan | null {
  return data.billingPlans.find((row) => row.studentId === studentId) ?? null;
}

export function studentForSession(data: SimpleWorkspaceData, session: RecurringSession): Student | null {
  const id = session.studentIds[0];
  return id ? data.students.find((student) => student.id === id) ?? null : null;
}
