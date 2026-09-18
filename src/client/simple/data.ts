import type { Student } from '../../modules/tutoring/domain/student';
import type { StudentBaseline } from '../../modules/tutoring/domain/student-baseline';
import type { RecurringSession } from '../../modules/tutoring/domain/session';
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
  /** Students who actually attended this occurrence. */
  studentIds?: string[];
  durationMinutesSnapshot: number | null;
  travelMinutesSnapshot: number | null;
  sessionTypeSnapshot: string | null;
  locationSnapshot: string | null;
  priceBasisSnapshot: 'total_session' | 'per_student' | null;
  defaultPricePenceSnapshot: number | null;
  payerStudentIdSnapshot: string | null;
};

export type SimpleWorkspaceData = {
  students: Student[];
  studentBaselines: StudentBaseline[];
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
    STORES.tutoringStudentBaselines,
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
  const [
    settings,
    students,
    studentBaselines,
    sessions,
    occurrences,
    billingPlans,
    billingCycles,
    receipts,
    allocations,
    expenses,
    otherIncome,
    cashChecks,
  ] = await Promise.all([
    requestResult<LocalWorkspaceSetting[]>(transaction.objectStore(STORES.coreWorkspaceSettings).getAll()),
    requestResult<Student[]>(transaction.objectStore(STORES.tutoringStudents).getAll()),
    requestResult<StudentBaseline[]>(transaction.objectStore(STORES.tutoringStudentBaselines).getAll()),
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
    studentBaselines: mine(studentBaselines),
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

export function baselineFor(data: SimpleWorkspaceData, studentId: string): StudentBaseline | null {
  return data.studentBaselines.find((row) => row.studentId === studentId) ?? null;
}

export function studentForSession(data: SimpleWorkspaceData, session: RecurringSession): Student | null {
  const id = session.studentIds[0];
  return id ? data.students.find((student) => student.id === id) ?? null : null;
}
