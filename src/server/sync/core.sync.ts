import { z } from 'zod';
import type { ModuleSnapshot, ModuleSyncHandler, SyncMutation } from './contracts';

const activitySchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  moduleKey: z.string().min(1).max(80),
  entityType: z.string().min(1).max(100),
  entityId: z.string().uuid().nullable(),
  action: z.string().min(1).max(120),
  title: z.string().min(1).max(200),
  detail: z.string().max(1000).nullable(),
  beforeJson: z.string().max(20000).nullable(),
  afterJson: z.string().max(20000).nullable(),
  undoable: z.boolean(),
  undoneAt: z.string().max(50).nullable(),
  createdAt: z.string().min(10).max(50),
});
const undoSchema = z.object({ undoneAt: z.string().min(10).max(50) });

type ActivityRow = {
  id: string;
  workspace_id: string;
  module_key: string;
  entity_type: string;
  entity_id: string | null;
  action: string;
  title: string;
  detail: string | null;
  before_json: string | null;
  after_json: string | null;
  undoable: number;
  undone_at: string | null;
  created_at: string;
};

export const coreSyncHandler: ModuleSyncHandler = {
  moduleKey: 'core',

  async apply(db: D1Database, workspaceId: string, mutation: SyncMutation): Promise<void> {
    if (mutation.operation === 'activity.record') {
      const parsed = activitySchema.parse(mutation.payload);
      if (parsed.workspaceId !== workspaceId || parsed.id !== mutation.entityId) {
        throw new Error('ACTIVITY_IDENTITY_MISMATCH');
      }
      await db.prepare(
        `INSERT OR IGNORE INTO core_activity_events(
           id, workspace_id, module_key, entity_type, entity_id, action, title, detail,
           before_json, after_json, undoable, undone_at, created_at
         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)`,
      ).bind(
        parsed.id,
        workspaceId,
        parsed.moduleKey,
        parsed.entityType,
        parsed.entityId,
        parsed.action,
        parsed.title,
        parsed.detail,
        parsed.beforeJson,
        parsed.afterJson,
        parsed.undoable ? 1 : 0,
        parsed.undoneAt,
        parsed.createdAt,
      ).run();
      return;
    }

    if (mutation.operation === 'activity.undo') {
      const parsed = undoSchema.parse(mutation.payload);
      const result = await db.prepare(
        `UPDATE core_activity_events SET undone_at=?1, undoable=0
         WHERE workspace_id=?2 AND id=?3`,
      ).bind(parsed.undoneAt, workspaceId, mutation.entityId).run();
      if ((result.meta?.changes ?? 0) === 0) throw new Error('ACTIVITY_NOT_FOUND');
      return;
    }

    throw new Error('SYNC_OPERATION_UNSUPPORTED');
  },

  async snapshot(db: D1Database, workspaceId: string): Promise<ModuleSnapshot> {
    const result = await db.prepare(
      `SELECT id, workspace_id, module_key, entity_type, entity_id, action, title, detail,
              before_json, after_json, undoable, undone_at, created_at
       FROM core_activity_events
       WHERE workspace_id=?1
       ORDER BY created_at DESC, id DESC
       LIMIT 500`,
    ).bind(workspaceId).all<ActivityRow>();
    return {
      moduleKey: 'core',
      data: {
        activityEvents: (result.results ?? []).map((row) => ({
          id: row.id,
          workspaceId: row.workspace_id,
          moduleKey: row.module_key,
          entityType: row.entity_type,
          entityId: row.entity_id,
          action: row.action,
          title: row.title,
          detail: row.detail,
          beforeJson: row.before_json,
          afterJson: row.after_json,
          undoable: row.undoable === 1,
          undoneAt: row.undone_at,
          createdAt: row.created_at,
        })),
      },
    };
  },
};
