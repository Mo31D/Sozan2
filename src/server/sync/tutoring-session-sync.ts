import { updateRecurringSessionDetailsSchema } from '../../modules/tutoring/domain/session';
import { SessionsService } from '../../modules/tutoring/services/sessions.service';
import { D1SessionRepository } from '../adapters/d1/tutoring-sessions.repository';
import type { ModuleSnapshot, ModuleSyncHandler, SyncMutation } from './contracts';
import { tutoringSyncHandler } from './tutoring.sync';

type BaselineRow = {
  workspace_id: string;
  student_id: string;
  completed_lessons_before_tracking: number;
  source_note: string | null;
  observed_at: string;
};

/**
 * Session lifecycle mutations are kept as a decorator around the tutoring sync
 * handler so the generic sync transport never needs tutoring-specific rules.
 * Domain policy lives in SessionsService; this adapter only supplies D1 and
 * validates cross-entity references that belong at the persistence boundary.
 */
export const tutoringSessionSyncHandler: ModuleSyncHandler = {
  moduleKey: tutoringSyncHandler.moduleKey,

  async apply(db: D1Database, workspaceId: string, mutation: SyncMutation): Promise<void> {
    const repository = new D1SessionRepository(db);
    const service = new SessionsService(repository, () => crypto.randomUUID());

    if (mutation.operation === 'session.details.update') {
      const details = updateRecurringSessionDetailsSchema.parse(mutation.payload);
      for (const studentId of details.studentIds) {
        const student = await db.prepare(
          `SELECT 1 AS found FROM tutoring_students
           WHERE workspace_id=?1 AND id=?2 AND active=1 AND deleted_at IS NULL LIMIT 1`,
        ).bind(workspaceId, studentId).first<{ found: number }>();
        if (!student) throw new Error('STUDENT_NOT_FOUND');
      }
      await service.updateDetails(workspaceId, mutation.entityId, details);
      return;
    }

    if (mutation.operation === 'session.archive') {
      await service.archive(workspaceId, mutation.entityId);
      return;
    }

    if (mutation.operation === 'session.restore') {
      await service.restore(workspaceId, mutation.entityId);
      return;
    }

    await tutoringSyncHandler.apply(db, workspaceId, mutation);
  },

  async snapshot(db: D1Database, workspaceId: string): Promise<ModuleSnapshot> {
    const base = await tutoringSyncHandler.snapshot(db, workspaceId);
    const baselines = await db.prepare(
      `SELECT workspace_id, student_id, completed_lessons_before_tracking, source_note, observed_at
       FROM tutoring_student_baselines
       WHERE workspace_id=?1
       ORDER BY student_id`,
    ).bind(workspaceId).all<BaselineRow>();
    const data = base.data as Record<string, unknown>;
    return {
      ...base,
      data: {
        ...data,
        studentBaselines: (baselines.results ?? []).map((row) => ({
          id: row.student_id,
          workspaceId: row.workspace_id,
          studentId: row.student_id,
          completedLessonsBeforeTracking: row.completed_lessons_before_tracking,
          sourceNote: row.source_note,
          observedAt: row.observed_at,
        })),
      },
    };
  },
};
