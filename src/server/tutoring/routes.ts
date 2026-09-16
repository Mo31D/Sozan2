import { Hono } from 'hono';
import { z } from 'zod';
import { FinanceCollectionService } from '../../modules/finance/allocation.service';
import { BillingService } from '../../modules/tutoring/services/billing.service';
import { SessionsService } from '../../modules/tutoring/services/sessions.service';
import { StudentsService } from '../../modules/tutoring/services/students.service';
import { D1BillingRepository } from '../adapters/d1/tutoring-billing.repository';
import { D1FinanceGateway } from '../adapters/d1/finance.gateway';
import { D1SessionRepository } from '../adapters/d1/tutoring-sessions.repository';
import { D1StudentRepository } from '../adapters/d1/tutoring-students.repository';
import { accessError, requireWorkspaceAccess } from '../auth/guard';
import type { Env } from '../env';
import { requireDatabase } from '../env';
import { TutoringObligationProvider } from '../integrations/tutoring-obligations.provider';

const collectionSchema = z.object({
  amountPence: z.number().int().positive(),
  receivedAt: z.string().min(10).max(40),
  paymentMethod: z.enum(['cash', 'bank', 'wallet', 'other']).default('cash'),
  note: z.string().trim().max(500).nullable().optional().default(null),
});

function routeError(error: unknown): { status: 400 | 401 | 403 | 404 | 409 | 503; error: string } {
  const access = accessError(error);
  if (access) return access;
  if (error instanceof z.ZodError) return { status: 400, error: 'INVALID_INPUT' };
  const code = error instanceof Error ? error.message : 'REQUEST_FAILED';
  if (code.endsWith('_NOT_FOUND')) return { status: 404, error: code };
  if (code.includes('LOCKED') || code.includes('HISTORY')) return { status: 409, error: code };
  return { status: 400, error: code };
}

export const tutoringRoutes = new Hono<{ Bindings: Env }>();

tutoringRoutes.get('/:workspaceId/students', async (c) => {
  try {
    const workspaceId = c.req.param('workspaceId');
    await requireWorkspaceAccess(c, workspaceId);
    const service = new StudentsService(new D1StudentRepository(requireDatabase(c.env)), crypto.randomUUID);
    return c.json({ students: await service.list(workspaceId) });
  } catch (error) {
    const response = routeError(error);
    return c.json({ error: response.error }, response.status);
  }
});

tutoringRoutes.post('/:workspaceId/students', async (c) => {
  try {
    const workspaceId = c.req.param('workspaceId');
    await requireWorkspaceAccess(c, workspaceId, true);
    const service = new StudentsService(new D1StudentRepository(requireDatabase(c.env)), crypto.randomUUID);
    const student = await service.create(workspaceId, await c.req.json());
    return c.json({ student }, 201);
  } catch (error) {
    const response = routeError(error);
    return c.json({ error: response.error }, response.status);
  }
});

tutoringRoutes.get('/:workspaceId/sessions', async (c) => {
  try {
    const workspaceId = c.req.param('workspaceId');
    await requireWorkspaceAccess(c, workspaceId);
    const service = new SessionsService(new D1SessionRepository(requireDatabase(c.env)), crypto.randomUUID);
    return c.json({ sessions: await service.list(workspaceId) });
  } catch (error) {
    const response = routeError(error);
    return c.json({ error: response.error }, response.status);
  }
});

tutoringRoutes.post('/:workspaceId/sessions', async (c) => {
  try {
    const workspaceId = c.req.param('workspaceId');
    await requireWorkspaceAccess(c, workspaceId, true);
    const service = new SessionsService(new D1SessionRepository(requireDatabase(c.env)), crypto.randomUUID);
    const session = await service.create(workspaceId, await c.req.json());
    return c.json({ session }, 201);
  } catch (error) {
    const response = routeError(error);
    return c.json({ error: response.error }, response.status);
  }
});

tutoringRoutes.patch('/:workspaceId/sessions/:sessionId/schedule', async (c) => {
  try {
    const workspaceId = c.req.param('workspaceId');
    await requireWorkspaceAccess(c, workspaceId, true);
    const service = new SessionsService(new D1SessionRepository(requireDatabase(c.env)), crypto.randomUUID);
    const session = await service.updateSchedule(
      workspaceId,
      c.req.param('sessionId'),
      await c.req.json(),
    );
    return c.json({ session });
  } catch (error) {
    const response = routeError(error);
    return c.json({ error: response.error }, response.status);
  }
});

tutoringRoutes.get('/:workspaceId/students/:studentId/billing', async (c) => {
  try {
    const workspaceId = c.req.param('workspaceId');
    await requireWorkspaceAccess(c, workspaceId);
    const service = new BillingService(new D1BillingRepository(requireDatabase(c.env)), crypto.randomUUID);
    return c.json({
      billing: await service.getStudentBilling(workspaceId, c.req.param('studentId')),
    });
  } catch (error) {
    const response = routeError(error);
    return c.json({ error: response.error }, response.status);
  }
});

tutoringRoutes.put('/:workspaceId/students/:studentId/billing', async (c) => {
  try {
    const workspaceId = c.req.param('workspaceId');
    await requireWorkspaceAccess(c, workspaceId, true);
    const service = new BillingService(new D1BillingRepository(requireDatabase(c.env)), crypto.randomUUID);
    const billing = await service.configure(
      workspaceId,
      c.req.param('studentId'),
      await c.req.json(),
    );
    return c.json({ billing });
  } catch (error) {
    const response = routeError(error);
    return c.json({ error: response.error }, response.status);
  }
});

tutoringRoutes.post('/:workspaceId/students/:studentId/collect', async (c) => {
  try {
    const workspaceId = c.req.param('workspaceId');
    await requireWorkspaceAccess(c, workspaceId, true);
    const parsed = collectionSchema.parse(await c.req.json());
    const db = requireDatabase(c.env);
    const service = new FinanceCollectionService(
      new D1FinanceGateway(db),
      [new TutoringObligationProvider(db)],
      crypto.randomUUID,
    );
    const result = await service.collect({
      workspaceId,
      payer: { type: 'tutoring.student', id: c.req.param('studentId') },
      amountPence: parsed.amountPence,
      receivedAt: parsed.receivedAt,
      paymentMethod: parsed.paymentMethod,
      sourceKind: 'manual',
      note: parsed.note,
    });
    return c.json({ collection: result }, 201);
  } catch (error) {
    const response = routeError(error);
    return c.json({ error: response.error }, response.status);
  }
});
