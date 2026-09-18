import { FinanceCollectionService } from '../../modules/finance/allocation.service';
import { D1FinanceGateway } from '../adapters/d1/finance.gateway';
import { TutoringObligationProvider } from './tutoring-obligations.provider';

type ReceiptRow = {
  id: string;
  amount_pence: number;
  received_at: string;
  payment_method: 'cash' | 'bank' | 'wallet' | 'other';
  source_kind: 'manual' | 'quick' | 'migration';
  source_module: string | null;
  source_entity_type: string | null;
  source_entity_id: string | null;
  note: string | null;
  deleted_at: string | null;
};

async function normalizeCycles(db: D1Database, workspaceId: string, studentId: string): Promise<void> {
  const cycles = await db.prepare(
    `SELECT c.id,c.session_limit,c.price_pence,c.opening_completed_count,c.completed_on,c.started_on,
            COALESCE(SUM(CASE WHEN o.status='completed' THEN 1 ELSE 0 END),0) AS real_completed_count,
            MAX(CASE WHEN o.status='completed' THEN COALESCE(o.rescheduled_to_date,o.session_date) END) AS latest_completed
     FROM tutoring_billing_cycles c
     LEFT JOIN tutoring_billing_cycle_occurrences co
       ON co.workspace_id=c.workspace_id AND co.billing_cycle_id=c.id
     LEFT JOIN tutoring_occurrences o
       ON o.workspace_id=co.workspace_id AND o.id=co.occurrence_id
     WHERE c.workspace_id=?1 AND c.student_id=?2 AND c.status<>'cancelled'
     GROUP BY c.id ORDER BY c.sequence_no`,
  ).bind(workspaceId, studentId).all<{
    id: string;
    session_limit: number;
    price_pence: number;
    opening_completed_count: number;
    completed_on: string | null;
    started_on: string | null;
    real_completed_count: number;
    latest_completed: string | null;
  }>();

  for (const cycle of cycles.results ?? []) {
    const complete = Number(cycle.opening_completed_count || 0) + Number(cycle.real_completed_count || 0) >= Number(cycle.session_limit || 0);
    if (!complete) {
      await db.prepare(
        `UPDATE tutoring_billing_cycles SET status='open',completed_on=NULL,paid_on=NULL,updated_at=CURRENT_TIMESTAMP
         WHERE workspace_id=?1 AND id=?2`,
      ).bind(workspaceId, cycle.id).run();
      continue;
    }
    const paid = await db.prepare(
      `SELECT COALESCE(SUM(a.amount_pence),0) AS allocated_pence,MAX(r.received_at) AS paid_on
       FROM finance_receipt_allocations a
       JOIN finance_receipts r ON r.workspace_id=a.workspace_id AND r.id=a.receipt_id AND r.deleted_at IS NULL
       WHERE a.workspace_id=?1 AND a.target_module='tutoring' AND a.target_type='package_cycle' AND a.target_id=?2`,
    ).bind(workspaceId, cycle.id).first<{ allocated_pence: number; paid_on: string | null }>();
    const isPaid = Number(paid?.allocated_pence || 0) >= Number(cycle.price_pence || 0);
    const completedOn = cycle.completed_on ?? cycle.latest_completed ?? cycle.started_on;
    if (!completedOn) throw new Error('BILLING_CYCLE_COMPLETION_DATE_MISSING');
    await db.prepare(
      `UPDATE tutoring_billing_cycles SET status=?1,completed_on=?2,paid_on=?3,updated_at=CURRENT_TIMESTAMP
       WHERE workspace_id=?4 AND id=?5`,
    ).bind(isPaid ? 'paid' : 'due', completedOn, isPaid ? (paid?.paid_on ?? completedOn) : null, workspaceId, cycle.id).run();
  }
}

export async function reconcileStudentFinancialState(db: D1Database, workspaceId: string, studentId: string): Promise<void> {
  const receipts = await db.prepare(
    `SELECT id,amount_pence,received_at,payment_method,source_kind,source_module,source_entity_type,source_entity_id,note,deleted_at
     FROM finance_receipts
     WHERE workspace_id=?1 AND payer_ref_type='tutoring.student' AND payer_ref_id=?2
     ORDER BY received_at,id`,
  ).bind(workspaceId, studentId).all<ReceiptRow>();

  const service = new FinanceCollectionService(
    new D1FinanceGateway(db),
    [new TutoringObligationProvider(db)],
    () => crypto.randomUUID(),
  );
  for (const receipt of receipts.results ?? []) {
    if (receipt.deleted_at) continue;
    const source = receipt.source_module && receipt.source_entity_type && receipt.source_entity_id
      ? { module: receipt.source_module, type: receipt.source_entity_type, id: receipt.source_entity_id }
      : undefined;
    await service.collect({
      receiptId: receipt.id,
      workspaceId,
      payer: { type: 'tutoring.student', id: studentId },
      amountPence: receipt.amount_pence,
      receivedAt: receipt.received_at,
      paymentMethod: receipt.payment_method,
      sourceKind: receipt.source_kind,
      source,
      note: receipt.note,
    });
  }
  await normalizeCycles(db, workspaceId, studentId);
}

export async function reconcileWorkspaceFinancialState(db: D1Database, workspaceId: string): Promise<void> {
  const students = await db.prepare(
    `SELECT id FROM tutoring_students WHERE workspace_id=?1 AND deleted_at IS NULL`,
  ).bind(workspaceId).all<{ id: string }>();
  for (const student of students.results ?? []) {
    await reconcileStudentFinancialState(db, workspaceId, student.id);
  }
}
