import { Hono } from 'hono';
import { accessError, requireWorkspaceAccess } from '../auth/guard';
import type { Env } from '../env';
import { requireDatabase } from '../env';

export const workspaceRoutes = new Hono<{ Bindings: Env }>();

workspaceRoutes.get('/:workspaceId/bootstrap', async (c) => {
  try {
    const workspaceId = c.req.param('workspaceId');
    await requireWorkspaceAccess(c, workspaceId);
    const db = requireDatabase(c.env);

    const workspace = await db.prepare(
      `SELECT id, name, template_key, locale, timezone, currency_code, currency_label
       FROM core_workspaces
       WHERE id = ?1 AND active = 1`,
    ).bind(workspaceId).first<{
      id: string;
      name: string;
      template_key: string;
      locale: string;
      timezone: string;
      currency_code: string;
      currency_label: string;
    }>();
    if (!workspace) return c.json({ error: 'WORKSPACE_NOT_FOUND' }, 404);

    const [modules, labels] = await Promise.all([
      db.prepare(
        `SELECT module_key, enabled, position, config_json, updated_at
         FROM core_workspace_modules
         WHERE workspace_id = ?1
         ORDER BY position, module_key`,
      ).bind(workspaceId).all<{
        module_key: string;
        enabled: number;
        position: number;
        config_json: string | null;
        updated_at: string;
      }>(),
      db.prepare(
        `SELECT label_key, value, updated_at
         FROM core_workspace_labels
         WHERE workspace_id = ?1
         ORDER BY label_key`,
      ).bind(workspaceId).all<{
        label_key: string;
        value: string;
        updated_at: string;
      }>(),
    ]);

    return c.json({
      workspace: {
        id: workspace.id,
        name: workspace.name,
        templateKey: workspace.template_key,
        locale: workspace.locale,
        timezone: workspace.timezone,
        currencyCode: workspace.currency_code,
        currencyLabel: workspace.currency_label,
      },
      modules: (modules.results ?? []).map((row) => ({
        moduleKey: row.module_key,
        enabled: row.enabled === 1,
        position: row.position,
        configJson: row.config_json,
        updatedAt: row.updated_at,
      })),
      labels: Object.fromEntries((labels.results ?? []).map((row) => [row.label_key, row.value])),
    });
  } catch (error) {
    const access = accessError(error);
    if (access) return c.json({ error: access.error }, access.status);
    return c.json({ error: error instanceof Error ? error.message : 'WORKSPACE_BOOTSTRAP_FAILED' }, 400);
  }
});
