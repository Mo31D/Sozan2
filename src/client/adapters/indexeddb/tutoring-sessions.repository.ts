import type { RecurringSession } from '../../../modules/tutoring/domain/session';
import type {
  NewRecurringSession,
  SessionRepository,
} from '../../../modules/tutoring/ports/session-repository';
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
    };

    const db = await openLocalDatabase();
    const transaction = db.transaction(
      [STORES.tutoringSessions, STORES.syncOutbox],
      'readwrite',
    );
    transaction.objectStore(STORES.tutoringSessions).add(session);
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
      },
    }));
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
    const db = await openLocalDatabase();
    const transaction = db.transaction(
      [STORES.tutoringSessions, STORES.syncOutbox],
      'readwrite',
    );
    const store = transaction.objectStore(STORES.tutoringSessions);
    const current = await requestResult<RecurringSession | undefined>(store.get(input.sessionId));
    if (!current || current.workspaceId !== input.workspaceId) throw new Error('SESSION_NOT_FOUND');

    const updated: RecurringSession = {
      ...current,
      scheduleStatus: input.scheduleStatus,
      weekday: input.weekday,
      startTime: input.startTime,
    };
    store.put(updated);
    transaction.objectStore(STORES.syncOutbox).add(newSyncOutboxRecord({
      workspaceId: input.workspaceId,
      moduleKey: 'tutoring',
      operation: 'session.schedule.update',
      entityType: 'session',
      entityId: input.sessionId,
      payload: {
        scheduleStatus: input.scheduleStatus,
        weekday: input.weekday,
        startTime: input.startTime,
      },
    }));
    await transactionDone(transaction);
    return updated;
  }
}
