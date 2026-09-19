import { studentOccurrenceTargetId } from '../tutoring/domain/finance-target';
import { FAMILY_PACKAGE_TARGET_TYPE, FAMILY_PAYER_REF_TYPE } from '../tutoring/domain/billing-account';
export type StudentFinancialSummary = {
  receivedPence: number;
  allocatedPence: number;
  creditPence: number;
  duePence: number;
  lastPayment: {
    id: string;
    amountPence: number;
    receivedAt: string;
  } | null;
};

type StudentFinanceInput = {
  sessions: Array<{
    id: string;
    studentIds: string[];
    priceBasis: 'total_session' | 'per_student';
    defaultPricePence: number;
    expectedStudentCount: number;
    payerStudentId?: string | null;
  }>;
  archivedSessions?: Array<{
    id: string;
    studentIds: string[];
    priceBasis: 'total_session' | 'per_student';
    defaultPricePence: number;
    expectedStudentCount: number;
    payerStudentId?: string | null;
  }>;
  occurrences: Array<{
    id: string;
    recurringSessionId: string;
    status: 'scheduled' | 'completed' | 'cancelled' | 'missed';
    grossPence: number;
    studentIds?: string[];
    priceBasisSnapshot?: 'total_session' | 'per_student' | null;
    defaultPricePenceSnapshot?: number | null;
    payerStudentIdSnapshot?: string | null;
  }>;
  billingPlans: Array<{
    studentId: string;
    billingMode: 'per_session' | 'package';
  }>;
  billingCycles: Array<{
    id: string;
    studentId: string;
    status: 'open' | 'due' | 'paid' | 'cancelled';
    pricePence: number;
  }>;
  billingAccounts?: Array<{
    id: string;
    active: boolean;
  }>;
  billingAccountMembers?: Array<{
    billingAccountId: string;
    studentId: string;
    active: boolean;
  }>;
  billingAccountCycles?: Array<{
    id: string;
    billingAccountId: string;
    status: 'open' | 'due' | 'paid' | 'cancelled';
    pricePence: number;
  }>;
  receipts: Array<{
    id: string;
    payerRefType?: string;
    payerRefId: string;
    amountPence: number;
    receivedAt: string;
  }>;
  allocations: Array<{
    receiptId: string;
    targetModule: string;
    targetType: string;
    targetId: string;
    amountPence: number;
  }>;
};

function sum(values: number[]): number {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

function allocatedToTarget(
  data: StudentFinanceInput,
  targetType: string,
  targetId: string,
): number {
  return sum(data.allocations
    .filter((row) => row.targetModule === 'tutoring' && row.targetType === targetType && row.targetId === targetId)
    .map((row) => row.amountPence));
}

export function buildStudentFinancialSummary(
  data: StudentFinanceInput,
  studentId: string,
): StudentFinancialSummary {
  const familyAccountIds = new Set((data.billingAccounts ?? [])
    .filter((row) => row.active)
    .map((row) => row.id));
  const familyAccountId = (data.billingAccountMembers ?? []).find((row) =>
    row.studentId === studentId
    && row.active
    && familyAccountIds.has(row.billingAccountId))?.billingAccountId ?? null;

  const receipts = data.receipts
    .filter((row) => familyAccountId
      ? row.payerRefType === FAMILY_PAYER_REF_TYPE && row.payerRefId === familyAccountId
      : row.payerRefId === studentId && row.payerRefType !== FAMILY_PAYER_REF_TYPE)
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || b.id.localeCompare(a.id));
  const receiptIds = new Set(receipts.map((row) => row.id));
  const receivedPence = sum(receipts.map((row) => row.amountPence));
  const allocatedPence = sum(data.allocations
    .filter((row) => receiptIds.has(row.receiptId))
    .map((row) => row.amountPence));
  const creditPence = Math.max(0, receivedPence - allocatedPence);

  let duePence = 0;
  if (familyAccountId) {
    for (const cycle of data.billingAccountCycles ?? []) {
      if (cycle.billingAccountId !== familyAccountId || cycle.status !== 'due') continue;
      duePence += Math.max(
        0,
        cycle.pricePence - allocatedToTarget(data, FAMILY_PACKAGE_TARGET_TYPE, cycle.id),
      );
    }
  } else {
    for (const cycle of data.billingCycles) {
      if (cycle.studentId !== studentId || cycle.status !== 'due') continue;
      duePence += Math.max(0, cycle.pricePence - allocatedToTarget(data, 'package_cycle', cycle.id));
    }
  }

  const billingMode = data.billingPlans.find((row) => row.studentId === studentId)?.billingMode ?? null;
  if (!familyAccountId && billingMode === 'per_session') {
    const sessions = new Map(
      [...data.sessions, ...(data.archivedSessions ?? [])].map((session) => [session.id, session]),
    );
    for (const occurrence of data.occurrences) {
      if (occurrence.status !== 'completed') continue;
      const session = sessions.get(occurrence.recurringSessionId);
      if (!session) continue;

      const priceBasis = occurrence.priceBasisSnapshot ?? session.priceBasis;
      let obligationPence = 0;
      if (priceBasis === 'per_student') {
        if (!(occurrence.studentIds ?? session.studentIds).includes(studentId)) continue;
        obligationPence = Math.max(
          0,
          occurrence.defaultPricePenceSnapshot ?? session.defaultPricePence,
        );
      } else {
        const payerStudentId = occurrence.payerStudentIdSnapshot ?? session.payerStudentId ?? null;
        if (payerStudentId !== studentId) continue;
        obligationPence = Math.max(0, occurrence.grossPence);
      }
      if (!obligationPence) continue;

      duePence += Math.max(
        0,
        obligationPence - allocatedToTarget(
          data,
          'student_occurrence',
          studentOccurrenceTargetId(occurrence.id, studentId),
        ),
      );
    }
  }

  const last = receipts[0] ?? null;
  return {
    receivedPence,
    allocatedPence,
    creditPence,
    duePence,
    lastPayment: last
      ? { id: last.id, amountPence: last.amountPence, receivedAt: last.receivedAt }
      : null,
  };
}
