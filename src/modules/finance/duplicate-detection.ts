export type ExpenseDuplicateCandidate = {
  id: string;
  expenseDate: string;
  scope: 'business' | 'personal';
  category: string;
  amountPence: number;
  deletedAt?: string | null;
};

export function probableDuplicateExpenseIds(
  expenses: readonly ExpenseDuplicateCandidate[],
): Set<string> {
  const groups = new Map<string, ExpenseDuplicateCandidate[]>();
  for (const expense of expenses) {
    if (expense.deletedAt) continue;
    const category = expense.category.trim().toLowerCase();
    const key = [expense.expenseDate.slice(0, 10), expense.scope, category, expense.amountPence].join('|');
    const current = groups.get(key) ?? [];
    current.push(expense);
    groups.set(key, current);
  }

  const duplicates = new Set<string>();
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    for (const row of rows) duplicates.add(row.id);
  }
  return duplicates;
}
