import type {
  RecurringSession,
  UpdateRecurringSessionDetailsInput,
} from '../../../modules/tutoring/domain/session';
import type {
  NewRecurringSession,
  SessionRepository,
} from '../../../modules/tutoring/ports/session-repository';

type SessionRow = {
  id: string;
  workspace_id: string;
  title: string;
  session_type: RecurringSession['sessionType'];
  schedule_status: RecurringSession['scheduleStatus'];
  weekday: number | null;
  start_time: string | null;
  duration_minutes: number;
  travel_minutes: number;
  location: string | null;
  price_basis: RecurringSession['priceBasis'];
  default_price_pence: number;
  expected_student_count: number;
  center_cut_bps: number;
  active: number;
  payer_student_id: string | null;
  student_id: string | null;
};

function rowsToSessions(rows: SessionRow[]): RecurringSession[] {
  const byId = new Map<string, RecurringSession>();
  for (const row of rows) {
    let session = byId.get(row.id);
    if (!session) {
      session = {
        id: row.id,
        workspaceId: row.workspace_id,
        title: row.title,
        sessionType: row.session_type,
        scheduleStatus: row.schedule_status,
        weekday: row.weekday,
        startTime: row.start_time,
        durationMinutes: row.duration_minutes,
        travelMinutes: row.travel_minutes,
        location: row.location,
        priceBasis: row.price_basis,
        defaultPricePence: row.default_price_pence,
        expectedStudentCount: row.expected_student_count,
        centerCutBps: row.center_cut_bps,
        active: row.active === 1,
        studentIds: [],
        payerStudentId: row.payer_student_id,
      };
      byId.set(row.id, session);
    }
    if (row.student_id) session.studentIds.push(row.student_id);
  }
  return [...byId.values()];
}

const SELECT_SESSIONS = `
  SELECT s.id, s.workspace_id, s.title, s.session_type, s.schedule_status,
         s.weekday, s.start_time, s.duration_minutes, s.travel_minutes,
         s.location, s.price_basis, s.default_price_pence,
         s.expected_student_count, s.center_cut_bps, s.active,
         s.payer_student_id, p.student_id
  FROM tutoring_recurring_sessions s
  LEFT JOIN tutoring_session_students p
    ON p.workspace_id = s.workspace_id AND p.recurring_session_id = s.id
`;

export class D1SessionRepository implements SessionRepository {
  constructor(private readonly db: D1Database) {}

  async listActive(workspaceId: string): Promise<RecurringSession[]> {
    const result = await this.db.prepare(
      `${SELECT_SESSIONS}
       WHERE s.workspace_id = ?1 AND s.active = 1 AND s.deleted_at IS NULL
       ORDER BY COALESCE(s.weekday, 9), COALESCE(s.start_time, '99:99'), s.title, p.student_id`,
    ).bind(workspaceId).all<SessionRow>();
    return rowsToSessions(result.results ?? []);
  }

  async getById(workspaceId: string, sessionId: string): Promise<RecurringSession> {
    const result = await this.db.prepare(
      `${SELECT_SESSIONS}
       WHERE s.workspace_id = ?1 AND s.id = ?2
       ORDER BY p.student_id`,
    ).bind(workspaceId, sessionId).all<SessionRow>();
    const session = rowsToSessions(result.results ?? [])[0];
    if (!session) throw new Error('SESSION_NOT_FOUND');
    return session;
  }

  async create(input: NewRecurringSession): Promise<RecurringSession> {
    const statements: D1PreparedStatement[] = [
      this.db.prepare(
        `INSERT INTO tutoring_recurring_sessions(
           id, workspace_id, title, session_type, schedule_status, weekday, start_time,
           duration_minutes, travel_minutes, location, price_basis, default_price_pence,
           expected_student_count, center_cut_bps, payer_student_id
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)`,
      ).bind(
        input.id,
        input.workspaceId,
        input.title,
        input.sessionType,
        input.scheduleStatus,
        input.weekday,
        input.startTime,
        input.durationMinutes,
        input.travelMinutes,
        input.location,
        input.priceBasis,
        input.defaultPricePence,
        input.expectedStudentCount,
        input.centerCutBps,
        input.payerStudentId,
      ),
    ];

    for (const studentId of [...new Set(input.studentIds)]) {
      statements.push(
        this.db.prepare(
          `INSERT INTO tutoring_session_students(workspace_id, recurring_session_id, student_id)
           VALUES (?1, ?2, ?3)`,
        ).bind(input.workspaceId, input.id, studentId),
      );
    }
    await this.db.batch(statements);
    return this.getById(input.workspaceId, input.id);
  }

  async updateSchedule(input: {
    workspaceId: string;
    sessionId: string;
    scheduleStatus: 'confirmed' | 'pending';
    weekday: number | null;
    startTime: string | null;
  }): Promise<RecurringSession> {
    const result = await this.db.prepare(
      `UPDATE tutoring_recurring_sessions
       SET schedule_status = ?3, weekday = ?4, start_time = ?5, updated_at = CURRENT_TIMESTAMP
       WHERE workspace_id = ?1 AND id = ?2 AND active = 1 AND deleted_at IS NULL`,
    ).bind(
      input.workspaceId,
      input.sessionId,
      input.scheduleStatus,
      input.weekday,
      input.startTime,
    ).run();
    if ((result.meta.changes ?? 0) === 0) throw new Error('SESSION_NOT_FOUND');
    return this.getById(input.workspaceId, input.sessionId);
  }

  async updateDetails(input: {
    workspaceId: string;
    sessionId: string;
    details: UpdateRecurringSessionDetailsInput;
  }): Promise<RecurringSession> {
    const d = input.details;
    const statements: D1PreparedStatement[] = [
      this.db.prepare(
        `UPDATE tutoring_recurring_sessions
         SET title=?3, session_type=?4, schedule_status=?5, weekday=?6, start_time=?7,
             duration_minutes=?8, travel_minutes=?9, location=?10, price_basis=?11,
             default_price_pence=?12, expected_student_count=?13, center_cut_bps=?14,
             payer_student_id=?15, updated_at=CURRENT_TIMESTAMP
         WHERE workspace_id=?1 AND id=?2 AND active=1 AND deleted_at IS NULL`,
      ).bind(
        input.workspaceId,
        input.sessionId,
        d.title,
        d.sessionType,
        d.scheduleStatus,
        d.weekday,
        d.startTime,
        d.durationMinutes,
        d.travelMinutes,
        d.location,
        d.priceBasis,
        d.defaultPricePence,
        d.expectedStudentCount,
        d.centerCutBps,
        d.payerStudentId,
      ),
      this.db.prepare(
        `DELETE FROM tutoring_session_students
         WHERE workspace_id=?1 AND recurring_session_id=?2`,
      ).bind(input.workspaceId, input.sessionId),
    ];
    for (const studentId of d.studentIds) {
      statements.push(
        this.db.prepare(
          `INSERT INTO tutoring_session_students(workspace_id, recurring_session_id, student_id)
           VALUES(?1, ?2, ?3)`,
        ).bind(input.workspaceId, input.sessionId, studentId),
      );
    }
    const results = await this.db.batch(statements);
    if ((results[0]?.meta.changes ?? 0) === 0) throw new Error('SESSION_NOT_FOUND');
    return this.getById(input.workspaceId, input.sessionId);
  }

  async hasHistory(workspaceId: string, sessionId: string): Promise<boolean> {
    const row = await this.db.prepare(
      `SELECT 1 AS found
       FROM tutoring_occurrences
       WHERE workspace_id=?1 AND recurring_session_id=?2
         AND status IN ('completed','cancelled','missed')
       LIMIT 1`,
    ).bind(workspaceId, sessionId).first<{ found: number }>();
    return Boolean(row);
  }

  async archive(workspaceId: string, sessionId: string): Promise<void> {
    const result = await this.db.prepare(
      `UPDATE tutoring_recurring_sessions
       SET active=0, deleted_at=COALESCE(deleted_at,CURRENT_TIMESTAMP), updated_at=CURRENT_TIMESTAMP
       WHERE workspace_id=?1 AND id=?2 AND active=1`,
    ).bind(workspaceId, sessionId).run();
    if ((result.meta.changes ?? 0) === 0) {
      const current = await this.getById(workspaceId, sessionId);
      if (current.active) throw new Error('SESSION_NOT_FOUND');
    }
  }

  async restore(workspaceId: string, sessionId: string): Promise<void> {
    const result = await this.db.prepare(
      `UPDATE tutoring_recurring_sessions
       SET active=1, deleted_at=NULL, updated_at=CURRENT_TIMESTAMP
       WHERE workspace_id=?1 AND id=?2 AND active=0`,
    ).bind(workspaceId, sessionId).run();
    if ((result.meta.changes ?? 0) === 0) {
      const current = await this.getById(workspaceId, sessionId);
      if (!current.active) throw new Error('SESSION_NOT_FOUND');
    }
  }
}
