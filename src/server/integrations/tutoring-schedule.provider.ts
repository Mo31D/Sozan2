import type { PlannerBlock, ScheduleProvider } from '../../modules/planner/contracts';
import type { SessionRepository } from '../../modules/tutoring/ports/session-repository';

export class TutoringScheduleProvider implements ScheduleProvider {
  constructor(private readonly sessions: SessionRepository) {}

  async listWeeklyBlocks(workspaceId: string): Promise<PlannerBlock[]> {
    const sessions = await this.sessions.listActive(workspaceId);
    return sessions.map((session) => ({
      id: `tutoring:${session.id}`,
      sourceModule: 'tutoring',
      sourceType: 'recurring_session',
      sourceId: session.id,
      title: session.title,
      status: session.scheduleStatus,
      weekday: session.weekday,
      startTime: session.startTime,
      durationMinutes: session.durationMinutes,
      travelMinutes: session.travelMinutes,
      location: session.location,
    }));
  }
}
