import type { UpdateRecurringSessionDetailsInput } from '../../modules/tutoring/domain/session';
import { SessionsService } from '../../modules/tutoring/services/sessions.service';
import { IndexedDbSessionRepository } from '../adapters/indexeddb/tutoring-sessions.repository';

export type SessionDetailsCorrection = UpdateRecurringSessionDetailsInput;

function service(): SessionsService {
  return new SessionsService(new IndexedDbSessionRepository(), () => crypto.randomUUID());
}

export async function updateLocalSessionDetails(
  workspaceId: string,
  sessionId: string,
  input: SessionDetailsCorrection,
): Promise<void> {
  await service().updateDetails(workspaceId, sessionId, input);
}

export async function archiveLocalSession(workspaceId: string, sessionId: string): Promise<void> {
  await service().archive(workspaceId, sessionId);
}

export async function restoreLocalSession(workspaceId: string, sessionId: string): Promise<void> {
  await service().restore(workspaceId, sessionId);
}
