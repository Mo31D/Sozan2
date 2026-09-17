import type { Student } from '../../modules/tutoring/domain/student';
import type { RecurringSession } from '../../modules/tutoring/domain/session';
import type { LocalActivityEvent } from '../activity/local-activity';
import { openLocalDatabase, requestResult, STORES } from '../adapters/indexeddb/database';
import type {
  LocalAllocation,
  LocalCashCheck,
  LocalExpense,
  LocalOtherIncome,
  LocalReceipt,
} from '../finance/types';
import type { LocalWorkspaceSetting } from '../platform/types';
import type { LocalBillingCycle, LocalBillingPlan } from '../tutoring/local-commands';

export type {
  LocalAllocation,
  LocalCashCheck,
  LocalExpense,
  LocalOtherIncome,
} from '../finance/types';
export type { LocalWorkspaceSetting } from '../platform/types';

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

export type SimpleWorkspaceData = {
  students: Student[];
  archivedStudents: Student[];
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
  activity: LocalActivityEvent[];
  openingBalancePence: number;
};

export async function loadSimpleWorkspaceData(workspaceId: string): Promise<SimpleWorkspaceData> {
  const db = await openLocalDatabase();
  const stores = [
    STORES.coreWorkspaceSettings,
    STORES.coreActivityEvents,
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
  const [settings, activity, students, sessions, occurrences, billingPlans, billingCycles, receipts, allocations, expenses, otherIncome, cashChecks] = await Promise.all([
    requestResult<LocalWorkspaceSetting[]>(transaction.objectStore(STORES.coreWorkspaceSettings).getAll()),
    requestResult<LocalActivityEvent[]>(transaction.objectStore(STORES.coreActivityEvents).getAll()),
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
  const allStudents = mine(students).map((row) => ({ ...row, familyId: row.familyId ?? null }));
  const activeStudents = allStudents.filter((row) => row.active);
  const activeIds = new Set(activeStudents.map((row) => row.id));
  const activeSessions = mine(sessions).filter((row) => row.active && (
    row.studentIds.length === 0 || row.studentIds.some((studentId) => activeIds.has(studentId))
  ));
  const openingRaw = workspaceSettings.find((row) => row.key === 'finance.opening_balance_pence')?.value ?? '0';
  const openingBalancePence = Number.isFinite(Number(openingRaw)) ? Math.round(Number(openingRaw)) : 0;
  return {
    students: activeStudents,
    archivedStudents: allStudents.filter((row) => !row.active),
    sessions: activeSessions,
    occurrences: mine(occurrences),
    billingPlans: mine(billingPlans),
    billingCycles: mine(billingCycles),
    receipts: mine(receipts).filter((row) => !row.deletedAt),
    allocations: mine(allocations),
    expenses: mine(expenses).filter((row) => !row.deletedAt),
    otherIncome: mine(otherIncome).filter((row) => !row.deletedAt),
    cashChecks: mine(cashChecks).filter((row) => !row.deletedAt),
    workspaceSettings,
    activity: mine(activity),
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
  return id ? [...data.students, ...data.archivedStudents].find((student) => student.id === id) ?? null : null;
}
