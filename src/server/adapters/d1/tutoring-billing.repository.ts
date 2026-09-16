import type { BillingCycle, BillingPlan } from '../../../modules/tutoring/domain/billing-plan';
import type { BillingRepository } from '../../../modules/tutoring/ports/billing-repository';

type PlanRow = {
  workspace_id: string;
  student_id: string;
  billing_mode: BillingPlan['billingMode'];
  package_size: number | null;
  package_price_pence: number | null;
  cycle_anchor_date: string | null;
  effective_from: string;
};

type CycleRow = {
  id: string;
  workspace_id: string;
  student_id: string;
  sequence_no: number;
  session_limit: number;
  price_pence: number;
  opening_completed_count: number;
  real_completed_count: number;
  status: BillingCycle['status'];
  started_on: string | null;
  completed_on: string | null;
  paid_on: string | null;
};

const CYCLE_SELECT = `
  SELECT c.id, c.workspace_id, c.student_id, c.sequence_no, c.session_limit,
         c.price_pence, c.opening_completed_count,
         COALESCE(SUM(CASE WHEN o.status = 'completed' THEN 1 ELSE 0 END), 0) AS real_completed_count,
         c.status, c.started_on, c.completed_on, c.paid_on
  FROM tutoring_billing_cycles c
  LEFT JOIN tutoring_billing_cycle_occurrences co
    ON co.workspace_id = c.workspace_id AND co.billing_cycle_id = c.id
  LEFT JOIN tutoring_occurrences o
    ON o.workspace_id = co.workspace_id AND o.id = co.occurrence_id
`;

function mapPlan(row: PlanRow): BillingPlan {
  return {
    workspaceId: row.workspace_id,
    studentId: row.student_id,
    billingMode: row.billing_mode,
    packageSize: row.package_size,
    packagePricePence: row.package_price_pence,
    cycleAnchorDate: row.cycle_anchor_date,
    effectiveFrom: row.effective_from,
  };
}

function mapCycle(row: CycleRow): BillingCycle {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    studentId: row.student_id,
    sequenceNo: row.sequence_no,
    sessionLimit: row.session_limit,
    pricePence: row.price_pence,
    openingCompletedCount: row.opening_completed_count,
    realCompletedCount: Number(row.real_completed_count),
    status: row.status,
    startedOn: row.started_on,
    completedOn: row.completed_on,
    paidOn: row.paid_on,
  };
}

export class D1BillingRepository implements BillingRepository {
  constructor(private readonly db: D1Database) {}

  async getPlan(workspaceId: string, studentId: string): Promise<BillingPlan | null> {
    const row = await this.db.prepare(
      `SELECT workspace_id, student_id, billing_mode, package_size, package_price_pence,
              cycle_anchor_date, effective_from
       FROM tutoring_billing_plans
       WHERE workspace_id = ?1 AND student_id = ?2`,
    ).bind(workspaceId, studentId).first<PlanRow>();
    return row ? mapPlan(row) : null;
  }

  async upsertPlan(plan: BillingPlan): Promise<void> {
    await this.db.prepare(
      `INSERT INTO tutoring_billing_plans(
         workspace_id, student_id, billing_mode, package_size, package_price_pence,
         cycle_anchor_date, effective_from, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, CURRENT_TIMESTAMP)
       ON CONFLICT(student_id) DO UPDATE SET
         workspace_id = excluded.workspace_id,
         billing_mode = excluded.billing_mode,
         package_size = excluded.package_size,
         package_price_pence = excluded.package_price_pence,
         cycle_anchor_date = excluded.cycle_anchor_date,
         effective_from = excluded.effective_from,
         updated_at = CURRENT_TIMESTAMP`,
    ).bind(
      plan.workspaceId,
      plan.studentId,
      plan.billingMode,
      plan.packageSize,
      plan.packagePricePence,
      plan.cycleAnchorDate,
      plan.effectiveFrom,
    ).run();
  }

  async hasBillingHistory(workspaceId: string, studentId: string): Promise<boolean> {
    const row = await this.db.prepare(
      `SELECT 1 AS found
       WHERE EXISTS (
         SELECT 1 FROM tutoring_billing_cycles
         WHERE workspace_id = ?1 AND student_id = ?2
       ) OR EXISTS (
         SELECT 1
         FROM tutoring_occurrences o
         JOIN tutoring_session_students ss
           ON ss.workspace_id = o.workspace_id
          AND ss.recurring_session_id = o.recurring_session_id
         WHERE o.workspace_id = ?1
           AND ss.student_id = ?2
           AND o.status IN ('completed', 'cancelled', 'missed')
       )
       LIMIT 1`,
    ).bind(workspaceId, studentId).first<{ found: number }>();
    return Boolean(row);
  }

  async getCurrentCycle(workspaceId: string, studentId: string): Promise<BillingCycle | null> {
    const row = await this.db.prepare(
      `${CYCLE_SELECT}
       WHERE c.workspace_id = ?1 AND c.student_id = ?2 AND c.status <> 'cancelled'
       GROUP BY c.id
       ORDER BY c.sequence_no DESC
       LIMIT 1`,
    ).bind(workspaceId, studentId).first<CycleRow>();
    return row ? mapCycle(row) : null;
  }

  async getOpenCycle(workspaceId: string, studentId: string): Promise<BillingCycle | null> {
    const row = await this.db.prepare(
      `${CYCLE_SELECT}
       WHERE c.workspace_id = ?1 AND c.student_id = ?2 AND c.status = 'open'
       GROUP BY c.id
       ORDER BY c.sequence_no DESC
       LIMIT 1`,
    ).bind(workspaceId, studentId).first<CycleRow>();
    return row ? mapCycle(row) : null;
  }

  async getNextSequenceNo(workspaceId: string, studentId: string): Promise<number> {
    const row = await this.db.prepare(
      `SELECT COALESCE(MAX(sequence_no), 0) + 1 AS next_sequence
       FROM tutoring_billing_cycles
       WHERE workspace_id = ?1 AND student_id = ?2`,
    ).bind(workspaceId, studentId).first<{ next_sequence: number }>();
    return row?.next_sequence ?? 1;
  }

  async createCycle(input: Omit<BillingCycle, 'realCompletedCount'>): Promise<BillingCycle> {
    await this.db.prepare(
      `INSERT INTO tutoring_billing_cycles(
         id, workspace_id, student_id, sequence_no, session_limit, price_pence,
         opening_completed_count, status, started_on, completed_on, paid_on
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
    ).bind(
      input.id,
      input.workspaceId,
      input.studentId,
      input.sequenceNo,
      input.sessionLimit,
      input.pricePence,
      input.openingCompletedCount,
      input.status,
      input.startedOn,
      input.completedOn,
      input.paidOn,
    ).run();
    const cycle = input.status === 'open'
      ? await this.getOpenCycle(input.workspaceId, input.studentId)
      : await this.getCurrentCycle(input.workspaceId, input.studentId);
    if (!cycle) throw new Error('BILLING_CYCLE_INSERT_FAILED');
    return cycle;
  }

  async updateOpeningProgress(input: {
    workspaceId: string;
    cycleId: string;
    openingCompletedCount: number;
    status: 'open' | 'due';
    completedOn: string | null;
  }): Promise<void> {
    const result = await this.db.prepare(
      `UPDATE tutoring_billing_cycles
       SET opening_completed_count=?3,
           status=?4,
           completed_on=?5,
           paid_on=NULL,
           opening_progress_locked_at=NULL,
           updated_at=CURRENT_TIMESTAMP
       WHERE workspace_id=?1 AND id=?2
         AND NOT EXISTS (
           SELECT 1
           FROM tutoring_billing_cycle_occurrences co
           JOIN tutoring_occurrences o
             ON o.workspace_id=co.workspace_id AND o.id=co.occurrence_id
           WHERE co.workspace_id=?1
             AND co.billing_cycle_id=?2
             AND o.status='completed'
         )`,
    ).bind(
      input.workspaceId,
      input.cycleId,
      input.openingCompletedCount,
      input.status,
      input.completedOn,
    ).run();
    if ((result.meta?.changes ?? 0) === 0) {
      throw new Error('OPENING_PROGRESS_LOCKED_BY_REAL_LESSONS');
    }
  }

  async addOccurrenceToCycle(input: {
    workspaceId: string;
    cycleId: string;
    occurrenceId: string;
    position: number;
    earnedPence: number;
  }): Promise<void> {
    await this.db.prepare(
      `INSERT OR IGNORE INTO tutoring_billing_cycle_occurrences(
         workspace_id, billing_cycle_id, occurrence_id, position, earned_pence
       ) VALUES (?1, ?2, ?3, ?4, ?5)`,
    ).bind(
      input.workspaceId,
      input.cycleId,
      input.occurrenceId,
      input.position,
      input.earnedPence,
    ).run();
  }

  async markCycleDue(input: {
    workspaceId: string;
    cycleId: string;
    completedOn: string;
  }): Promise<void> {
    await this.db.prepare(
      `UPDATE tutoring_billing_cycles
       SET status = 'due', completed_on = ?3, opening_progress_locked_at = COALESCE(opening_progress_locked_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
       WHERE workspace_id = ?1 AND id = ?2 AND status = 'open'`,
    ).bind(input.workspaceId, input.cycleId, input.completedOn).run();
  }
}
