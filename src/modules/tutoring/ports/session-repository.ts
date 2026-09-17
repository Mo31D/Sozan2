import type {
  CreateRecurringSessionInput,
  RecurringSession,
  UpdateRecurringSessionDetailsInput,
} from '../domain/session';

export type NewRecurringSession = CreateRecurringSessionInput & {
  id: string;
  workspaceId: string;
};

export interface SessionRepository {
  listActive(workspaceId: string): Promise<RecurringSession[]>;
  getById(workspaceId: string, sessionId: string): Promise<RecurringSession>;
  create(input: NewRecurringSession): Promise<RecurringSession>;
  updateSchedule(input: {
    workspaceId: string;
    sessionId: string;
    scheduleStatus: 'confirmed' | 'pending';
    weekday: number | null;
    startTime: string | null;
  }): Promise<RecurringSession>;
  updateDetails(input: {
    workspaceId: string;
    sessionId: string;
    details: UpdateRecurringSessionDetailsInput;
  }): Promise<RecurringSession>;
  hasHistory(workspaceId: string, sessionId: string): Promise<boolean>;
  archive(workspaceId: string, sessionId: string): Promise<void>;
  restore(workspaceId: string, sessionId: string): Promise<void>;
}
