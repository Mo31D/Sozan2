import { datesForWeekday, rescheduleOccurrenceSchema, completeOccurrenceSchema, type TutoringOccurrence } from '../domain/occurrence';
import { canGenerateOccurrences } from '../domain/schedule';
import { completedSessionFinancials } from '../domain/session-finance';
import type { OccurrenceRepository } from '../ports/occurrence-repository';
import type { SessionRepository } from '../ports/session-repository';
import type { BillingService } from './billing.service';

export class OccurrencesService {
  constructor(
    private readonly occurrences: OccurrenceRepository,
    private readonly sessions: SessionRepository,
    private readonly billing: BillingService,
    private readonly idFactory: () => string,
  ) {}

  async ensureRange(workspaceId: string, from: string, to: string): Promise<TutoringOccurrence[]> {
    const sessions = await this.sessions.listActive(workspaceId);
    const pending = sessions.flatMap((session) => {
      if (!canGenerateOccurrences({
        status: session.scheduleStatus,
        weekday: session.weekday,
        startTime: session.startTime,
      })) return [];

      return datesForWeekday(from, to, session.weekday as number).map((sessionDate) => ({
        id: this.idFactory(),
        workspaceId,
        recurringSessionId: session.id,
        sessionDate,
        scheduledStart: session.startTime,
      }));
    });

    await this.occurrences.insertScheduled(pending);
    return this.occurrences.listRange(workspaceId, from, to);
  }

  async complete(workspaceId: string, occurrenceId: string, input: unknown): Promise<TutoringOccurrence> {
    const parsed = completeOccurrenceSchema.parse(input);
    const occurrence = await this.occurrences.getById(workspaceId, occurrenceId);
    if (!occurrence) throw new Error('OCCURRENCE_NOT_FOUND');

    const sessions = await this.sessions.listActive(workspaceId);
    const session = sessions.find((item) => item.id === occurrence.recurringSessionId);
    if (!session) throw new Error('SESSION_NOT_FOUND');

    const occurredOn = occurrence.rescheduledToDate ?? occurrence.sessionDate;

    if (occurrence.status === 'completed') {
      // Completion is retryable as one logical command. If a previous attempt
      // persisted attendance but failed while advancing one package, repair the
      // missing package link instead of returning early.
      for (const studentId of occurrence.studentIds) {
        await this.billing.recordCompletedOccurrence(
          workspaceId,
          studentId,
          occurrenceId,
          occurredOn,
        );
      }
      return (await this.occurrences.getById(workspaceId, occurrenceId)) ?? occurrence;
    }

    if (occurrence.status !== 'scheduled' && occurrence.status !== 'missed') {
      throw new Error('OCCURRENCE_STATE_INVALID');
    }

    const participants = parsed.participantStudentIds
      ? [...new Set(parsed.participantStudentIds)]
      : [...session.studentIds];
    if (participants.some((studentId) => !session.studentIds.includes(studentId))) {
      throw new Error('OCCURRENCE_PARTICIPANT_INVALID');
    }
    if (session.studentIds.length > 0 && participants.length === 0) {
      throw new Error('OCCURRENCE_PARTICIPANT_REQUIRED');
    }

    const { grossPence, centerCutPence, earnedPence } = completedSessionFinancials(
      session,
      participants.length,
    );
    const completedAt = parsed.completedAt ?? new Date().toISOString();

    await this.occurrences.complete(workspaceId, occurrenceId, {
      grossPence,
      centerCutPence,
      earnedPence,
      completedAt,
      note: parsed.note,
      participantStudentIds: participants,
      sessionStudentIds: session.studentIds,
      durationMinutes: session.durationMinutes,
      travelMinutes: session.travelMinutes,
      sessionType: session.sessionType,
      location: session.location,
      priceBasis: session.priceBasis,
      defaultPricePence: session.defaultPricePence,
      payerStudentId: session.payerStudentId,
    });

    for (const studentId of participants) {
      await this.billing.recordCompletedOccurrence(
        workspaceId,
        studentId,
        occurrenceId,
        occurredOn,
      );
    }

    const updated = await this.occurrences.getById(workspaceId, occurrenceId);
    if (!updated) throw new Error('OCCURRENCE_NOT_FOUND');
    return updated;
  }

  async cancel(workspaceId: string, occurrenceId: string): Promise<TutoringOccurrence> {
    const occurrence = await this.requireMutable(workspaceId, occurrenceId);
    if (occurrence.status === 'cancelled') return occurrence;
    await this.occurrences.setStatus(workspaceId, occurrenceId, 'cancelled');
    return this.requireOccurrence(workspaceId, occurrenceId);
  }

  async restore(workspaceId: string, occurrenceId: string): Promise<TutoringOccurrence> {
    const occurrence = await this.occurrences.getById(workspaceId, occurrenceId);
    if (!occurrence) throw new Error('OCCURRENCE_NOT_FOUND');
    if (occurrence.status === 'completed') throw new Error('COMPLETED_REQUIRES_CORRECTION_FLOW');
    if (occurrence.status === 'scheduled') return occurrence;
    await this.occurrences.setStatus(workspaceId, occurrenceId, 'scheduled');
    return this.requireOccurrence(workspaceId, occurrenceId);
  }

  async reschedule(workspaceId: string, occurrenceId: string, input: unknown): Promise<TutoringOccurrence> {
    await this.requireMutable(workspaceId, occurrenceId);
    const parsed = rescheduleOccurrenceSchema.parse(input);
    await this.occurrences.reschedule({ workspaceId, occurrenceId, ...parsed });
    return this.requireOccurrence(workspaceId, occurrenceId);
  }

  private async requireMutable(workspaceId: string, occurrenceId: string): Promise<TutoringOccurrence> {
    const occurrence = await this.requireOccurrence(workspaceId, occurrenceId);
    if (occurrence.status === 'completed') throw new Error('COMPLETED_REQUIRES_CORRECTION_FLOW');
    return occurrence;
  }

  private async requireOccurrence(workspaceId: string, occurrenceId: string): Promise<TutoringOccurrence> {
    const occurrence = await this.occurrences.getById(workspaceId, occurrenceId);
    if (!occurrence) throw new Error('OCCURRENCE_NOT_FOUND');
    return occurrence;
  }
}
