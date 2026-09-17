import { updateRecurringSessionDetailsSchema } from '../../modules/tutoring/domain/session';
import { D1SessionRepository } from '../adapters/d1/tutoring-sessions.repository';
import type { ModuleSnapshot, ModuleSyncHandler, SyncMutation } from './contracts';
import { tutoringSyncHandler } from './tutoring.sync';

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Session lifecycle mutations are kept as a decorator around the tutoring sync
 * handler so the generic sync transport never needs tutoring-specific rules.
 * The base handler remains replaceable and this layer can be removed/replaced
 * without touching sync routing or finance.
 */
export const tutoringSessionSyncHandler: ModuleSyncHandler = {
  moduleKey: tutoringSyncHandler.moduleKey,

  async apply(db: D1Database, workspaceId: string, mutation: SyncMutation): Promise<void> {
    const repository = new D1SessionRepository(db);

    if (mutation.operation === 'session.details.update') {
      const details = updateRecurringSessionDetailsSchema.parse(mutation.payload);
      const current = await repository.getById(workspaceId, mutation.entityId);
      if (!current.active) throw new Error('SESSION_ARCHIVED');

      for (const studentId of details.studentIds) {
        const student = await db.prepare(
          `SELECT 1 AS found FROM tutoring_students
           WHERE workspace_id=?1 AND id=?2 AND active=1 AND deleted_at IS NULL LIMIT 1`,
        ).bind(workspaceId, studentId).first<{ found: number }>();
        if (!student) throw new Error('STUDENT_NOT_FOUND');
      }

      if (await repository.hasHistory(workspaceId, mutation.entityId)) {
        const financeChanged = details.priceBasis !== current.priceBasis
          || details.defaultPricePence !== current.defaultPricePence
          || details.expectedStudentCount !== current.expectedStudentCount
          || details.centerCutBps !== current.centerCutBps
          || !sameIds(details.studentIds, current.studentIds);
        if (financeChanged) throw new Error('SESSION_FINANCE_LOCKED_BY_HISTORY');
      }

      await repository.updateDetails({ workspaceId, sessionId: mutation.entityId, details });
      return;
    }

    if (mutation.operation === 'session.archive') {
      await repository.archive(workspaceId, mutation.entityId);
      return;
    }

    if (mutation.operation === 'session.restore') {
      await repository.restore(workspaceId, mutation.entityId);
      return;
    }

    await tutoringSyncHandler.apply(db, workspaceId, mutation);
  },

  async snapshot(db: D1Database, workspaceId: string): Promise<ModuleSnapshot> {
    return tutoringSyncHandler.snapshot(db, workspaceId);
  },
};
