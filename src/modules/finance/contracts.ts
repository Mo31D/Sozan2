export type ExternalReference = {
  module: string;
  type: string;
  id: string;
};

export type PayerReference = {
  type: string;
  id: string;
};

export type RecordReceiptCommand = {
  id: string;
  workspaceId: string;
  payer?: PayerReference;
  amountPence: number;
  receivedAt: string;
  paymentMethod: 'cash' | 'bank' | 'wallet' | 'other';
  sourceKind: 'manual' | 'quick' | 'migration';
  source?: ExternalReference;
  note?: string | null;
};

export type AllocateReceiptCommand = {
  id: string;
  workspaceId: string;
  receiptId: string;
  target: ExternalReference;
  amountPence: number;
};

export interface FinanceGateway {
  recordReceipt(command: RecordReceiptCommand): Promise<void>;
  allocateReceipt(command: AllocateReceiptCommand): Promise<void>;
  getAllocatedTotal(workspaceId: string, target: ExternalReference): Promise<number>;
  /**
   * Returns the amount already allocated from one receipt across every target.
   * This is deliberately part of the port: retry-safety is a finance-domain
   * invariant and must not depend on a specific database implementation.
   */
  getReceiptAllocatedTotal(workspaceId: string, receiptId: string): Promise<number>;
}

export function assertReceiptCommand(command: RecordReceiptCommand): void {
  if (!Number.isSafeInteger(command.amountPence) || command.amountPence <= 0) {
    throw new Error('Receipt amount must be positive integer pence');
  }
  if (!command.payer && !command.source) {
    throw new Error('Receipt requires a payer or a source entity');
  }
}
