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
  }>;
  occurrences: Array<{
    id: string;
    recurringSessionId: string;
    status: 'scheduled' | 'completed' | 'cancelled' | 'missed';
    grossPence: number;
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
  receipts: Array<{
    id: string;
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
  const receipts = data.receipts
    .filter((row) => row.payerRefId === studentId)
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || b.id.localeCompare(a.id));
  const receiptIds = new Set(receipts.map((row) => row.id));
  const receivedPence = sum(receipts.map((row) => row.amountPence));
  const allocatedPence = sum(data.allocations
    .filter((row) => receiptIds.has(row.receiptId))
    .map((row) => row.amountPence));
  const creditPence = Math.max(0, receivedPence - allocatedPence);

  let duePence = 0;
  for (const cycle of data.billingCycles) {
    if (cycle.studentId !== studentId || cycle.status !== 'due') continue;
    duePence += Math.max(0, cycle.pricePence - allocatedToTarget(data, 'package_cycle', cycle.id));
  }

  const billingMode = data.billingPlans.find((row) => row.studentId === studentId)?.billingMode ?? null;
  if (billingMode === 'per_session') {
    const sessions = new Map(data.sessions.map((session) => [session.id, session]));
    for (const occurrence of data.occurrences) {
      if (occurrence.status !== 'completed') continue;
      const session = sessions.get(occurrence.recurringSessionId);
      if (!session || !session.studentIds.includes(studentId)) continue;

      let obligationPence = 0;
      if (session.priceBasis === 'per_student') {
        obligationPence = Math.max(0, session.defaultPricePence);
      } else if (session.expectedStudentCount === 1) {
        obligationPence = Math.max(0, occurrence.grossPence);
      }
      if (!obligationPence) continue;

      duePence += Math.max(
        0,
        obligationPence - allocatedToTarget(data, 'occurrence', occurrence.id),
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
