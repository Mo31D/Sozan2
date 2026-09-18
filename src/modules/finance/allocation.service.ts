import type {
  ExternalReference,
  FinanceGateway,
  PayerReference,
  RecordReceiptCommand,
} from './contracts';

export type FinancialObligation = {
  target: ExternalReference;
  dueAt: string;
  amountDuePence: number;
};

export interface ObligationProvider {
  listOpenObligations(workspaceId: string, payer: PayerReference): Promise<FinancialObligation[]>;
}

export type CollectionResult = {
  receiptId: string;
  /** Total allocated from this receipt after this call, including earlier retry attempts. */
  allocatedPence: number;
  creditPence: number;
  /** Allocations created by this call only. */
  allocations: Array<{ target: ExternalReference; amountPence: number }>;
};

export type CollectCommand = Omit<RecordReceiptCommand, 'id'> & {
  receiptId?: string;
};

export function compareFinancialObligations(
  left: Pick<FinancialObligation, 'dueAt' | 'target'>,
  right: Pick<FinancialObligation, 'dueAt' | 'target'>,
): number {
  return left.dueAt.localeCompare(right.dueAt)
    || left.target.module.localeCompare(right.target.module)
    || left.target.type.localeCompare(right.target.type)
    || left.target.id.localeCompare(right.target.id);
}

/**
 * Coordinates one receipt against all currently open obligations.
 *
 * The service is intentionally database-agnostic. Retry safety is achieved by
 * asking the gateway how much of the same receipt has already been allocated
 * before making any new allocation. That makes a repeated sync command resume
 * from the persisted state instead of replaying the original amount.
 */
export class FinanceCollectionService {
  constructor(
    private readonly gateway: FinanceGateway,
    private readonly obligationProviders: readonly ObligationProvider[],
    private readonly idFactory: () => string,
  ) {}

  async collect(command: CollectCommand): Promise<CollectionResult> {
    const receiptId = command.receiptId ?? this.idFactory();
    const { receiptId: _clientReceiptId, ...receiptCommand } = command;
    await this.gateway.recordReceipt({ ...receiptCommand, id: receiptId });

    const previouslyAllocated = await this.gateway.getReceiptAllocatedTotal(
      command.workspaceId,
      receiptId,
    );
    if (previouslyAllocated > command.amountPence) {
      throw new Error('RECEIPT_OVERALLOCATED');
    }

    let remaining = command.amountPence - previouslyAllocated;
    const allocations: CollectionResult['allocations'] = [];
    const payer = command.payer;

    if (payer && remaining > 0) {
      const obligations = (
        await Promise.all(
          this.obligationProviders.map((provider) =>
            provider.listOpenObligations(command.workspaceId, payer),
          ),
        )
      ).flat().sort(compareFinancialObligations);

      for (const obligation of obligations) {
        if (remaining <= 0) break;
        const alreadyAllocatedToTarget = await this.gateway.getAllocatedTotal(
          command.workspaceId,
          obligation.target,
        );
        const outstanding = Math.max(0, obligation.amountDuePence - alreadyAllocatedToTarget);
        if (outstanding === 0) continue;

        const amountPence = Math.min(remaining, outstanding);
        await this.gateway.allocateReceipt({
          id: this.idFactory(),
          workspaceId: command.workspaceId,
          receiptId,
          target: obligation.target,
          amountPence,
        });
        allocations.push({ target: obligation.target, amountPence });
        remaining -= amountPence;
      }
    }

    const allocatedPence = command.amountPence - remaining;
    return {
      receiptId,
      allocatedPence,
      creditPence: remaining,
      allocations,
    };
  }
}
