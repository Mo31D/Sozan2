import type { ModuleSnapshot, ModuleSyncHandler, SyncMutation } from './contracts';

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

export const financeSyncHandler: ModuleSyncHandler = {
  moduleKey: 'finance',

  async apply(_db: D1Database, _workspaceId: string, _mutation: SyncMutation): Promise<void> {
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
