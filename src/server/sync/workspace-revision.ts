export type WorkspaceRevisionState = {
  revision: number;
  writerToken: string | null;
  writeStartedAt: string | null;
};

export type WorkspaceWriteReservation =
  | { ok: true; token: string; baseRevision: number }
  | { ok: false; revision: number; busy: boolean };

const STALE_WRITE_MINUTES = 10;

async function ensureRevisionRow(db: D1Database, workspaceId: string): Promise<void> {
  await db.prepare(
    `INSERT OR IGNORE INTO core_workspace_sync_revisions(workspace_id, revision)
     VALUES(?1, 0)`,
  ).bind(workspaceId).run();
}

/**
 * A hard worker crash can leave a lease row behind. Before accepting new work,
 * turn a sufficiently old abandoned lease into a new revision and release it.
 * Incrementing the revision is conservative because the crashed writer may
 * have committed only part of its cross-module work.
 */
async function recoverStaleWriteLease(db: D1Database, workspaceId: string): Promise<void> {
  await db.prepare(
    `UPDATE core_workspace_sync_revisions
     SET revision=revision+1,
         writer_token=NULL,
         write_started_at=NULL,
         updated_at=CURRENT_TIMESTAMP
     WHERE workspace_id=?1
       AND writer_token IS NOT NULL
       AND write_started_at IS NOT NULL
       AND write_started_at < datetime('now', ?2)`,
  ).bind(workspaceId, `-${STALE_WRITE_MINUTES} minutes`).run();
}

export async function readWorkspaceRevisionState(
  db: D1Database,
  workspaceId: string,
): Promise<WorkspaceRevisionState> {
  await ensureRevisionRow(db, workspaceId);
  await recoverStaleWriteLease(db, workspaceId);
  const row = await db.prepare(
    `SELECT revision, writer_token, write_started_at
     FROM core_workspace_sync_revisions
     WHERE workspace_id=?1`,
  ).bind(workspaceId).first<{
    revision: number;
    writer_token: string | null;
    write_started_at: string | null;
  }>();

  return {
    revision: Math.max(0, Number(row?.revision ?? 0)),
    writerToken: row?.writer_token ?? null,
    writeStartedAt: row?.write_started_at ?? null,
  };
}

export async function readStableWorkspaceRevision(
  db: D1Database,
  workspaceId: string,
): Promise<number> {
  const state = await readWorkspaceRevisionState(db, workspaceId);
  if (state.writerToken) throw new Error('SYNC_WRITE_IN_PROGRESS');
  return state.revision;
}

export async function reserveWorkspaceWrite(
  db: D1Database,
  workspaceId: string,
  expectedRevision: number,
  token = crypto.randomUUID(),
): Promise<WorkspaceWriteReservation> {
  const state = await readWorkspaceRevisionState(db, workspaceId);
  if (state.writerToken) {
    return { ok: false, revision: state.revision, busy: true };
  }
  if (state.revision !== expectedRevision) {
    return { ok: false, revision: state.revision, busy: false };
  }

  const result = await db.prepare(
    `UPDATE core_workspace_sync_revisions
     SET writer_token=?3,
         write_started_at=CURRENT_TIMESTAMP,
         updated_at=CURRENT_TIMESTAMP
     WHERE workspace_id=?1
       AND revision=?2
       AND writer_token IS NULL`,
  ).bind(workspaceId, expectedRevision, token).run();

  if ((result.meta?.changes ?? 0) === 0) {
    const current = await readWorkspaceRevisionState(db, workspaceId);
    return {
      ok: false,
      revision: current.revision,
      busy: Boolean(current.writerToken),
    };
  }

  return { ok: true, token, baseRevision: expectedRevision };
}

export async function acquireWorkspaceWrite(
  db: D1Database,
  workspaceId: string,
  token = crypto.randomUUID(),
): Promise<WorkspaceWriteReservation> {
  const state = await readWorkspaceRevisionState(db, workspaceId);
  if (state.writerToken) {
    return { ok: false, revision: state.revision, busy: true };
  }
  return reserveWorkspaceWrite(db, workspaceId, state.revision, token);
}

export async function finalizeWorkspaceWrite(
  db: D1Database,
  workspaceId: string,
  token: string,
): Promise<number> {
  const result = await db.prepare(
    `UPDATE core_workspace_sync_revisions
     SET revision=revision+1,
         writer_token=NULL,
         write_started_at=NULL,
         updated_at=CURRENT_TIMESTAMP
     WHERE workspace_id=?1 AND writer_token=?2`,
  ).bind(workspaceId, token).run();

  if ((result.meta?.changes ?? 0) === 0) {
    throw new Error('SYNC_WRITE_LEASE_LOST');
  }
  return readStableWorkspaceRevision(db, workspaceId);
}

export async function withStableWorkspaceRead<T>(
  db: D1Database,
  workspaceId: string,
  read: () => Promise<T>,
  attempts = 3,
): Promise<{ revision: number; value: T }> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let before: number;
    try {
      before = await readStableWorkspaceRevision(db, workspaceId);
    } catch (error) {
      if (error instanceof Error && error.message === 'SYNC_WRITE_IN_PROGRESS') continue;
      throw error;
    }

    const value = await read();

    try {
      const after = await readStableWorkspaceRevision(db, workspaceId);
      if (before === after) return { revision: after, value };
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'SYNC_WRITE_IN_PROGRESS') throw error;
    }
  }
  throw new Error('SYNC_SNAPSHOT_UNSTABLE');
}


export async function withWorkspaceWrite<T>(
  db: D1Database,
  workspaceId: string,
  write: () => Promise<T>,
): Promise<{ revision: number; value: T }> {
  const reserved = await acquireWorkspaceWrite(db, workspaceId);
  if (!reserved.ok) {
    throw new Error(reserved.busy ? 'SYNC_WRITE_IN_PROGRESS' : 'SYNC_REVISION_CONFLICT');
  }

  let value: T | undefined;
  let writeError: unknown = null;
  try {
    value = await write();
  } catch (error) {
    writeError = error;
  }

  let revision: number;
  try {
    revision = await finalizeWorkspaceWrite(db, workspaceId, reserved.token);
  } catch (finalizeError) {
    if (writeError === null) throw finalizeError;
    // Preserve the original business/data error. A stale lease recovery will
    // conservatively advance the revision if finalization itself failed.
    throw writeError;
  }

  if (writeError !== null) throw writeError;
  return { revision, value: value as T };
}
