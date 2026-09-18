import { calendarDateInTimeZone } from '../../platform/time/calendar-date';

export async function workspaceToday(
  db: D1Database,
  workspaceId: string,
  now: Date = new Date(),
): Promise<string> {
  const row = await db.prepare(
    `SELECT timezone
     FROM core_workspaces
     WHERE id=?1 AND active=1`,
  ).bind(workspaceId).first<{ timezone: string }>();

  if (!row?.timezone) throw new Error('WORKSPACE_NOT_FOUND');
  return calendarDateInTimeZone(row.timezone, now);
}
