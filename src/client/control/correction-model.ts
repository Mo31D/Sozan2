import type { LocalReceipt } from '../tutoring/local-commands';

export function duplicateReceiptIds(receipts: readonly LocalReceipt[]): Set<string> {
  const groups = new Map<string, LocalReceipt[]>();
  for (const receipt of receipts) {
    if (receipt.deletedAt) continue;
    const key = [receipt.payerRefType, receipt.payerRefId, receipt.amountPence, receipt.receivedAt.slice(0, 10)].join('|');
    const current = groups.get(key) ?? [];
    current.push(receipt);
    groups.set(key, current);
  }
  const duplicates = new Set<string>();
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    for (const row of rows) duplicates.add(row.id);
  }
  return duplicates;
}

export function activeReceiptTotal(receipts: readonly LocalReceipt[]): number {
  return receipts.filter((row) => !row.deletedAt).reduce((total, row) => total + row.amountPence, 0);
}
