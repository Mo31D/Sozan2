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

    throw new Error('SYNC_OPERATION_UNSUPPORTED');
  },

  async snapshot(db: D1Database, workspaceId: string): Promise<ModuleSnapshot> {
    const [receiptsResult, allocationsResult, expensesResult, incomeResult] = await Promise.all([
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
      },
    };
  },
};
