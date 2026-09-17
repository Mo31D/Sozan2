import {
  updateRecurringSessionDetailsSchema,
  type RecurringSession,
  type UpdateRecurringSessionDetailsInput,
} from '../../modules/tutoring/domain/session';
import { activitySyncMutation, makeActivityEvent } from '../activity/local-activity';
import { openLocalDatabase, requestResult, STORES, transactionDone } from '../adapters/indexeddb/database';
import { newSyncOutboxRecord } from '../sync/outbox';
import type { LocalOccurrence } from '../simple/data';

export type SessionDetailsCorrection = UpdateRecurringSessionDetailsInput;

async function getSession(workspaceId: string, sessionId: string): Promise<RecurringSession> {
  const db = await openLocalDatabase();
  const row = await requestResult<RecurringSession | undefined>(
    db.transaction(STORES.tutoringSessions, 'readonly').objectStore(STORES.tutoringSessions).get(sessionId),
  );
  if (!row || row.workspaceId !== workspaceId) throw new Error('SESSION_NOT_FOUND');
  return row;
}

export async function updateLocalSessionDetails(
  workspaceId: string,
  sessionId: string,
  rawInput: SessionDetailsCorrection,
): Promise<void> {
  const input = updateRecurringSessionDetailsSchema.parse(rawInput);
  const current = await getSession(workspaceId, sessionId);
  if (!current.active) throw new Error('SESSION_ARCHIVED');
  const db = await openLocalDatabase();
  const occurrenceRows = await requestResult<LocalOccurrence[]>(
    db.transaction(STORES.tutoringOccurrences, 'readonly').objectStore(STORES.tutoringOccurrences).getAll(),
  );
  const hasHistory = occurrenceRows.some((row) =>
    row.workspaceId === workspaceId
    && row.recurringSessionId === sessionId
    && ['completed', 'cancelled', 'missed'].includes(row.status),
  );
  if (hasHistory) {
    const nextStudents = [...input.studentIds].sort();
    const currentStudents = [...current.studentIds].sort();
    const financeChanged = input.priceBasis !== current.priceBasis
      || input.defaultPricePence !== current.defaultPricePence
      || input.expectedStudentCount !== current.expectedStudentCount
      || input.centerCutBps !== current.centerCutBps
      || JSON.stringify(nextStudents) !== JSON.stringify(currentStudents);
    if (financeChanged) throw new Error('SESSION_FINANCE_LOCKED_BY_HISTORY');
  }

  const updated: RecurringSession = { ...current, ...input };
  const activity = makeActivityEvent({
    workspaceId,
    moduleKey: 'tutoring',
    entityType: 'session',
    entityId: sessionId,
    action: 'session.details.updated',
    title: `تم تعديل ${updated.title}`,
    detail: 'التعديل على الموعد والبيانات القادمة فقط؛ التاريخ السابق محفوظ.',
    before: current,
    after: updated,
    undoable: false,
  });
  const tx = db.transaction([STORES.tutoringSessions, STORES.coreActivityEvents, STORES.syncOutbox], 'readwrite');
  tx.objectStore(STORES.tutoringSessions).put(updated);
  tx.objectStore(STORES.coreActivityEvents).put(activity);
  tx.objectStore(STORES.syncOutbox).add(newSyncOutboxRecord({
    workspaceId,
    moduleKey: 'tutoring',
    operation: 'session.details.update',
    entityType: 'session',
    entityId: sessionId,
    payload: input,
  }));
  tx.objectStore(STORES.syncOutbox).add(activitySyncMutation(activity));
  await transactionDone(tx);
}

export async function archiveLocalSession(workspaceId: string, sessionId: string): Promise<void> {
  const current = await getSession(workspaceId, sessionId);
  if (!current.active) return;
  const updated: RecurringSession = { ...current, active: false };
  const activity = makeActivityEvent({
    workspaceId,
    moduleKey: 'tutoring',
    entityType: 'session',
    entityId: sessionId,
    action: 'session.archived',
    title: `تم إيقاف ${current.title}`,
    detail: 'المواعيد الجديدة توقفت والتاريخ السابق محفوظ.',
    before: current,
    after: updated,
    undoable: true,
  });
  const db = await openLocalDatabase();
  const tx = db.transaction([STORES.tutoringSessions, STORES.coreActivityEvents, STORES.syncOutbox], 'readwrite');
  tx.objectStore(STORES.tutoringSessions).put(updated);
  tx.objectStore(STORES.coreActivityEvents).put(activity);
  tx.objectStore(STORES.syncOutbox).add(newSyncOutboxRecord({
    workspaceId, moduleKey: 'tutoring', operation: 'session.archive', entityType: 'session', entityId: sessionId, payload: {},
  }));
  tx.objectStore(STORES.syncOutbox).add(activitySyncMutation(activity));
  await transactionDone(tx);
}

export async function restoreLocalSession(workspaceId: string, sessionId: string): Promise<void> {
  const current = await getSession(workspaceId, sessionId);
  if (current.active) return;
  const updated: RecurringSession = { ...current, active: true };
  const activity = makeActivityEvent({
    workspaceId,
    moduleKey: 'tutoring',
    entityType: 'session',
    entityId: sessionId,
    action: 'session.restored',
    title: `تم استرجاع ${current.title}`,
    before: current,
    after: updated,
  });
  const db = await openLocalDatabase();
  const tx = db.transaction([STORES.tutoringSessions, STORES.coreActivityEvents, STORES.syncOutbox], 'readwrite');
  tx.objectStore(STORES.tutoringSessions).put(updated);
  tx.objectStore(STORES.coreActivityEvents).put(activity);
  tx.objectStore(STORES.syncOutbox).add(newSyncOutboxRecord({
    workspaceId, moduleKey: 'tutoring', operation: 'session.restore', entityType: 'session', entityId: sessionId, payload: {},
  }));
  tx.objectStore(STORES.syncOutbox).add(activitySyncMutation(activity));
  await transactionDone(tx);
}
