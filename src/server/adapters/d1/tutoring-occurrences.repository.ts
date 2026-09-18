import type { TutoringOccurrence } from '../../../modules/tutoring/domain/occurrence';
import type {
  CompletionSnapshot,
  NewOccurrence,
  OccurrenceRepository,
} from '../../../modules/tutoring/ports/occurrence-repository';

type OccurrenceRow = {
  id: string;
  workspace_id: string;
  recurring_session_id: string;
  session_date: string;
  scheduled_start: string | null;
  rescheduled_to_date: string | null;
  rescheduled_to_start: string | null;
  status: TutoringOccurrence['status'];
  gross_pence: number;
  center_cut_pence: number;
  earned_pence: number;
  completed_at: string | null;
  note: string | null;
  duration_minutes_snapshot: number | null;
  travel_minutes_snapshot: number | null;
  session_type_snapshot: string | null;
  location_snapshot: string | null;
  student_id: string | null;
};

const SELECT_OCCURRENCES = `
  SELECT o.id, o.workspace_id, o.recurring_session_id, o.session_date, o.scheduled_start,
         o.rescheduled_to_date, o.rescheduled_to_start, o.status,
         o.gross_pence, o.center_cut_pence, o.earned_pence,
         o.completed_at, o.note,
         o.duration_minutes_snapshot, o.travel_minutes_snapshot,
         o.session_type_snapshot, o.location_snapshot,
         os.student_id
  FROM tutoring_occurrences o
  LEFT JOIN tutoring_occurrence_students os
    ON os.workspace_id = o.workspace_id
   AND os.occurrence_id = o.id
   AND os.attendance_status = 'attended'
`;

function mapRows(rows: OccurrenceRow[]): TutoringOccurrence[] {
  const items = new Map<string, TutoringOccurrence>();
  for (const row of rows) {
    let occurrence = items.get(row.id);
    if (!occurrence) {
      occurrence = {
        id: row.id,
        workspaceId: row.workspace_id,
        recurringSessionId: row.recurring_session_id,
        sessionDate: row.session_date,
        scheduledStart: row.scheduled_start,
        rescheduledToDate: row.rescheduled_to_date,
        rescheduledToStart: row.rescheduled_to_start,
        status: row.status,
        grossPence: row.gross_pence,
        centerCutPence: row.center_cut_pence,
        earnedPence: row.earned_pence,
        completedAt: row.completed_at,
        note: row.note,
        studentIds: [],
        durationMinutesSnapshot: row.duration_minutes_snapshot,
        travelMinutesSnapshot: row.travel_minutes_snapshot,
        sessionTypeSnapshot: row.session_type_snapshot,
        locationSnapshot: row.location_snapshot,
      };
      items.set(row.id, occurrence);
    }
    if (row.student_id) occurrence.studentIds.push(row.student_id);
  }
  return [...items.values()];
}

export class D1OccurrenceRepository implements OccurrenceRepository {
  constructor(private readonly db: D1Database) {}

  async listRange(workspaceId: string, from: string, to: string): Promise<TutoringOccurrence[]> {
    const result = await this.db.prepare(
      `${SELECT_OCCURRENCES}
       WHERE o.workspace_id = ?1
         AND COALESCE(o.rescheduled_to_date, o.session_date) BETWEEN ?2 AND ?3
       ORDER BY COALESCE(o.rescheduled_to_date, o.session_date),
                COALESCE(o.rescheduled_to_start, o.scheduled_start, '99:99'), o.id, os.student_id`,
    ).bind(workspaceId, from, to).all<OccurrenceRow>();
    return mapRows(result.results ?? []);
  }

  async getById(workspaceId: string, occurrenceId: string): Promise<TutoringOccurrence | null> {
    const result = await this.db.prepare(
      `${SELECT_OCCURRENCES}
       WHERE o.workspace_id = ?1 AND o.id = ?2
       ORDER BY os.student_id`,
    ).bind(workspaceId, occurrenceId).all<OccurrenceRow>();
    return mapRows(result.results ?? [])[0] ?? null;
  }

  async insertScheduled(input: NewOccurrence[]): Promise<void> {
    if (input.length === 0) return;
    const statements = input.map((item) => this.db.prepare(
      `INSERT OR IGNORE INTO tutoring_occurrences(
         id, workspace_id, recurring_session_id, session_date, scheduled_start, created_from
       ) VALUES (?1, ?2, ?3, ?4, ?5, 'schedule')`,
    ).bind(
      item.id,
      item.workspaceId,
      item.recurringSessionId,
      item.sessionDate,
      item.scheduledStart,
    ));
    await this.db.batch(statements);
  }

  async complete(
    workspaceId: string,
    occurrenceId: string,
    snapshot: CompletionSnapshot,
  ): Promise<void> {
    const sessionStudents = [...new Set(snapshot.sessionStudentIds)];
    const participants = [...new Set(snapshot.participantStudentIds)];
    if (participants.some((studentId) => !sessionStudents.includes(studentId))) {
      throw new Error('OCCURRENCE_PARTICIPANT_INVALID');
    }

    const statements: D1PreparedStatement[] = [
      this.db.prepare(
        `UPDATE tutoring_occurrences
         SET status = 'completed', gross_pence = ?3, center_cut_pence = ?4,
             earned_pence = ?5, completed_at = ?6, note = ?7,
             duration_minutes_snapshot = ?8, travel_minutes_snapshot = ?9,
             session_type_snapshot = ?10, location_snapshot = ?11,
             updated_at = CURRENT_TIMESTAMP
         WHERE workspace_id = ?1 AND id = ?2 AND status IN ('scheduled', 'missed')`,
      ).bind(
        workspaceId,
        occurrenceId,
        snapshot.grossPence,
        snapshot.centerCutPence,
        snapshot.earnedPence,
        snapshot.completedAt,
        snapshot.note,
        snapshot.durationMinutes,
        snapshot.travelMinutes,
        snapshot.sessionType,
        snapshot.location,
      ),
      this.db.prepare(
        `DELETE FROM tutoring_occurrence_students
         WHERE workspace_id=?1 AND occurrence_id=?2`,
      ).bind(workspaceId, occurrenceId),
    ];

    const participantSet = new Set(participants);
    for (const studentId of sessionStudents) {
      statements.push(
        this.db.prepare(
          `INSERT INTO tutoring_occurrence_students(
             workspace_id, occurrence_id, student_id, attendance_status
           ) VALUES(?1, ?2, ?3, ?4)`,
        ).bind(
          workspaceId,
          occurrenceId,
          studentId,
          participantSet.has(studentId) ? 'attended' : 'absent',
        ),
      );
    }

    const results = await this.db.batch(statements);
    if ((results[0]?.meta.changes ?? 0) === 0) throw new Error('OCCURRENCE_STATE_INVALID');
  }

  async setStatus(
    workspaceId: string,
    occurrenceId: string,
    status: 'scheduled' | 'cancelled' | 'missed',
  ): Promise<void> {
    const result = await this.db.prepare(
      `UPDATE tutoring_occurrences
       SET status = ?3, updated_at = CURRENT_TIMESTAMP
       WHERE workspace_id = ?1 AND id = ?2 AND status <> 'completed'`,
    ).bind(workspaceId, occurrenceId, status).run();
    if ((result.meta.changes ?? 0) === 0) throw new Error('OCCURRENCE_STATE_INVALID');
  }

  async reschedule(input: {
    workspaceId: string;
    occurrenceId: string;
    date: string;
    startTime: string | null;
    note: string | null;
  }): Promise<void> {
    const result = await this.db.prepare(
      `UPDATE tutoring_occurrences
       SET rescheduled_to_date = ?3,
           rescheduled_to_start = ?4,
           rescheduled_at = CURRENT_TIMESTAMP,
           reschedule_note = ?5,
           updated_at = CURRENT_TIMESTAMP
       WHERE workspace_id = ?1 AND id = ?2 AND status <> 'completed'`,
    ).bind(
      input.workspaceId,
      input.occurrenceId,
      input.date,
      input.startTime,
      input.note,
    ).run();
    if ((result.meta.changes ?? 0) === 0) throw new Error('OCCURRENCE_STATE_INVALID');
  }
}
