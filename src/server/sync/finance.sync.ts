import { z } from 'zod';
import { FinanceCollectionService } from '../../modules/finance/allocation.service';
import { D1FinanceGateway } from '../adapters/d1/finance.gateway';
import { TutoringObligationProvider } from '../integrations/tutoring-obligations.provider';
import type { ModuleSnapshot, ModuleSyncHandler, SyncMutation } from './contracts';

const paymentMethodSchema = z.enum(['cash', 'bank', 'wallet', 'other']);
const studentCollectionSchema = z.object({
  studentId: z.string().uuid(),
  amountPence: z.number().int().positive(),
  receivedAt: z.string().min(10).max(40),
  paymentMethod: paymentMethodSchema.default('cash'),
  note: z.string().trim().max(500).nullable().optional().default(null),
});

const expenseSchema = z.object({
  expenseDate: z.string().min(10).max(40),
  scope: z.enum(['business', 'personal']).default('personal'),
  category: z.string().trim().min(1).max(120),
  amountPence: z.number().int().positive(),
  note: z.string().trim().max(500).nullable().optional().default(null),
});

const otherIncomeSchema = z.object({
  incomeDate: z.string().min(10).max(40),
  category: z.string().trim().min(1).max(120),
  amountPence: z.number().int().positive(),
  note: z.string().trim().max(500).nullable().optional().default(null),
});

const cashCheckSchema = z.object({
  checkDate: z.string().min(10).max(40),
  expectedBalancePence: z.number().int(),
  actualBalancePence: z.number().int(),
  differencePence: z.number().int(),
  note: z.string().trim().max(500).nullable().optional().default(null),
});

type ReceiptRow = {
  id: string;
  workspace_id: string;
  payer_ref_type: string | null;
  payer_ref_id: string | null;
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

type AllocationRow = {
  id: string;
  workspace_id: string;
  receipt_id: string;
  target_module: string;
  target_type: string;
  target_id: string;
  amount_pence: number;
};

type ExpenseRow = {
  id: string;
  workspace_id: string;
  expense_date: string;
  scope: 'business' | 'personal';
  category: string;
  amount_pence: number;
  note: string | null;
  deleted_at: string | null;
};

type IncomeRow = {
  id: string;
  workspace_id: string;
  income_date: string;
  category: string;
  amount_pence: number;
  note: string | null;
  deleted_at: string | null;
};

type CashCheckRow = {
  id: string;
  workspace_id: string;
  check_date: string;
  expected_balance_pence: number;
  actual_balance_pence: number;
  difference_pence: number;
  note: string | null;
  deleted_at: string | null;
};

async function requireStudent(db: D1Database, workspaceId: string, studentId: string): Promise<void> {
  const student = await db.prepare(
    `SELECT 1 AS found FROM tutoring_students
     WHERE workspace_id = ?1 AND id = ?2 AND deleted_at IS NULL LIMIT 1`,
  ).bind(workspaceId, studentId).first<{ found: number }>();
  if (!student) throw new Error('STUDENT_NOT_FOUND');
}

async function requireReceipt(db: D1Database, workspaceId: string, receiptId: string): Promise<ReceiptRow> {
  const row = await db.prepare(
    `SELECT id, workspace_id, payer_ref_type, payer_ref_id, amount_pence, received_at,
            payment_method, source_kind, source_module, source_entity_type, source_entity_id,
            note, deleted_at
     FROM finance_receipts WHERE workspace_id=?1 AND id=?2`,
  ).bind(workspaceId, receiptId).first<ReceiptRow>();
  if (!row) throw new Error('RECEIPT_NOT_FOUND');
  return row;
}

async function normalizeStudentBillingState(db: D1Database, workspaceId: string, studentId: string): Promise<void> {
  const cycles = await db.prepare(
    `SELECT c.id, c.session_limit, c.price_pence, c.opening_completed_count,
            c.completed_on,
            COALESCE(SUM(CASE WHEN o.status='completed' THEN 1 ELSE 0 END),0) AS real_completed_count,
            MAX(CASE WHEN o.status='completed' THEN COALESCE(o.rescheduled_to_date,o.session_date) END) AS latest_completed
     FROM tutoring_billing_cycles c
     LEFT JOIN tutoring_billing_cycle_occurrences co
       ON co.workspace_id=c.workspace_id AND co.billing_cycle_id=c.id
     LEFT JOIN tutoring_occurrences o
       ON o.workspace_id=co.workspace_id AND o.id=co.occurrence_id
     WHERE c.workspace_id=?1 AND c.student_id=?2 AND c.status<>'cancelled'
     GROUP BY c.id
     ORDER BY c.sequence_no`,
  ).bind(workspaceId, studentId).all<{
    id: string;
    session_limit: number;
    price_pence: number;
    opening_completed_count: number;
    completed_on: string | null;
    real_completed_count: number;
    latest_completed: string | null;
  }>();

  for (const cycle of cycles.results ?? []) {
    const completedCount = Number(cycle.opening_completed_count || 0) + Number(cycle.real_completed_count || 0);
    const complete = completedCount >= Number(cycle.session_limit || 0);
    if (!complete) {
      await db.prepare(
        `UPDATE tutoring_billing_cycles
         SET status='open', completed_on=NULL, paid_on=NULL, updated_at=CURRENT_TIMESTAMP
         WHERE workspace_id=?1 AND id=?2`,
      ).bind(workspaceId, cycle.id).run();
      continue;
    }

    const paid = await db.prepare(
      `SELECT COALESCE(SUM(a.amount_pence),0) AS allocated_pence,
              MAX(r.received_at) AS paid_on
       FROM finance_receipt_allocations a
       JOIN finance_receipts r
         ON r.workspace_id=a.workspace_id AND r.id=a.receipt_id AND r.deleted_at IS NULL
       WHERE a.workspace_id=?1
         AND a.target_module='tutoring'
         AND a.target_type='package_cycle'
         AND a.target_id=?2`,
    ).bind(workspaceId, cycle.id).first<{ allocated_pence: number; paid_on: string | null }>();
    const isPaid = Number(paid?.allocated_pence || 0) >= Number(cycle.price_pence || 0);
    const completedOn = cycle.completed_on ?? cycle.latest_completed ?? new Date().toISOString().slice(0, 10);
    await db.prepare(
      `UPDATE tutoring_billing_cycles
       SET status=?1, completed_on=?2, paid_on=?3, updated_at=CURRENT_TIMESTAMP
       WHERE workspace_id=?4 AND id=?5`,
    ).bind(isPaid ? 'paid' : 'due', completedOn, isPaid ? (paid?.paid_on ?? completedOn) : null, workspaceId, cycle.id).run();
  }
}

async function rebuildStudentAllocations(db: D1Database, workspaceId: string, studentId: string): Promise<void> {
  const rows = await db.prepare(
    `SELECT id, workspace_id, payer_ref_type, payer_ref_id, amount_pence, received_at,
            payment_method, source_kind, source_module, source_entity_type, source_entity_id,
            note, deleted_at
     FROM finance_receipts
     WHERE workspace_id=?1 AND payer_ref_type='tutoring.student' AND payer_ref_id=?2
     ORDER BY received_at, id`,
  ).bind(workspaceId, studentId).all<ReceiptRow>();

  await db.prepare(
    `DELETE FROM finance_receipt_allocations
     WHERE workspace_id=?1 AND receipt_id IN (
       SELECT id FROM finance_receipts
       WHERE workspace_id=?1 AND payer_ref_type='tutoring.student' AND payer_ref_id=?2
     )`,
  ).bind(workspaceId, studentId).run();

  const service = new FinanceCollectionService(
    new D1FinanceGateway(db),
    [new TutoringObligationProvider(db)],
    () => crypto.randomUUID(),
  );
  for (const receipt of rows.results ?? []) {
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
  await normalizeStudentBillingState(db, workspaceId, studentId);
}

async function rebuildStudents(db: D1Database, workspaceId: string, studentIds: Array<string | null>): Promise<void> {
  for (const studentId of [...new Set(studentIds.filter((id): id is string => Boolean(id)))]) {
    await rebuildStudentAllocations(db, workspaceId, studentId);
  }
}

export const financeSyncHandler: ModuleSyncHandler = {
  moduleKey: 'finance',

  async apply(db: D1Database, workspaceId: string, mutation: SyncMutation): Promise<void> {
    if (mutation.operation === 'student.collection.create') {
      const parsed = studentCollectionSchema.parse(mutation.payload);
      await requireStudent(db, workspaceId, parsed.studentId);
      const service = new FinanceCollectionService(
        new D1FinanceGateway(db),
        [new TutoringObligationProvider(db)],
        () => crypto.randomUUID(),
      );
      await service.collect({
        receiptId: mutation.entityId,
        workspaceId,
        payer: { type: 'tutoring.student', id: parsed.studentId },
        amountPence: parsed.amountPence,
        receivedAt: parsed.receivedAt,
        paymentMethod: parsed.paymentMethod,
        sourceKind: 'manual',
        note: parsed.note,
      });
      await normalizeStudentBillingState(db, workspaceId, parsed.studentId);
      return;
    }

    if (mutation.operation === 'receipt.update') {
      const parsed = studentCollectionSchema.parse(mutation.payload);
      await requireStudent(db, workspaceId, parsed.studentId);
      const existing = await requireReceipt(db, workspaceId, mutation.entityId);
      if (existing.deleted_at) throw new Error('RECEIPT_DELETED');
      await db.prepare(
        `UPDATE finance_receipts
         SET payer_ref_type='tutoring.student', payer_ref_id=?1, amount_pence=?2,
             received_at=?3, payment_method=?4, note=?5, updated_at=CURRENT_TIMESTAMP
         WHERE workspace_id=?6 AND id=?7`,
      ).bind(
        parsed.studentId,
        parsed.amountPence,
        parsed.receivedAt,
        parsed.paymentMethod,
        parsed.note,
        workspaceId,
        mutation.entityId,
      ).run();
      await rebuildStudents(db, workspaceId, [existing.payer_ref_id, parsed.studentId]);
      return;
    }

    if (mutation.operation === 'receipt.delete') {
      const existing = await requireReceipt(db, workspaceId, mutation.entityId);
      if (!existing.deleted_at) {
        await db.prepare(
          `UPDATE finance_receipts SET deleted_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
           WHERE workspace_id=?1 AND id=?2`,
        ).bind(workspaceId, mutation.entityId).run();
      }
      await rebuildStudents(db, workspaceId, [existing.payer_ref_id]);
      return;
    }

    if (mutation.operation === 'receipt.restore') {
      const existing = await requireReceipt(db, workspaceId, mutation.entityId);
      if (existing.deleted_at) {
        await db.prepare(
          `UPDATE finance_receipts SET deleted_at=NULL, updated_at=CURRENT_TIMESTAMP
           WHERE workspace_id=?1 AND id=?2`,
        ).bind(workspaceId, mutation.entityId).run();
      }
      await rebuildStudents(db, workspaceId, [existing.payer_ref_id]);
      return;
    }

    if (mutation.operation === 'expense.create') {
      const parsed = expenseSchema.parse(mutation.payload);
      const existing = await db.prepare(
        `SELECT 1 AS found FROM finance_expenses WHERE workspace_id=?1 AND id=?2 LIMIT 1`,
      ).bind(workspaceId, mutation.entityId).first<{ found: number }>();
      if (existing) return;
      await db.prepare(
        `INSERT INTO finance_expenses(
           id,workspace_id,expense_date,scope,category,amount_pence,note,created_at,updated_at
         ) VALUES (?1,?2,?3,?4,?5,?6,?7,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      ).bind(
        mutation.entityId,
        workspaceId,
        parsed.expenseDate,
        parsed.scope,
        parsed.category,
        parsed.amountPence,
        parsed.note,
      ).run();
      return;
    }

    if (mutation.operation === 'expense.update') {
      const parsed = expenseSchema.parse(mutation.payload);
      const existing = await db.prepare(
        `SELECT deleted_at FROM finance_expenses WHERE workspace_id=?1 AND id=?2`,
      ).bind(workspaceId, mutation.entityId).first<{ deleted_at: string | null }>();
      if (!existing) throw new Error('EXPENSE_NOT_FOUND');
      if (existing.deleted_at) throw new Error('EXPENSE_DELETED');
      await db.prepare(
        `UPDATE finance_expenses SET expense_date=?1, scope=?2, category=?3,
         amount_pence=?4, note=?5, updated_at=CURRENT_TIMESTAMP
         WHERE workspace_id=?6 AND id=?7`,
      ).bind(parsed.expenseDate, parsed.scope, parsed.category, parsed.amountPence, parsed.note, workspaceId, mutation.entityId).run();
      return;
    }

    if (mutation.operation === 'expense.delete') {
      const result = await db.prepare(
        `UPDATE finance_expenses SET deleted_at=COALESCE(deleted_at,CURRENT_TIMESTAMP), updated_at=CURRENT_TIMESTAMP
         WHERE workspace_id=?1 AND id=?2`,
      ).bind(workspaceId, mutation.entityId).run();
      if ((result.meta?.changes ?? 0) === 0) throw new Error('EXPENSE_NOT_FOUND');
      return;
    }

    if (mutation.operation === 'expense.restore') {
      const result = await db.prepare(
        `UPDATE finance_expenses SET deleted_at=NULL, updated_at=CURRENT_TIMESTAMP
         WHERE workspace_id=?1 AND id=?2`,
      ).bind(workspaceId, mutation.entityId).run();
      if ((result.meta?.changes ?? 0) === 0) throw new Error('EXPENSE_NOT_FOUND');
      return;
    }

    if (mutation.operation === 'income.create') {
      const parsed = otherIncomeSchema.parse(mutation.payload);
      const exists = await db.prepare(
        `SELECT 1 AS found FROM finance_other_income WHERE workspace_id=?1 AND id=?2 LIMIT 1`,
      ).bind(workspaceId, mutation.entityId).first<{ found: number }>();
      if (exists) return;
      await db.prepare(
        `INSERT INTO finance_other_income(id,workspace_id,income_date,category,amount_pence,note,created_at,updated_at)
         VALUES(?1,?2,?3,?4,?5,?6,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      ).bind(mutation.entityId, workspaceId, parsed.incomeDate, parsed.category, parsed.amountPence, parsed.note).run();
      return;
    }

    if (mutation.operation === 'income.update') {
      const parsed = otherIncomeSchema.parse(mutation.payload);
      const result = await db.prepare(
        `UPDATE finance_other_income SET income_date=?1,category=?2,amount_pence=?3,note=?4,updated_at=CURRENT_TIMESTAMP
         WHERE workspace_id=?5 AND id=?6 AND deleted_at IS NULL`,
      ).bind(parsed.incomeDate, parsed.category, parsed.amountPence, parsed.note, workspaceId, mutation.entityId).run();
      if ((result.meta?.changes ?? 0) === 0) throw new Error('INCOME_NOT_FOUND');
      return;
    }

    if (mutation.operation === 'income.delete') {
      const result = await db.prepare(
        `UPDATE finance_other_income SET deleted_at=COALESCE(deleted_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP
         WHERE workspace_id=?1 AND id=?2`,
      ).bind(workspaceId, mutation.entityId).run();
      if ((result.meta?.changes ?? 0) === 0) throw new Error('INCOME_NOT_FOUND');
      return;
    }

    if (mutation.operation === 'income.restore') {
      const result = await db.prepare(
        `UPDATE finance_other_income SET deleted_at=NULL,updated_at=CURRENT_TIMESTAMP
         WHERE workspace_id=?1 AND id=?2`,
      ).bind(workspaceId, mutation.entityId).run();
      if ((result.meta?.changes ?? 0) === 0) throw new Error('INCOME_NOT_FOUND');
      return;
    }

    if (mutation.operation === 'cash.create') {
      const parsed = cashCheckSchema.parse(mutation.payload);
      const exists = await db.prepare(
        `SELECT 1 AS found FROM finance_cash_checks WHERE workspace_id=?1 AND id=?2 LIMIT 1`,
      ).bind(workspaceId, mutation.entityId).first<{ found: number }>();
      if (exists) return;
      await db.prepare(
        `INSERT INTO finance_cash_checks(
           id,workspace_id,check_date,expected_balance_pence,actual_balance_pence,difference_pence,note,created_at,updated_at
         ) VALUES(?1,?2,?3,?4,?5,?6,?7,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      ).bind(
        mutation.entityId, workspaceId, parsed.checkDate, parsed.expectedBalancePence,
        parsed.actualBalancePence, parsed.differencePence, parsed.note,
      ).run();
      return;
    }

    if (mutation.operation === 'cash.update') {
      const parsed = cashCheckSchema.parse(mutation.payload);
      const result = await db.prepare(
        `UPDATE finance_cash_checks
         SET check_date=?1,expected_balance_pence=?2,actual_balance_pence=?3,difference_pence=?4,note=?5,updated_at=CURRENT_TIMESTAMP
         WHERE workspace_id=?6 AND id=?7 AND deleted_at IS NULL`,
      ).bind(
        parsed.checkDate, parsed.expectedBalancePence, parsed.actualBalancePence,
        parsed.differencePence, parsed.note, workspaceId, mutation.entityId,
      ).run();
      if ((result.meta?.changes ?? 0) === 0) throw new Error('CASH_CHECK_NOT_FOUND');
      return;
    }

    if (mutation.operation === 'cash.delete') {
      const result = await db.prepare(
        `UPDATE finance_cash_checks SET deleted_at=COALESCE(deleted_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP
         WHERE workspace_id=?1 AND id=?2`,
      ).bind(workspaceId, mutation.entityId).run();
      if ((result.meta?.changes ?? 0) === 0) throw new Error('CASH_CHECK_NOT_FOUND');
      return;
    }

    if (mutation.operation === 'cash.restore') {
      const result = await db.prepare(
        `UPDATE finance_cash_checks SET deleted_at=NULL,updated_at=CURRENT_TIMESTAMP
         WHERE workspace_id=?1 AND id=?2`,
      ).bind(workspaceId, mutation.entityId).run();
      if ((result.meta?.changes ?? 0) === 0) throw new Error('CASH_CHECK_NOT_FOUND');
      return;
    }

    throw new Error('SYNC_OPERATION_UNSUPPORTED');
  },

  async snapshot(db: D1Database, workspaceId: string): Promise<ModuleSnapshot> {
    const [receiptsResult, allocationsResult, expensesResult, incomeResult, cashResult] = await Promise.all([
      db.prepare(
        `SELECT id, workspace_id, payer_ref_type, payer_ref_id, amount_pence, received_at,
                payment_method, source_kind, source_module, source_entity_type, source_entity_id,
                note, deleted_at
         FROM finance_receipts
         WHERE workspace_id = ?1
         ORDER BY received_at, id`,
      ).bind(workspaceId).all<ReceiptRow>(),
      db.prepare(
        `SELECT id, workspace_id, receipt_id, target_module, target_type, target_id, amount_pence
         FROM finance_receipt_allocations
         WHERE workspace_id = ?1
         ORDER BY receipt_id, id`,
      ).bind(workspaceId).all<AllocationRow>(),
      db.prepare(
        `SELECT id, workspace_id, expense_date, scope, category, amount_pence, note, deleted_at
         FROM finance_expenses
         WHERE workspace_id = ?1
         ORDER BY expense_date, id`,
      ).bind(workspaceId).all<ExpenseRow>(),
      db.prepare(
        `SELECT id, workspace_id, income_date, category, amount_pence, note, deleted_at
         FROM finance_other_income
         WHERE workspace_id = ?1
         ORDER BY income_date, id`,
      ).bind(workspaceId).all<IncomeRow>(),
      db.prepare(
        `SELECT id,workspace_id,check_date,expected_balance_pence,actual_balance_pence,difference_pence,note,deleted_at
         FROM finance_cash_checks
         WHERE workspace_id=?1
         ORDER BY check_date,id`,
      ).bind(workspaceId).all<CashCheckRow>(),
    ]);

    return {
      moduleKey: 'finance',
      data: {
        receipts: (receiptsResult.results ?? []).map((row) => ({
          id: row.id,
          workspaceId: row.workspace_id,
          payerRefType: row.payer_ref_type,
          payerRefId: row.payer_ref_id,
          amountPence: row.amount_pence,
          receivedAt: row.received_at,
          paymentMethod: row.payment_method,
          sourceKind: row.source_kind,
          sourceModule: row.source_module,
          sourceEntityType: row.source_entity_type,
          sourceEntityId: row.source_entity_id,
          note: row.note,
          deletedAt: row.deleted_at,
          pendingSync: false,
        })),
        allocations: (allocationsResult.results ?? []).map((row) => ({
          id: row.id,
          workspaceId: row.workspace_id,
          receiptId: row.receipt_id,
          targetModule: row.target_module,
          targetType: row.target_type,
          targetId: row.target_id,
          amountPence: row.amount_pence,
        })),
        expenses: (expensesResult.results ?? []).map((row) => ({
          id: row.id,
          workspaceId: row.workspace_id,
          expenseDate: row.expense_date,
          scope: row.scope,
          category: row.category,
          amountPence: row.amount_pence,
          note: row.note,
          deletedAt: row.deleted_at,
        })),
        otherIncome: (incomeResult.results ?? []).map((row) => ({
          id: row.id,
          workspaceId: row.workspace_id,
          incomeDate: row.income_date,
          category: row.category,
          amountPence: row.amount_pence,
          note: row.note,
          deletedAt: row.deleted_at,
        })),
        cashChecks: (cashResult.results ?? []).map((row) => ({
          id: row.id,
          workspaceId: row.workspace_id,
          checkDate: row.check_date,
          expectedBalancePence: row.expected_balance_pence,
          actualBalancePence: row.actual_balance_pence,
          differencePence: row.difference_pence,
          note: row.note,
          deletedAt: row.deleted_at,
        })),
      },
    };
  },
};
