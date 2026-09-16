import {
  createRecurringSessionSchema,
  updateRecurringScheduleSchema,
  type RecurringSession,
} from '../domain/session';
import type { SessionRepository } from '../ports/session-repository';

export class SessionsService {
  constructor(
    private readonly repository: SessionRepository,
    private readonly idFactory: () => string,
  ) {}

  list(workspaceId: string): Promise<RecurringSession[]> {
    return this.repository.listActive(workspaceId);
  }

  create(workspaceId: string, input: unknown): Promise<RecurringSession> {
    const parsed = createRecurringSessionSchema.parse(input);
    return this.repository.create({
      ...parsed,
      id: this.idFactory(),
      workspaceId,
    });
  }

  updateSchedule(workspaceId: string, sessionId: string, input: unknown): Promise<RecurringSession> {
    const parsed = updateRecurringScheduleSchema.parse(input);
    return this.repository.updateSchedule({ workspaceId, sessionId, ...parsed });
  }
}
