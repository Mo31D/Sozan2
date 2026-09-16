import type { CreateRecurringSessionInput, RecurringSession } from '../domain/session';

export type NewRecurringSession = CreateRecurringSessionInput & {
  id: string;
  workspaceId: string;
};

export interface SessionRepository {
  listActive(workspaceId: string): Promise<RecurringSession[]>;
  create(input: NewRecurringSession): Promise<RecurringSession>;
  updateSchedule(input: {
    workspaceId: string;
    sessionId: string;
    scheduleStatus: 'confirmed' | 'pending';
    weekday: number | null;
    startTime: string | null;
  }): Promise<RecurringSession>;
}
