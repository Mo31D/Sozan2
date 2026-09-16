import { packageUnitShare } from '../../modules/tutoring/domain/billing';
import type { RecurringSession } from '../../modules/tutoring/domain/session';
import { activitySyncMutation, makeActivityEvent } from '../activity/local-activity';
import { openLocalDatabase, requestResult, STORES, transactionDone } from '../adapters/indexeddb/database';
import { rebuildLocalStudentAllocations } from '../finance/corrections';
import type { LocalOccurrence } from '../simple/data';
import { newSyncOutboxRecord } from '../sync/outbox';
import type { LocalBillingCycle } from './local-commands';
import type { LocalBillingCycleOccurrence } from './attendance-commands';

const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/u;

type MutationAction = 'cancel' | 'restore' | 'reschedule';

function validTime(value: string | null | undefined): string | null {
  return value && CLOCK_TIME.test(value) ? value : null;
}

async function ensureOccurrence(
  workspaceId: string,
  session: RecurringSession,
  displayedDate: string,
  preferredId?: string,
): Promise<LocalOccurrence> {
  const db = await openLocalDatabase();
  const transaction = db.transaction(STORES.tutoringOccurrences, 'readwrite');
  const store = transaction.objectStore(STORES.tutoringOccurrences);
  const rows = await requestResult<LocalOccurrence[]>(store.getAll());
  const match = preferredId
    ? rows.find((row) => row.workspaceId === workspaceId && row.id === preferredId)
    : rows.find((row) => row.workspaceId === workspaceId && row.recurringSessionId === session.id && row.rescheduledToDate === displayedDate)
      ?? rows.find((row) => row.workspaceId === workspaceId && row.recurringSessionId === session.id && row.sessionDate === displayedDate);
  if (match) {
    await transactionDone(transaction);
    return match;
  }
  const occurrence: LocalOccurrence = {
    id: crypto.randomUUID(),
    workspaceId,
    recurringSessionId: session.id,
    sessionDate: displayedDate,
    scheduledStart: validTime(session.startTime),
    rescheduledToDate: null,
    rescheduledToStart: null,
    status: 'scheduled',
    grossPence: 0,
    centerCutPence: 0,
    earnedPence: 0,
    completedAt: null,
    note: null,
    studentIds: session.studentIds,
  };
  store.put(occurrence);
  await transactionDone(transaction);
  return occurrence;
}

async function writeSimpleOccurrenceMutation(
  workspaceId: string,
  session: RecurringSession,
  occurrence: LocalOccurrence,
  action: MutationAction,
  updated: LocalOccurrence,
  payload: Record<string, unknown>,
  title: string,
): Promise<void> {
  const db = await openLocalDatabase();
  const activity = makeActivityEvent({
    workspaceId,
    moduleKey: 'tutoring',
    entityType: 'occurrence',
    entityId: occurrence.id,
    action: `occurrence.${action}`,
    title,
    before: occurrence,
    after: updated,
    undoable: true,
  });
  const transaction = db.transaction(
    [STORES.tutoringOccurrences, STORES.coreActivityEvents, STORES.syncOutbox],
    'readwrite',
  );
  transaction.objectStore(STORES.tutoringOccurrences).put(updated);
  transaction.objectStore(STORES.coreActivityEvents).put(activity);
  transaction.objectStore(STORES.syncOutbox).add(newSyncOutboxRecord({
    workspaceId,
    moduleKey: 'tutoring',
    operation: `occurrence.${action}`,
    entityType: 'occurrence',
    entityId: occurrence.id,
    payload: {
      recurringSessionId: session.id,
      sessionDate: occurrence.sessionDate,
      scheduledStart: occurrence.scheduledStart,
      ...payload,
    },
  }));
  transaction.objectStore(STORES.syncOutbox).add(activitySyncMutation(activity));
  await transactionDone(transaction);
}

export async function cancelLocalOccurrence(
  workspaceId: string,
  session: RecurringSession,
  displayedDate: string,
  preferredId?: string,
): Promise<void> {
  const occurrence = await ensureOccurrence(workspaceId, session, displayedDate, preferredId);
  if (occurrence.status === 'completed') throw new Error('COMPLETED_REQUIRES_CORRECTION_FLOW');
  if (occurrence.status === 'cancelled') return;
  await writeSimpleOccurrenceMutation(
    workspaceId,
    session,
    occurrence,
    'cancel',
    { ...occurrence, status: 'cancelled' },
    {},
    `تم إلغاء حصة ${session.title}`,
  );
}

export async function restoreLocalOccurrence(
  workspaceId: string,
  session: RecurringSession,
  displayedDate: string,
  preferredId?: string,
): Promise<void> {
  const occurrence = await ensureOccurrence(workspaceId, session, displayedDate, preferredId);
  if (occurrence.status === 'completed') throw new Error('COMPLETED_REQUIRES_CORRECTION_FLOW');
  if (occurrence.status === 'scheduled') return;
  await writeSimpleOccurrenceMutation(
    workspaceId,
    session,
    occurrence,
    'restore',
    { ...occurrence, status: 'scheduled' },
    {},
    `تم استرجاع حصة ${session.title}`,
  );
}

export async function rescheduleLocalOccurrence(
  workspaceId: string,
  session: RecurringSession,
  displayedDate: string,
  date: string,
  startTime: string | null,
  note?: string | null,
  preferredId?: string,
): Promise<void> {
  const occurrence = await ensureOccurrence(workspaceId, session, displayedDate, preferredId);
  if (occurrence.status === 'completed') throw new Error('COMPLETED_REQUIRES_CORRECTION_FLOW');
  const cleanTime = validTime(startTime);
  const updated: LocalOccurrence = {
    ...occurrence,
    rescheduledToDate: date,
    rescheduledToStart: cleanTime,
    note: note?.trim() || occurrence.note,
    status: occurrence.status === 'cancelled' ? 'scheduled' : occurrence.status,
  };
  await writeSimpleOccurrenceMutation(
    workspaceId,
    session,
    occurrence,
    'reschedule',
    updated,
    { date, startTime: cleanTime, note: note?.trim() || null },
    `تم نقل حصة ${session.title}`,
  );
}

export async function reopenLocalOccurrence(
  workspaceId: string,
  occurrenceId: string,
): Promise<void> {
  const db = await openLocalDatabase();
  const readStores = [
    STORES.tutoringOccurrences,
    STORES.tutoringSessions,
    STORES.tutoringBillingCycles,
    STORES.tutoringBillingCycleOccurrences,
  ];
  const read = db.transaction(readStores, 'readonly');
  const [occurrence, sessions, cycles, mappings] = await Promise.all([
    requestResult<LocalOccurrence | undefined>(read.objectStore(STORES.tutoringOccurrences).get(occurrenceId)),
    requestResult<RecurringSession[]>(read.objectStore(STORES.tutoringSessions).getAll()),
    requestResult<LocalBillingCycle[]>(read.objectStore(STORES.tutoringBillingCycles).getAll()),
    requestResult<LocalBillingCycleOccurrence[]>(read.objectStore(STORES.tutoringBillingCycleOccurrences).getAll()),
  ]);
  if (!occurrence || occurrence.workspaceId !== workspaceId) throw new Error('OCCURRENCE_NOT_FOUND');
  if (occurrence.status !== 'completed') {
    if (occurrence.status === 'scheduled') return;
    throw new Error('OCCURRENCE_STATE_INVALID');
  }
  const session = sessions.find((row) => row.workspaceId === workspaceId && row.id === occurrence.recurringSessionId);
  if (!session) throw new Error('SESSION_NOT_FOUND');

  const affectedMappings = mappings.filter((row) => row.workspaceId === workspaceId && row.occurrenceId === occurrenceId);
  const packageStudentIds = session.studentIds.filter((studentId) =>
    cycles.some((cycle) => cycle.workspaceId === workspaceId && cycle.studentId === studentId),
  );
  if (packageStudentIds.length > 0 && affectedMappings.length === 0) {
    throw new Error('CORRECTION_REQUIRES_SYNC');
  }

  const correctionAt = new Date().toISOString();
  const updatedOccurrence: LocalOccurrence = {
    ...occurrence,
    status: 'scheduled',
    grossPence: 0,
    centerCutPence: 0,
    earnedPence: 0,
    completedAt: null,
  };
  const activity = makeActivityEvent({
    workspaceId,
    moduleKey: 'tutoring',
    entityType: 'occurrence',
    entityId: occurrenceId,
    action: 'occurrence.reopened',
    title: `تم إرجاع حصة ${session.title} لمجدولة`,
    before: occurrence,
    after: updatedOccurrence,
    undoable: false,
  });

  const transaction = db.transaction(
    [
      STORES.tutoringOccurrences,
      STORES.tutoringBillingCycles,
      STORES.tutoringBillingCycleOccurrences,
      STORES.coreActivityEvents,
      STORES.syncOutbox,
    ],
    'readwrite',
  );
  transaction.objectStore(STORES.tutoringOccurrences).put(updatedOccurrence);
  const cycleStore = transaction.objectStore(STORES.tutoringBillingCycles);
  const mappingStore = transaction.objectStore(STORES.tutoringBillingCycleOccurrences);

  const affectedStudentIds = new Set<string>(session.studentIds);
  for (const removed of affectedMappings) {
    mappingStore.delete(removed.id);
    const cycle = cycles.find((row) => row.id === removed.billingCycleId && row.workspaceId === workspaceId);
    if (!cycle) continue;
    affectedStudentIds.add(cycle.studentId);
    const remaining = mappings
      .filter((row) => row.workspaceId === workspaceId && row.billingCycleId === cycle.id && row.id !== removed.id)
      .sort((a, b) => a.position - b.position);
    let realCompletedCount = 0;
    for (const row of remaining) {
      realCompletedCount += 1;
      const position = cycle.openingCompletedCount + realCompletedCount;
      mappingStore.put({
        ...row,
        position,
        earnedPence: packageUnitShare(cycle.pricePence, cycle.sessionLimit, position),
      } satisfies LocalBillingCycleOccurrence);
    }
    const completed = cycle.openingCompletedCount + realCompletedCount >= cycle.sessionLimit;
    cycleStore.put({
      ...cycle,
      openingProgressLockedAt: cycle.openingProgressLockedAt ?? correctionAt,
      realCompletedCount,
      status: completed ? 'due' : 'open',
      completedOn: completed ? cycle.completedOn : null,
      paidOn: completed ? cycle.paidOn : null,
    } satisfies LocalBillingCycle);
  }

  transaction.objectStore(STORES.coreActivityEvents).put(activity);
  transaction.objectStore(STORES.syncOutbox).add(newSyncOutboxRecord({
    workspaceId,
    moduleKey: 'tutoring',
    operation: 'occurrence.reopen',
    entityType: 'occurrence',
    entityId: occurrenceId,
    payload: {},
  }));
  transaction.objectStore(STORES.syncOutbox).add(activitySyncMutation(activity));
  await transactionDone(transaction);

  for (const studentId of affectedStudentIds) {
    await rebuildLocalStudentAllocations(workspaceId, studentId);
  }
}
