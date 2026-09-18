import type { TutoringOccurrence } from '../domain/occurrence';

export type NewOccurrence = {
  id: string;
  workspaceId: string;
  recurringSessionId: string;
  sessionDate: string;
  scheduledStart: string | null;
};

export type CompletionSnapshot = {
  grossPence: number;
  centerCutPence: number;
  earnedPence: number;
  completedAt: string;
  note: string | null;
  participantStudentIds: string[];
  sessionStudentIds: string[];
  durationMinutes: number;
  travelMinutes: number;
  sessionType: string;
  location: string | null;
  priceBasis: 'total_session' | 'per_student';
  defaultPricePence: number;
  payerStudentId: string | null;
};

export interface OccurrenceRepository {
  listRange(workspaceId: string, from: string, to: string): Promise<TutoringOccurrence[]>;
  getById(workspaceId: string, occurrenceId: string): Promise<TutoringOccurrence | null>;
  insertScheduled(input: NewOccurrence[]): Promise<void>;
  complete(workspaceId: string, occurrenceId: string, snapshot: CompletionSnapshot): Promise<void>;
  setStatus(workspaceId: string, occurrenceId: string, status: 'scheduled' | 'cancelled' | 'missed'): Promise<void>;
  reschedule(input: {
    workspaceId: string;
    occurrenceId: string;
    date: string;
    startTime: string | null;
    note: string | null;
  }): Promise<void>;
}
