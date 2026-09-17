export type LocalReceipt = {
  id: string;
  workspaceId: string;
  payerRefType: string;
  payerRefId: string;
  amountPence: number;
  receivedAt: string;
  paymentMethod: 'cash' | 'bank' | 'wallet' | 'other';
  sourceKind: 'manual' | 'quick' | 'migration';
  sourceModule: string | null;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  note: string | null;
  deletedAt: string | null;
  pendingSync: boolean;
};

export type LocalExpense = {
  id: string;
  workspaceId: string;
  expenseDate: string;
  scope: 'business' | 'personal';
  category: string;
  amountPence: number;
  note: string | null;
  deletedAt: string | null;
};

export type LocalOtherIncome = {
  id: string;
  workspaceId: string;
  incomeDate: string;
  category: string;
  amountPence: number;
  note: string | null;
  deletedAt: string | null;
};

export type LocalCashCheck = {
  id: string;
  workspaceId: string;
  checkDate: string;
  expectedBalancePence: number;
  actualBalancePence: number;
  differencePence: number;
  note: string | null;
  deletedAt: string | null;
};

export type LocalAllocation = {
  id: string;
  workspaceId: string;
  receiptId: string;
  targetModule: string;
  targetType: string;
  targetId: string;
  amountPence: number;
};
