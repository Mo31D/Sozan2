import type {
  FinancialObligation,
  ObligationProvider,
} from '../../modules/finance/allocation.service';
import type { PayerReference } from '../../modules/finance/contracts';

export class TutoringObligationProvider implements ObligationProvider {
  constructor(private readonly db: D1Database) {}

  async listOpenObligations(
    workspaceId: string,
    payer: PayerReference,
  ): Promise<FinancialObligation[]> {
    if (payer.type !== 'tutoring.student') return [];

    const packageCycles = await this.db.prepare(
      `SELECT id, COALESCE(completed_on, started_on, created_at) AS due_at, price_pence
       FROM tutoring_billing_cycles
       WHERE workspace_id = ?1 AND student_id = ?2 AND status = 'due'
       ORDER BY sequence_no`,
    ).bind(workspaceId, payer.id).all<{
      id: string;
      due_at: string;
      price_pence: number;
    }>();

    const perSession = await this.db.prepare(
      `SELECT o.id,
              COALESCE(o.completed_at, o.session_date) AS due_at,
              CASE
                WHEN s.price_basis = 'per_student' THEN s.default_price_pence
                ELSE o.gross_pence
              END AS amount_pence
       FROM tutoring_occurrences o
       JOIN tutoring_recurring_sessions s
         ON s.workspace_id = o.workspace_id AND s.id = o.recurring_session_id
       JOIN tutoring_session_students ss
         ON ss.workspace_id = o.workspace_id AND ss.recurring_session_id = o.recurring_session_id
       LEFT JOIN tutoring_billing_plans bp
         ON bp.workspace_id = ss.workspace_id AND bp.student_id = ss.student_id
       WHERE o.workspace_id = ?1
         AND ss.student_id = ?2
         AND o.status = 'completed'
         AND COALESCE(bp.billing_mode, 'per_session') = 'per_session'
         AND (s.price_basis = 'per_student' OR s.expected_student_count = 1)
       ORDER BY o.session_date, o.id`,
    ).bind(workspaceId, payer.id).all<{
      id: string;
      due_at: string;
      amount_pence: number;
    }>();

    return [
      ...(packageCycles.results ?? []).map((row) => ({
        target: { module: 'tutoring', type: 'package_cycle', id: row.id },
        dueAt: row.due_at,
        amountDuePence: row.price_pence,
      })),
      ...(perSession.results ?? [])
        .filter((row) => row.amount_pence > 0)
        .map((row) => ({
          target: { module: 'tutoring', type: 'occurrence', id: row.id },
          dueAt: row.due_at,
          amountDuePence: row.amount_pence,
        })),
    ];
  }
}
