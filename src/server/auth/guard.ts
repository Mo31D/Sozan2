import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { AuthService } from '../../platform/auth/service';
import { D1AuthRepository } from '../adapters/d1/auth.repository';
import type { Env } from '../env';
import { requireDatabase } from '../env';

const SESSION_COOKIE = 's2_session';

export type WorkspaceAccess = {
  userId: string;
  workspaceId: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
};

export async function requireWorkspaceAccess(
  c: Context<{ Bindings: Env }>,
  workspaceId: string,
  write = false,
): Promise<WorkspaceAccess> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) throw new Error('UNAUTHENTICATED');

  const auth = new AuthService(new D1AuthRepository(requireDatabase(c.env)));
  const { account } = await auth.authenticate(token);
  const workspace = account.workspaces.find((item) => item.id === workspaceId);
  if (!workspace) throw new Error('WORKSPACE_FORBIDDEN');
  if (write && workspace.role === 'viewer') throw new Error('WORKSPACE_READ_ONLY');

  return { userId: account.user.id, workspaceId, role: workspace.role };
}

export function accessError(error: unknown): { status: 401 | 403 | 503; error: string } | null {
  const code = error instanceof Error ? error.message : '';
  if (code === 'DATABASE_NOT_CONFIGURED') return { status: 503, error: code };
  if (code === 'UNAUTHENTICATED') return { status: 401, error: code };
  if (code === 'WORKSPACE_FORBIDDEN' || code === 'WORKSPACE_READ_ONLY') {
    return { status: 403, error: code };
  }
  return null;
}
