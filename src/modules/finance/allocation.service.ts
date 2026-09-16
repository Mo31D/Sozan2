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
  allocatedPence: number;
  creditPence: number;
  allocations: Array<{ target: ExternalReference; amountPence: number }>;
};

export class FinanceCollectionService {
  constructor(
    private readonly gateway: FinanceGateway,
    private readonly obligationProviders: readonly ObligationProvider[],
    private readonly idFactory: () => string,
  ) {}

  async collect(command: Omit<RecordReceiptCommand, 'id'>): Promise<CollectionResult> {
    const receiptId = this.idFactory();
    await this.gateway.recordReceipt({ ...command, id: receiptId });

    const payer = command.payer;
    if (!payer) {
      return {
        receiptId,
        allocatedPence: 0,
        creditPence: command.amountPence,
        allocations: [],
      };
    }

    const obligations = (
      await Promise.all(
        this.obligationProviders.map((provider) =>
          provider.listOpenObligations(command.workspaceId, payer),
        ),
      )
    ).flat().sort((left, right) => left.dueAt.localeCompare(right.dueAt));

    let remaining = command.amountPence;
    const allocations: CollectionResult['allocations'] = [];

    for (const obligation of obligations) {
      if (remaining <= 0) break;
      const alreadyAllocated = await this.gateway.getAllocatedTotal(
        command.workspaceId,
        obligation.target,
      );
      const outstanding = Math.max(0, obligation.amountDuePence - alreadyAllocated);
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

    return {
      receiptId,
      allocatedPence: command.amountPence - remaining,
      creditPence: remaining,
      allocations,
    };
  }
}
