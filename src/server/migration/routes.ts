import { Hono } from 'hono';
import { accessError, requireWorkspaceAccess } from '../auth/guard';
import type { Env } from '../env';
import { requireDatabase } from '../env';
import { normalizeSozan1PayloadForImport } from './normalize';
import { markMigrationUnverified, reconcileSozan1Migration } from './reconcile';
import { importSozan1, parseSozan1Export } from './sozan1';

export const migrationRoutes = new Hono<{ Bindings: Env }>();

migrationRoutes.post('/:workspaceId/sozan1', async (c) => {
  try {
    const workspaceId = c.req.param('workspaceId');
    const access = await requireWorkspaceAccess(c, workspaceId, true);
    if (access.role !== 'owner' && access.role !== 'admin') {
      return c.json({ error: 'MIGRATION_OWNER_REQUIRED' }, 403);
    }

    const rawPayload: unknown = await c.req.json();
    const normalizedPayload = normalizeSozan1PayloadForImport(rawPayload);
    const payload = parseSozan1Export(normalizedPayload);
    const db = requireDatabase(c.env);
    const result = await importSozan1(
      db,
      workspaceId,
      access.userId,
      payload,
    );

    const reconciliation = await reconcileSozan1Migration(db, workspaceId, normalizedPayload);
    if (!reconciliation.ok) {
      await markMigrationUnverified(db, workspaceId);
      console.error('Sozan1 migration reconciliation failed', reconciliation.mismatches);
      return c.json({
        error: 'MIGRATION_RECONCILIATION_FAILED',
        reconciliation,
      }, 409);
    }

    // Migration writes bypass the normal sync mutation endpoint, so publish a
    // new workspace revision explicitly. Connected devices will then pull the
    // imported canonical state instead of treating their old snapshot as current.
    await db.prepare(
      `INSERT OR IGNORE INTO core_workspace_sync_revisions(workspace_id,revision)
       VALUES(?1,0)`,
    ).bind(workspaceId).run();
    await db.prepare(
      `UPDATE core_workspace_sync_revisions
       SET revision=revision+1,updated_at=CURRENT_TIMESTAMP
       WHERE workspace_id=?1`,
    ).bind(workspaceId).run();

    return c.json({ ok: true, ...result, reconciliation });
  } catch (error) {
    const access = accessError(error);
    if (access) return c.json({ error: access.error }, access.status);

    const code = error instanceof Error ? error.message : 'MIGRATION_FAILED';
    if (code === 'MIGRATION_ALREADY_COMPLETED') {
      return c.json({ error: code }, 409);
    }
    if (code === 'MIGRATION_TARGET_NOT_EMPTY') {
      return c.json({ error: code }, 409);
    }
    if (code === 'MIGRATION_FILE_INVALID' || code === 'MIGRATION_FILE_VERSION_UNSUPPORTED') {
      return c.json({ error: code }, 400);
    }
    console.error('Sozan1 migration failed', error);
    return c.json({ error: code || 'MIGRATION_FAILED' }, 500);
  }
});
