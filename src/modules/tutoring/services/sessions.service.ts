import {
  createRecurringSessionSchema,
  updateRecurringScheduleSchema,
  updateRecurringSessionDetailsSchema,
  type RecurringSession,
} from '../domain/session';
import type { SessionRepository } from '../ports/session-repository';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

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

  async updateDetails(workspaceId: string, sessionId: string, input: unknown): Promise<RecurringSession> {
    const details = updateRecurringSessionDetailsSchema.parse(input);
    const current = await this.repository.getById(workspaceId, sessionId);
    if (!current.active) throw new Error('SESSION_ARCHIVED');

    if (await this.repository.hasHistory(workspaceId, sessionId)) {
      const financeChanged = details.priceBasis !== current.priceBasis
        || details.defaultPricePence !== current.defaultPricePence
        || details.expectedStudentCount !== current.expectedStudentCount
        || details.centerCutBps !== current.centerCutBps
        || !sameIds(details.studentIds, current.studentIds);
      if (financeChanged) throw new Error('SESSION_FINANCE_LOCKED_BY_HISTORY');
    }

    return this.repository.updateDetails({ workspaceId, sessionId, details });
  }

  archive(workspaceId: string, sessionId: string): Promise<void> {
    return this.repository.archive(workspaceId, sessionId);
  }

  restore(workspaceId: string, sessionId: string): Promise<void> {
    return this.repository.restore(workspaceId, sessionId);
  }
}
