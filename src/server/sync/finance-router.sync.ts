import { z } from 'zod';
import type { ModuleSnapshot, ModuleSyncHandler, SyncMutation } from './contracts';
import { financeSyncHandler as legacyFinanceSyncHandler } from './finance.sync';

const receiptSchema = z.object({
  payerRefType: z.string().trim().min(1).max(100),
  payerRefId: z.string().uuid(),
  amountPence: z.number().int().positive(),
  receivedAt: z.string().min(10).max(40),
  paymentMethod: z.enum(['cash', 'bank', 'wallet', 'other']).default('cash'),
  sourceModule: z.string().max(80).nullable().optional().default(null),
  sourceEntityType: z.string().max(100).nullable().optional().default(null),
  sourceEntityId: z.string().uuid().nullable().optional().default(null),
  note: z.string().trim().max(500).nullable().optional().default(null),
});

type GenericReceiptInput = z.infer<typeof receiptSchema>;

async function validatePayer(db: D1Database, workspaceId: string, type: string, id: string): Promise<void> {
  if (type === 'appointments.client') {
    const found = await db.prepare(
      `SELECT 1 AS found FROM appointments_clients
       WHERE workspace_id=?1 AND id=?2 AND active=1 AND deleted_at IS NULL`,
    ).bind(workspaceId, id).first<{ found: number }>();
    if (!found) throw new Error('CLIENT_NOT_FOUND');
    return;
  }
  throw new Error('PAYER_TYPE_UNSUPPORTED');
}

async function validateSourceLink(
  db: D1Database,
  workspaceId: string,
  input: GenericReceiptInput,
): Promise<void> {
  const fields = [input.sourceModule, input.sourceEntityType, input.sourceEntityId];
  const present = fields.filter((value) => value !== null).length;
  if (present === 0) return;
  if (present !== 3) throw new Error('RECEIPT_SOURCE_INCOMPLETE');

  if (
    input.payerRefType !== 'appointments.client'
    || input.sourceModule !== 'appointments'
    || input.sourceEntityType !== 'appointment'
    || !input.sourceEntityId
  ) {
    throw new Error('RECEIPT_SOURCE_UNSUPPORTED');
  }

  const appointment = await db.prepare(
    `SELECT client_id FROM appointments_items
     WHERE workspace_id=?1 AND id=?2 AND deleted_at IS NULL`,
  ).bind(workspaceId, input.sourceEntityId).first<{ client_id: string | null }>();
  if (!appointment) throw new Error('APPOINTMENT_NOT_FOUND');
  if (appointment.client_id !== input.payerRefId) throw new Error('RECEIPT_SOURCE_PAYER_MISMATCH');
}

export const financeSyncHandler: ModuleSyncHandler = {
  moduleKey: 'finance',

  async apply(db: D1Database, workspaceId: string, mutation: SyncMutation): Promise<void> {
    if (mutation.operation !== 'receipt.create') {
      return legacyFinanceSyncHandler.apply(db, workspaceId, mutation);
    }

    const parsed = receiptSchema.parse(mutation.payload);
    await validatePayer(db, workspaceId, parsed.payerRefType, parsed.payerRefId);
    await validateSourceLink(db, workspaceId, parsed);

    const exists = await db.prepare(
      `SELECT 1 AS found FROM finance_receipts WHERE workspace_id=?1 AND id=?2 LIMIT 1`,
    ).bind(workspaceId, mutation.entityId).first<{ found: number }>();
    if (exists) return;

    await db.prepare(
      `INSERT INTO finance_receipts(
         id,workspace_id,payer_ref_type,payer_ref_id,amount_pence,received_at,payment_method,source_kind,
         source_module,source_entity_type,source_entity_id,note,created_at,updated_at
       ) VALUES(?1,?2,?3,?4,?5,?6,?7,'manual',?8,?9,?10,?11,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
    ).bind(
      mutation.entityId,
      workspaceId,
      parsed.payerRefType,
      parsed.payerRefId,
      parsed.amountPence,
      parsed.receivedAt,
      parsed.paymentMethod,
      parsed.sourceModule,
      parsed.sourceEntityType,
      parsed.sourceEntityId,
      parsed.note,
    ).run();
  },

  snapshot(db: D1Database, workspaceId: string): Promise<ModuleSnapshot> {
    return legacyFinanceSyncHandler.snapshot(db, workspaceId);
  },
};
