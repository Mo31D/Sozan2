import type {
  RecurringSession,
  UpdateRecurringSessionDetailsInput,
} from '../../../modules/tutoring/domain/session';
import type {
  NewRecurringSession,
  SessionRepository,
} from '../../../modules/tutoring/ports/session-repository';
import { activitySyncMutation, makeActivityEvent } from '../../activity/local-activity';
import type { LocalOccurrence } from '../../simple/data';
import { newSyncOutboxRecord } from '../../sync/outbox';
import { openLocalDatabase, requestResult, STORES, transactionDone } from './database';

export class IndexedDbSessionRepository implements SessionRepository {
  async listActive(workspaceId: string): Promise<RecurringSession[]> {
    const db = await openLocalDatabase();
    const transaction = db.transaction(STORES.tutoringSessions, 'readonly');
    const rows = await requestResult<RecurringSession[]>(
      transaction.objectStore(STORES.tutoringSessions).getAll(),
    );
    return rows
      .filter((row) => row.workspaceId === workspaceId && row.active)
      .sort((a, b) => {
        const aDay = a.weekday ?? 99;
        const bDay = b.weekday ?? 99;
        return aDay - bDay || (a.startTime ?? '99:99').localeCompare(b.startTime ?? '99:99');
      });
  }

  async getById(workspaceId: string, sessionId: string): Promise<RecurringSession> {
    const db = await openLocalDatabase();
    const row = await requestResult<RecurringSession | undefined>(
      db.transaction(STORES.tutoringSessions, 'readonly').objectStore(STORES.tutoringSessions).get(sessionId),
    );
    if (!row || row.workspaceId !== workspaceId) throw new Error('SESSION_NOT_FOUND');
    return row;
  }

  async create(input: NewRecurringSession): Promise<RecurringSession> {
    const session: RecurringSession = {
      id: input.id,
      workspaceId: input.workspaceId,
      title: input.title,
      sessionType: input.sessionType,
      scheduleStatus: input.scheduleStatus,
      weekday: input.weekday,
      startTime: input.startTime,
      durationMinutes: input.durationMinutes,
      travelMinutes: input.travelMinutes,
      location: input.location,
      priceBasis: input.priceBasis,
      defaultPricePence: input.defaultPricePence,
      expectedStudentCount: input.expectedStudentCount,
      centerCutBps: input.centerCutBps,
      active: true,
      studentIds: input.studentIds,
      payerStudentId: input.payerStudentId,
    };
    const activity = makeActivityEvent({
      workspaceId: input.workspaceId,
      moduleKey: 'tutoring',
      entityType: 'session',
      entityId: input.id,
      action: 'session.created',
      title: `تمت إضافة موعد ${input.title}`,
      after: session,
    });

    const db = await openLocalDatabase();
    const transaction = db.transaction(
      [STORES.tutoringSessions, STORES.coreActivityEvents, STORES.syncOutbox],
      'readwrite',
    );
    transaction.objectStore(STORES.tutoringSessions).add(session);
    transaction.objectStore(STORES.coreActivityEvents).add(activity);
    transaction.objectStore(STORES.syncOutbox).add(newSyncOutboxRecord({
      workspaceId: input.workspaceId,
      moduleKey: 'tutoring',
      operation: 'session.create',
      entityType: 'session',
      entityId: input.id,
      payload: {
        title: input.title,
        sessionType: input.sessionType,
        scheduleStatus: input.scheduleStatus,
        weekday: input.weekday,
        startTime: input.startTime,
        durationMinutes: input.durationMinutes,
        travelMinutes: input.travelMinutes,
        location: input.location,
        priceBasis: input.priceBasis,
        defaultPricePence: input.defaultPricePence,
        expectedStudentCount: input.expectedStudentCount,
        centerCutBps: input.centerCutBps,
        studentIds: input.studentIds,
        payerStudentId: input.payerStudentId,
      },
    }));
    transaction.objectStore(STORES.syncOutbox).add(activitySyncMutation(activity));
    await transactionDone(transaction);
    return session;
  }

  async updateSchedule(input: {
    workspaceId: string;
    sessionId: string;
    scheduleStatus: 'confirmed' | 'pending';
    weekday: number | null;
    startTime: string | null;
  }): Promise<RecurringSession> {
    const current = await this.getById(input.workspaceId, input.sessionId);
    const updated: RecurringSession = {
      ...current,
      scheduleStatus: input.scheduleStatus,
      weekday: input.weekday,
      startTime: input.startTime,
    };
    await this.persistUpdate(input.workspaceId, current, updated, 'session.schedule.update', {
      scheduleStatus: input.scheduleStatus,
      weekday: input.weekday,
      startTime: input.startTime,
    });
    return updated;
  }

  async updateDetails(input: {
    workspaceId: string;
    sessionId: string;
    details: UpdateRecurringSessionDetailsInput;
  }): Promise<RecurringSession> {
    const current = await this.getById(input.workspaceId, input.sessionId);
    if (!current.active) throw new Error('SESSION_ARCHIVED');
    const updated: RecurringSession = { ...current, ...input.details };
    await this.persistUpdate(input.workspaceId, current, updated, 'session.details.update', input.details);
    return updated;
  }

  async hasHistory(workspaceId: string, sessionId: string): Promise<boolean> {
    const db = await openLocalDatabase();
    const rows = await requestResult<LocalOccurrence[]>(
      db.transaction(STORES.tutoringOccurrences, 'readonly').objectStore(STORES.tutoringOccurrences).getAll(),
    );
    return rows.some((row) =>
      row.workspaceId === workspaceId
      && row.recurringSessionId === sessionId
      && (row.status === 'completed' || row.status === 'cancelled' || row.status === 'missed'),
    );
  }

  async archive(workspaceId: string, sessionId: string): Promise<void> {
    const current = await this.getById(workspaceId, sessionId);
    if (!current.active) return;
    const updated: RecurringSession = { ...current, active: false };
    await this.persistUpdate(workspaceId, current, updated, 'session.archive', {});
  }

  async restore(workspaceId: string, sessionId: string): Promise<void> {
    const current = await this.getById(workspaceId, sessionId);
    if (current.active) return;
    const updated: RecurringSession = { ...current, active: true };
    await this.persistUpdate(workspaceId, current, updated, 'session.restore', {});
  }

  private async persistUpdate(
    workspaceId: string,
    current: RecurringSession,
    updated: RecurringSession,
    operation: string,
    payload: unknown,
  ): Promise<void> {
    const activity = makeActivityEvent({
      workspaceId,
      moduleKey: 'tutoring',
      entityType: 'session',
      entityId: current.id,
      action: operation.replace(/\.update$/u, '.updated'),
      title: `تم تعديل ${updated.title}`,
      before: current,
      after: updated,
    });
    const db = await openLocalDatabase();
    const transaction = db.transaction(
      [STORES.tutoringSessions, STORES.coreActivityEvents, STORES.syncOutbox],
      'readwrite',
    );
    transaction.objectStore(STORES.tutoringSessions).put(updated);
    transaction.objectStore(STORES.coreActivityEvents).add(activity);
    transaction.objectStore(STORES.syncOutbox).add(newSyncOutboxRecord({
      workspaceId,
      moduleKey: 'tutoring',
      operation,
      entityType: 'session',
      entityId: current.id,
      payload,
    }));
    transaction.objectStore(STORES.syncOutbox).add(activitySyncMutation(activity));
    await transactionDone(transaction);
  }
}
