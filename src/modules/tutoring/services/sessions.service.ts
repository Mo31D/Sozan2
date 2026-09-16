import {
  createRecurringSessionSchema,
  updateRecurringScheduleSchema,
  type RecurringSession,
} from '../domain/session';
import type { SessionRepository } from '../ports/session-repository';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export class SessionsService {
  constructor(
    private readonly repository: SessionRepository,
    private readonly idFactory: () => string,
  ) {}

  list(workspaceId: string): Promise<RecurringSession[]> {
    return this.repository.listActive(workspaceId);
  }

  create(workspaceId: string, input: unknown, preferredId?: string): Promise<RecurringSession> {
    const parsed = createRecurringSessionSchema.parse(input);
    if (preferredId && !UUID_RE.test(preferredId)) throw new Error('SESSION_ID_INVALID');
    return this.repository.create({
      ...parsed,
      id: preferredId ?? this.idFactory(),
      workspaceId,
    });
  }

  updateSchedule(workspaceId: string, sessionId: string, input: unknown): Promise<RecurringSession> {
    const parsed = updateRecurringScheduleSchema.parse(input);
    return this.repository.updateSchedule({ workspaceId, sessionId, ...parsed });
  }
}
