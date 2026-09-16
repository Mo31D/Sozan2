const WINDOW_MS = 10 * 60_000;
const BLOCK_MS = 15 * 60_000;
const MAX_ATTEMPTS = 10;
const encoder = new TextEncoder();

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function consumeAuthAttempt(
  db: D1Database,
  kind: 'login' | 'register' | 'recover',
  clientIdentity: string,
): Promise<void> {
  const key = await sha256(`${kind}:${clientIdentity}`);
  const now = Date.now();
  const row = await db.prepare(
    `SELECT window_started_at, attempts, blocked_until
     FROM core_auth_rate_limits WHERE bucket_key = ?1`,
  ).bind(key).first<{
    window_started_at: string;
    attempts: number;
    blocked_until: string | null;
  }>();

  if (row?.blocked_until && Date.parse(row.blocked_until) > now) {
    throw new Error('AUTH_RATE_LIMITED');
  }

  const windowExpired = !row || now - Date.parse(row.window_started_at) >= WINDOW_MS;
  const attempts = windowExpired ? 1 : row.attempts + 1;
  const windowStartedAt = windowExpired ? new Date(now).toISOString() : row.window_started_at;
  const blockedUntil = attempts > MAX_ATTEMPTS
    ? new Date(now + BLOCK_MS).toISOString()
    : null;

  await db.prepare(
    `INSERT INTO core_auth_rate_limits(bucket_key, window_started_at, attempts, blocked_until, updated_at)
     VALUES (?1, ?2, ?3, ?4, CURRENT_TIMESTAMP)
     ON CONFLICT(bucket_key) DO UPDATE SET
       window_started_at = excluded.window_started_at,
       attempts = excluded.attempts,
       blocked_until = excluded.blocked_until,
       updated_at = CURRENT_TIMESTAMP`,
  ).bind(key, windowStartedAt, attempts, blockedUntil).run();

  if (blockedUntil) throw new Error('AUTH_RATE_LIMITED');
}
