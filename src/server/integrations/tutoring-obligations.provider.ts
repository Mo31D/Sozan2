import type {
  FinancialObligation,
  ObligationProvider,
} from '../../modules/finance/allocation.service';
import type { PayerReference } from '../../modules/finance/contracts';
import {
  STUDENT_OCCURRENCE_TARGET_TYPE,
  studentOccurrenceTargetId,
} from '../../modules/tutoring/domain/finance-target';

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
       WHERE workspace_id = ?1 AND student_id = ?2 AND status IN ('due','paid')
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
                WHEN o.price_basis_snapshot='per_student'
                  THEN COALESCE(o.default_price_pence_snapshot, 0)
                WHEN o.price_basis_snapshot='total_session'
                  THEN o.gross_pence
                ELSE 0
              END AS amount_pence
       FROM tutoring_occurrences o
       JOIN tutoring_billing_plans bp
         ON bp.workspace_id=o.workspace_id
        AND bp.student_id=?2
        AND bp.billing_mode='per_session'
       WHERE o.workspace_id=?1
         AND o.status='completed'
         AND (
           (
             o.price_basis_snapshot='per_student'
             AND EXISTS (
               SELECT 1
               FROM tutoring_occurrence_students os
               WHERE os.workspace_id=o.workspace_id
                 AND os.occurrence_id=o.id
                 AND os.student_id=?2
                 AND os.attendance_status='attended'
             )
           )
           OR
           (
             o.price_basis_snapshot='total_session'
             AND o.payer_student_id_snapshot=?2
           )
         )
       ORDER BY COALESCE(o.rescheduled_to_date,o.session_date), o.id`,
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
          target: {
            module: 'tutoring',
            type: STUDENT_OCCURRENCE_TARGET_TYPE,
            id: studentOccurrenceTargetId(row.id, payer.id),
          },
          dueAt: row.due_at,
          amountDuePence: row.amount_pence,
        })),
    ];
  }
}
