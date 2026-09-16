import { packageUnitShare } from '../../modules/tutoring/domain/billing';
import type { RecurringSession } from '../../modules/tutoring/domain/session';
import { activitySyncMutation, makeActivityEvent } from '../activity/local-activity';
import { openLocalDatabase, requestResult, STORES, transactionDone } from '../adapters/indexeddb/database';
import { rebalanceStudentLocally } from '../finance/local-rebalance';
import { newSyncOutboxRecord } from '../sync/outbox';
import type { LocalBillingCycle, LocalBillingPlan } from './local-commands';
import type { LocalOccurrence } from '../simple/data';

const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/u;

export type LocalBillingCycleOccurrence = {
  id: string;
  workspaceId: string;
  billingCycleId: string;
  occurrenceId: string;
  position: number;
  earnedPence: number;
};

export async function completeLocalSession(
  workspaceId: string,
  session: RecurringSession,
  displayedDate: string,
  preferredOccurrenceId?: string,
): Promise<void> {
  const db = await openLocalDatabase();
  const transaction = db.transaction(
    [
      STORES.tutoringOccurrences,
      STORES.tutoringBillingPlans,
      STORES.tutoringBillingCycles,
      STORES.tutoringBillingCycleOccurrences,
      STORES.coreActivityEvents,
      STORES.syncOutbox,
    ],
    'readwrite',
  );
  const occurrenceStore = transaction.objectStore(STORES.tutoringOccurrences);
  const planStore = transaction.objectStore(STORES.tutoringBillingPlans);
  const cycleStore = transaction.objectStore(STORES.tutoringBillingCycles);
  const cycleOccurrenceStore = transaction.objectStore(STORES.tutoringBillingCycleOccurrences);

  const [occurrences, plans, cycles, cycleOccurrences] = await Promise.all([
    requestResult<LocalOccurrence[]>(occurrenceStore.getAll()),
    requestResult<LocalBillingPlan[]>(planStore.getAll()),
    requestResult<LocalBillingCycle[]>(cycleStore.getAll()),
    requestResult<LocalBillingCycleOccurrence[]>(cycleOccurrenceStore.getAll()),
  ]);

  const matching = occurrences.filter((row) => row.workspaceId === workspaceId && row.recurringSessionId === session.id);
  const existing = preferredOccurrenceId
    ? matching.find((row) => row.id === preferredOccurrenceId)
    : matching.find((row) => row.rescheduledToDate === displayedDate)
      ?? matching.find((row) => row.sessionDate === displayedDate);

  if (existing?.status === 'completed') {
    await transactionDone(transaction);
    return;
  }

  const originalSessionDate = existing?.sessionDate ?? displayedDate;
  const effectiveDate = existing?.rescheduledToDate ?? displayedDate;
  const chargeableCount = Math.max(session.studentIds.length, session.expectedStudentCount, 1);
  const grossPence = session.priceBasis === 'per_student'
    ? session.defaultPricePence * chargeableCount
    : session.defaultPricePence;
  const centerCutPence = Math.floor((grossPence * session.centerCutBps) / 10_000);
  const earnedPence = Math.max(0, grossPence - centerCutPence);
  const completedAt = new Date().toISOString();
  const occurrenceId = existing?.id ?? crypto.randomUUID();
  const fallbackStart = session.startTime && CLOCK_TIME.test(session.startTime) ? session.startTime : null;
  const scheduledStart = existing?.scheduledStart && CLOCK_TIME.test(existing.scheduledStart)
    ? existing.scheduledStart
    : fallbackStart;

  const completedOccurrence: LocalOccurrence = {
    id: occurrenceId,
    workspaceId,
    recurringSessionId: session.id,
    sessionDate: originalSessionDate,
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
  };
  occurrenceStore.put(completedOccurrence);

  for (const studentId of session.studentIds) {
    const plan = plans.find((row) => row.workspaceId === workspaceId && row.studentId === studentId);
    if (!plan || plan.billingMode !== 'package') continue;

    const alreadyLinked = cycleOccurrences.some((row) =>
      row.workspaceId === workspaceId && row.occurrenceId === occurrenceId
      && cycles.some((cycle) => cycle.id === row.billingCycleId && cycle.studentId === studentId),
    );
    if (alreadyLinked) continue;

    const studentCycles = cycles
      .filter((row) => row.workspaceId === workspaceId && row.studentId === studentId && row.status !== 'cancelled')
      .sort((a, b) => b.sequenceNo - a.sequenceNo);
    let cycle = studentCycles.find((row) => row.status === 'open') ?? null;
    if (!cycle) {
      const maxSequence = studentCycles.reduce((max, row) => Math.max(max, row.sequenceNo), 0);
      cycle = {
        id: crypto.randomUUID(),
        workspaceId,
        studentId,
        sequenceNo: maxSequence + 1,
        sessionLimit: plan.packageSize ?? 8,
        pricePence: plan.packagePricePence ?? 0,
        openingCompletedCount: 0,
        openingProgressLockedAt: null,
        realCompletedCount: 0,
        status: 'open',
        startedOn: effectiveDate,
        completedOn: null,
        paidOn: null,
      };
    }

    const position = cycle.openingCompletedCount + cycle.realCompletedCount + 1;
    if (position > cycle.sessionLimit) throw new Error('PACKAGE_CYCLE_ALREADY_COMPLETE');
    const mapping: LocalBillingCycleOccurrence = {
      id: `${cycle.id}:${occurrenceId}`,
      workspaceId,
      billingCycleId: cycle.id,
      occurrenceId,
      position,
      earnedPence: packageUnitShare(cycle.pricePence, cycle.sessionLimit, position),
    };
    cycleOccurrenceStore.put(mapping);

    const realCompletedCount = cycle.realCompletedCount + 1;
    const completed = cycle.openingCompletedCount + realCompletedCount >= cycle.sessionLimit;
    const updatedCycle: LocalBillingCycle = {
      ...cycle,
      openingProgressLockedAt: cycle.openingProgressLockedAt ?? completedAt,
      realCompletedCount,
      status: completed ? 'due' : 'open',
      completedOn: completed ? effectiveDate : cycle.completedOn,
      paidOn: completed ? cycle.paidOn : null,
    };
    cycleStore.put(updatedCycle);
    const existingIndex = cycles.findIndex((row) => row.id === cycle.id);
    if (existingIndex >= 0) cycles[existingIndex] = updatedCycle;
    else cycles.push(updatedCycle);
    cycleOccurrences.push(mapping);
  }

  const activity = makeActivityEvent({
    workspaceId,
    moduleKey: 'tutoring',
    entityType: 'occurrence',
    entityId: occurrenceId,
    action: 'occurrence.completed',
    title: `تم تسجيل حصة ${session.title}`,
    before: existing ?? null,
    after: completedOccurrence,
  });
  transaction.objectStore(STORES.coreActivityEvents).add(activity);
  transaction.objectStore(STORES.syncOutbox).add(newSyncOutboxRecord({
    workspaceId,
    moduleKey: 'tutoring',
    operation: 'occurrence.complete',
    entityType: 'occurrence',
    entityId: occurrenceId,
    payload: {
      recurringSessionId: session.id,
      sessionDate: originalSessionDate,
      scheduledStart,
      completedAt,
      note: null,
    },
  }));
  transaction.objectStore(STORES.syncOutbox).add(activitySyncMutation(activity));

  await transactionDone(transaction);
  for (const studentId of session.studentIds) {
    await rebalanceStudentLocally(workspaceId, studentId);
  }
}
