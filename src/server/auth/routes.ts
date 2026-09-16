import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { AuthError, AuthService } from '../../platform/auth/service';
import { SESSION_TTL_SECONDS } from '../../platform/auth/security';
import { getWorkspaceTemplate } from '../../templates/catalog';
import { D1AuthRepository } from '../adapters/d1/auth.repository';
import type { Env } from '../env';
import { requireDatabase } from '../env';
import { consumeAuthAttempt } from './rate-limit';

const SESSION_COOKIE = 's2_session';

const registerSchema = z.object({
  loginName: z.string().min(3).max(64),
  password: z.string().min(10).max(200),
  displayName: z.string().trim().min(1).max(100),
  workspaceName: z.string().trim().min(1).max(120),
  templateKey: z.string().default('tutoring'),
  locale: z.string().min(2).max(20).default('ar-EG'),
  timezone: z.string().min(1).max(100).default('Europe/London'),
  currencyCode: z.string().length(3).default('EGP'),
  currencyLabel: z.string().min(1).max(10).default('ج'),
});

const loginSchema = z.object({
  loginName: z.string().min(1).max(64),
  password: z.string().min(1).max(200),
});

const recoverSchema = z.object({
  loginName: z.string().min(1).max(64),
  recoveryCode: z.string().min(10).max(200),
  newPassword: z.string().min(10).max(200),
});

function service(env: Env): AuthService {
  return new AuthService(new D1AuthRepository(requireDatabase(env)));
}

function clientIdentity(headers: Headers): string {
  return headers.get('CF-Connecting-IP') ?? headers.get('x-forwarded-for') ?? 'unknown';
}

function userAgentHint(headers: Headers): string | null {
  const value = headers.get('user-agent');
  return value ? value.slice(0, 160) : null;
}

function issueCookie(c: Parameters<typeof setCookie>[0], token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Strict',
    secure: c.req.url.startsWith('https://'),
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

function authErrorResponse(error: unknown): { status: 400 | 401 | 409 | 423 | 429 | 503; body: { error: string } } {
  const code = error instanceof AuthError || error instanceof Error ? error.message : 'AUTH_FAILED';
  if (code === 'DATABASE_NOT_CONFIGURED') return { status: 503, body: { error: code } };
  if (code === 'AUTH_RATE_LIMITED') return { status: 429, body: { error: code } };
  if (code === 'LOGIN_NAME_TAKEN') return { status: 409, body: { error: code } };
  if (code === 'ACCOUNT_TEMPORARILY_LOCKED') return { status: 423, body: { error: code } };
  if (['INVALID_CREDENTIALS', 'UNAUTHENTICATED', 'RECOVERY_FAILED'].includes(code)) {
    return { status: 401, body: { error: code } };
  }
  return { status: 400, body: { error: code } };
}

export const authRoutes = new Hono<{ Bindings: Env }>();

authRoutes.post('/register', async (c) => {
  try {
    const db = requireDatabase(c.env);
    await consumeAuthAttempt(db, 'register', clientIdentity(c.req.raw.headers));
    const parsed = registerSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'INVALID_INPUT' }, 400);

    const template = getWorkspaceTemplate(parsed.data.templateKey);
    if (!template?.implemented) return c.json({ error: 'TEMPLATE_NOT_IMPLEMENTED' }, 400);

    const result = await service(c.env).register({
      ...parsed.data,
      modules: template.modules.map((moduleKey, index) => ({
        moduleKey,
        position: (index + 1) * 10,
      })),
      labels: Object.entries(template.labels).map(([key, value]) => ({ key, value })),
      userAgentHint: userAgentHint(c.req.raw.headers),
    });
    issueCookie(c, result.token);
    return c.json({
      account: result.account,
      recoveryCode: result.recoveryCode,
      recoveryCodeShownOnce: true,
    }, 201);
  } catch (error) {
    const response = authErrorResponse(error);
    return c.json(response.body, response.status);
  }
});

authRoutes.post('/login', async (c) => {
  try {
    const db = requireDatabase(c.env);
    await consumeAuthAttempt(db, 'login', clientIdentity(c.req.raw.headers));
    const parsed = loginSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'INVALID_INPUT' }, 400);

    const result = await service(c.env).login({
      ...parsed.data,
      userAgentHint: userAgentHint(c.req.raw.headers),
    });
    issueCookie(c, result.token);
    return c.json({ account: result.account });
  } catch (error) {
    const response = authErrorResponse(error);
    return c.json(response.body, response.status);
  }
});

authRoutes.get('/me', async (c) => {
  try {
    const token = getCookie(c, SESSION_COOKIE);
    if (!token) return c.json({ error: 'UNAUTHENTICATED' }, 401);
    const result = await service(c.env).authenticate(token);
    return c.json({ account: result.account });
  } catch (error) {
    const response = authErrorResponse(error);
    return c.json(response.body, response.status);
  }
});

authRoutes.post('/logout', async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    try {
      await service(c.env).logout(token);
    } catch (error) {
      if (!(error instanceof Error && error.message === 'DATABASE_NOT_CONFIGURED')) throw error;
    }
  }
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

authRoutes.post('/recover', async (c) => {
  try {
    const db = requireDatabase(c.env);
    await consumeAuthAttempt(db, 'recover', clientIdentity(c.req.raw.headers));
    const parsed = recoverSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'INVALID_INPUT' }, 400);
    const result = await service(c.env).recover(parsed.data);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({
      ok: true,
      recoveryCode: result.recoveryCode,
      recoveryCodeShownOnce: true,
    });
  } catch (error) {
    const response = authErrorResponse(error);
    return c.json(response.body, response.status);
  }
});
