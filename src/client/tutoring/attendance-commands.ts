import type { RecurringSession } from '../../modules/tutoring/domain/session';
import { openLocalDatabase, requestResult, STORES, transactionDone } from '../adapters/indexeddb/database';
import { newSyncOutboxRecord } from '../sync/outbox';
import type { LocalBillingCycle, LocalBillingPlan } from './local-commands';
import type { LocalOccurrence } from '../simple/data';

const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/u;

export async function completeLocalSession(
  workspaceId: string,
  session: RecurringSession,
  sessionDate: string,
): Promise<void> {
  const db = await openLocalDatabase();
  const transaction = db.transaction(
    [STORES.tutoringOccurrences, STORES.tutoringBillingPlans, STORES.tutoringBillingCycles, STORES.syncOutbox],
    'readwrite',
  );
  const occurrenceStore = transaction.objectStore(STORES.tutoringOccurrences);
  const planStore = transaction.objectStore(STORES.tutoringBillingPlans);
  const cycleStore = transaction.objectStore(STORES.tutoringBillingCycles);

  const [occurrences, plans, cycles] = await Promise.all([
    requestResult<LocalOccurrence[]>(occurrenceStore.getAll()),
    requestResult<LocalBillingPlan[]>(planStore.getAll()),
    requestResult<LocalBillingCycle[]>(cycleStore.getAll()),
  ]);

  const existing = occurrences.find((row) =>
    row.workspaceId === workspaceId
    && row.recurringSessionId === session.id
    && row.sessionDate === sessionDate,
  );
  if (existing?.status === 'completed') {
    await transactionDone(transaction);
    return;
  }

  const chargeableCount = Math.max(session.studentIds.length, session.expectedStudentCount, 1);
  const grossPence = session.priceBasis === 'per_student'
    ? session.defaultPricePence * chargeableCount
    : session.defaultPricePence;
  const centerCutPence = Math.floor((grossPence * session.centerCutBps) / 10_000);
  const earnedPence = Math.max(0, grossPence - centerCutPence);
  const completedAt = new Date().toISOString();
  const occurrenceId = existing?.id ?? crypto.randomUUID();
  const scheduledStart = session.startTime && CLOCK_TIME.test(session.startTime) ? session.startTime : null;

  occurrenceStore.put({
    id: occurrenceId,
    workspaceId,
    recurringSessionId: session.id,
    sessionDate,
    scheduledStart,
    rescheduledToDate: existing?.rescheduledToDate ?? null,
    rescheduledToStart: existing?.rescheduledToStart ?? null,
    status: 'completed',
    grossPence,
    centerCutPence,
    earnedPence,
    completedAt,
    note: existing?.note ?? null,
    studentIds: session.studentIds,
  } satisfies LocalOccurrence);

  if (existing?.status !== 'completed') {
    for (const studentId of session.studentIds) {
      const plan = plans.find((row) => row.workspaceId === workspaceId && row.studentId === studentId);
      if (!plan || plan.billingMode !== 'package') continue;
      const studentCycles = cycles
        .filter((row) => row.workspaceId === workspaceId && row.studentId === studentId && row.status !== 'cancelled')
        .sort((a, b) => b.sequenceNo - a.sequenceNo);
      let cycle = studentCycles.find((row) => row.status === 'open') ?? studentCycles[0] ?? null;
      if (!cycle || cycle.status !== 'open') {
        const maxSequence = studentCycles.reduce((max, row) => Math.max(max, row.sequenceNo), 0);
        cycle = {
          id: crypto.randomUUID(),
          workspaceId,
          studentId,
          sequenceNo: maxSequence + 1,
          sessionLimit: plan.packageSize ?? 8,
          pricePence: plan.packagePricePence ?? 0,
          openingCompletedCount: 0,
          realCompletedCount: 0,
          status: 'open',
          startedOn: sessionDate,
          completedOn: null,
          paidOn: null,
        };
      }
      const realCompletedCount = cycle.realCompletedCount + 1;
      const completed = cycle.openingCompletedCount + realCompletedCount >= cycle.sessionLimit;
      cycleStore.put({
        ...cycle,
        realCompletedCount,
        status: completed ? 'due' : 'open',
        completedOn: completed ? sessionDate : cycle.completedOn,
      } satisfies LocalBillingCycle);
    }
  }

  transaction.objectStore(STORES.syncOutbox).add(newSyncOutboxRecord({
    workspaceId,
    moduleKey: 'tutoring',
    operation: 'occurrence.complete',
    entityType: 'occurrence',
    entityId: occurrenceId,
    payload: {
      recurringSessionId: session.id,
      sessionDate,
      scheduledStart,
      completedAt,
      note: null,
    },
  }));

  await transactionDone(transaction);
}
