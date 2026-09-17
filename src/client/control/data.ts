import type { RecurringSession } from '../../modules/tutoring/domain/session';
import { listLocalActivity, type LocalActivityEvent } from '../activity/local-activity';
import { openLocalDatabase, requestResult, STORES } from '../adapters/indexeddb/database';
import {
  loadSimpleWorkspaceData,
  type LocalCashCheck,
  type LocalExpense,
  type LocalOtherIncome,
  type SimpleWorkspaceData,
} from '../simple/data';
import type { LocalReceipt } from '../tutoring/local-commands';

export type ControlCenterData = {
  simple: SimpleWorkspaceData;
  receipts: LocalReceipt[];
  expenses: LocalExpense[];
  income: LocalOtherIncome[];
  cashChecks: LocalCashCheck[];
  sessions: RecurringSession[];
  activity: LocalActivityEvent[];
};

export async function loadControlCenterData(workspaceId: string): Promise<ControlCenterData> {
  const db = await openLocalDatabase();
  const tx = db.transaction([
    STORES.financeReceipts,
    STORES.financeExpenses,
    STORES.financeOtherIncome,
    STORES.financeCashChecks,
    STORES.tutoringSessions,
  ], 'readonly');

  const [simple, receipts, expenses, income, cashChecks, sessions, activity] = await Promise.all([
    loadSimpleWorkspaceData(workspaceId),
    requestResult<LocalReceipt[]>(tx.objectStore(STORES.financeReceipts).getAll()),
    requestResult<LocalExpense[]>(tx.objectStore(STORES.financeExpenses).getAll()),
    requestResult<LocalOtherIncome[]>(tx.objectStore(STORES.financeOtherIncome).getAll()),
    requestResult<LocalCashCheck[]>(tx.objectStore(STORES.financeCashChecks).getAll()),
    requestResult<RecurringSession[]>(tx.objectStore(STORES.tutoringSessions).getAll()),
    listLocalActivity(workspaceId),
  ]);

  const mine = <T extends { workspaceId: string }>(rows: T[]): T[] =>
    rows.filter((row) => row.workspaceId === workspaceId);

  return {
    simple,
    receipts: mine(receipts).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || b.id.localeCompare(a.id)),
    expenses: mine(expenses).sort((a, b) => b.expenseDate.localeCompare(a.expenseDate) || b.id.localeCompare(a.id)),
    income: mine(income).sort((a, b) => b.incomeDate.localeCompare(a.incomeDate) || b.id.localeCompare(a.id)),
    cashChecks: mine(cashChecks).sort((a, b) => b.checkDate.localeCompare(a.checkDate) || b.id.localeCompare(a.id)),
    sessions: mine(sessions).sort((a, b) =>
      Number(!a.active) - Number(!b.active)
      || (a.weekday ?? 99) - (b.weekday ?? 99)
      || (a.startTime ?? '99:99').localeCompare(b.startTime ?? '99:99'),
    ),
    activity,
  };
}

export function expectedBalance(data: ControlCenterData): number {
  return data.simple.openingBalancePence
    + sum(data.receipts.filter((row) => !row.deletedAt).map((row) => row.amountPence))
    + sum(data.income.filter((row) => !row.deletedAt).map((row) => row.amountPence))
    - sum(data.expenses.filter((row) => !row.deletedAt).map((row) => row.amountPence));
}

export function sum(values: number[]): number {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}
