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
    realCompletedCount: row.real_completed_count,
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
      `SELECT c.id, c.workspace_id, c.student_id, c.sequence_no, c.session_limit,
              c.price_pence, c.opening_completed_count,
              COUNT(co.occurrence_id) AS real_completed_count,
              c.status, c.started_on, c.completed_on, c.paid_on
       FROM tutoring_billing_cycles c
       LEFT JOIN tutoring_billing_cycle_occurrences co
         ON co.workspace_id = c.workspace_id AND co.billing_cycle_id = c.id
       WHERE c.workspace_id = ?1 AND c.student_id = ?2 AND c.status <> 'cancelled'
       GROUP BY c.id
       ORDER BY c.sequence_no DESC
       LIMIT 1`,
    ).bind(workspaceId, studentId).first<CycleRow>();
    return row ? mapCycle(row) : null;
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
    const cycle = await this.getCurrentCycle(input.workspaceId, input.studentId);
    if (!cycle) throw new Error('BILLING_CYCLE_INSERT_FAILED');
    return cycle;
  }
}
