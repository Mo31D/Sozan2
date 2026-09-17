import {
  assertReceiptCommand,
  type AllocateReceiptCommand,
  type ExternalReference,
  type FinanceGateway,
  type RecordReceiptCommand,
} from '../../../modules/finance/contracts';

type ExistingReceipt = {
  workspace_id: string;
  payer_ref_type: string | null;
  payer_ref_id: string | null;
  amount_pence: number;
  received_at: string;
  payment_method: string;
  source_kind: string;
  source_module: string | null;
  source_entity_type: string | null;
  source_entity_id: string | null;
  note: string | null;
};

function sameReceipt(existing: ExistingReceipt, command: RecordReceiptCommand): boolean {
  return existing.workspace_id === command.workspaceId
    && existing.payer_ref_type === (command.payer?.type ?? null)
    && existing.payer_ref_id === (command.payer?.id ?? null)
    && existing.amount_pence === command.amountPence
    && existing.received_at === command.receivedAt
    && existing.payment_method === command.paymentMethod
    && existing.source_kind === command.sourceKind
    && existing.source_module === (command.source?.module ?? null)
    && existing.source_entity_type === (command.source?.type ?? null)
    && existing.source_entity_id === (command.source?.id ?? null)
    && existing.note === (command.note ?? null);
}

export class D1FinanceGateway implements FinanceGateway {
  constructor(private readonly db: D1Database) {}

  async recordReceipt(command: RecordReceiptCommand): Promise<void> {
    assertReceiptCommand(command);
    const existing = await this.db.prepare(
      `SELECT workspace_id, payer_ref_type, payer_ref_id, amount_pence, received_at,
              payment_method, source_kind, source_module, source_entity_type,
              source_entity_id, note
       FROM finance_receipts WHERE id = ?1`,
    ).bind(command.id).first<ExistingReceipt>();
    if (existing) {
      if (!sameReceipt(existing, command)) throw new Error('RECEIPT_ID_CONFLICT');
      return;
    }

    await this.db.prepare(
      `INSERT INTO finance_receipts(
         id, workspace_id, payer_ref_type, payer_ref_id, amount_pence,
         received_at, payment_method, source_kind,
         source_module, source_entity_type, source_entity_id, note
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
    ).bind(
      command.id,
      command.workspaceId,
      command.payer?.type ?? null,
      command.payer?.id ?? null,
      command.amountPence,
      command.receivedAt,
      command.paymentMethod,
      command.sourceKind,
      command.source?.module ?? null,
      command.source?.type ?? null,
      command.source?.id ?? null,
      command.note ?? null,
    ).run();
  }

  async allocateReceipt(command: AllocateReceiptCommand): Promise<void> {
    if (!Number.isSafeInteger(command.amountPence) || command.amountPence <= 0) {
      throw new Error('ALLOCATION_AMOUNT_INVALID');
    }

    const existing = await this.db.prepare(
      `SELECT amount_pence AS amountPence
       FROM finance_receipt_allocations
       WHERE workspace_id = ?1 AND receipt_id = ?2
         AND target_module = ?3 AND target_type = ?4 AND target_id = ?5`,
    ).bind(
      command.workspaceId,
      command.receiptId,
      command.target.module,
      command.target.type,
      command.target.id,
    ).first<{ amountPence: number }>();
    if (existing) {
      if (existing.amountPence !== command.amountPence) throw new Error('ALLOCATION_CONFLICT');
      return;
    }

    const receipt = await this.db.prepare(
      `SELECT amount_pence AS amountPence
       FROM finance_receipts
       WHERE workspace_id=?1 AND id=?2 AND deleted_at IS NULL`,
    ).bind(command.workspaceId, command.receiptId).first<{ amountPence: number }>();
    if (!receipt) throw new Error('RECEIPT_NOT_FOUND');

    const allocated = await this.getReceiptAllocatedTotal(command.workspaceId, command.receiptId);
    if (allocated + command.amountPence > receipt.amountPence) {
      throw new Error('RECEIPT_ALLOCATION_EXCEEDS_AMOUNT');
    }

    await this.db.prepare(
      `INSERT INTO finance_receipt_allocations(
         id, workspace_id, receipt_id, target_module, target_type, target_id, amount_pence
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    ).bind(
      command.id,
      command.workspaceId,
      command.receiptId,
      command.target.module,
      command.target.type,
      command.target.id,
      command.amountPence,
    ).run();
  }

  async getAllocatedTotal(workspaceId: string, target: ExternalReference): Promise<number> {
    const row = await this.db.prepare(
      `SELECT COALESCE(SUM(a.amount_pence), 0) AS allocated
       FROM finance_receipt_allocations a
       JOIN finance_receipts r
         ON r.workspace_id = a.workspace_id AND r.id = a.receipt_id
       WHERE a.workspace_id = ?1
         AND a.target_module = ?2
         AND a.target_type = ?3
         AND a.target_id = ?4
         AND r.deleted_at IS NULL`,
    ).bind(workspaceId, target.module, target.type, target.id).first<{ allocated: number }>();
    return row?.allocated ?? 0;
  }

  async getReceiptAllocatedTotal(workspaceId: string, receiptId: string): Promise<number> {
    const row = await this.db.prepare(
      `SELECT COALESCE(SUM(a.amount_pence), 0) AS allocated
       FROM finance_receipt_allocations a
       JOIN finance_receipts r
         ON r.workspace_id=a.workspace_id AND r.id=a.receipt_id
       WHERE a.workspace_id=?1 AND a.receipt_id=?2 AND r.deleted_at IS NULL`,
    ).bind(workspaceId, receiptId).first<{ allocated: number }>();
    return Number(row?.allocated ?? 0);
  }
}
