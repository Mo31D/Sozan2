import {
  assertReceiptCommand,
  type AllocateReceiptCommand,
  type ExternalReference,
  type FinanceGateway,
  type RecordReceiptCommand,
} from '../../../modules/finance/contracts';

export class D1FinanceGateway implements FinanceGateway {
  constructor(private readonly db: D1Database) {}

  async recordReceipt(command: RecordReceiptCommand): Promise<void> {
    assertReceiptCommand(command);
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
}
