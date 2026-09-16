import { markActivityUndone, type LocalActivityEvent } from '../activity/local-activity';
import {
  restoreLocalExpense,
  restoreLocalReceipt,
  updateLocalExpense,
  updateLocalReceipt,
} from '../finance/corrections';
import {
  restoreLocalCashCheck,
  restoreLocalOtherIncome,
  updateLocalCashCheck,
  updateLocalOtherIncome,
} from '../finance/extended-commands';
import type { LocalExpense } from '../simple/data';
import type { LocalReceipt } from '../tutoring/local-commands';
import { updateLocalStudent } from '../tutoring/student-corrections';

const SUPPORTED_ACTIONS = new Set([
  'receipt.deleted',
  'expense.deleted',
  'income.deleted',
  'cash.deleted',
  'receipt.updated',
  'expense.updated',
  'income.updated',
  'cash.updated',
  'student.updated',
]);

export function canUndoActivity(event: LocalActivityEvent): boolean {
  return Boolean(event.undoable && !event.undoneAt && SUPPORTED_ACTIONS.has(event.action));
}

export async function undoActivityEvent(workspaceId: string, event: LocalActivityEvent): Promise<void> {
  if (!event.entityId || event.undoneAt || !SUPPORTED_ACTIONS.has(event.action)) {
    throw new Error('UNDO_NOT_SUPPORTED');
  }

  const before = parseJson<Record<string, unknown>>(event.beforeJson);
  const entityId = event.entityId;

  switch (event.action) {
    case 'receipt.deleted':
      await restoreLocalReceipt(workspaceId, entityId);
      break;
    case 'expense.deleted':
      await restoreLocalExpense(workspaceId, entityId);
      break;
    case 'income.deleted':
      await restoreLocalOtherIncome(workspaceId, entityId);
      break;
    case 'cash.deleted':
      await restoreLocalCashCheck(workspaceId, entityId);
      break;
    case 'receipt.updated':
      if (!before) throw new Error('UNDO_NOT_SUPPORTED');
      await updateLocalReceipt(workspaceId, entityId, {
        studentId: String(before.payerRefId ?? ''),
        amountPence: Number(before.amountPence ?? 0),
        receivedAt: String(before.receivedAt ?? ''),
        paymentMethod: String(before.paymentMethod ?? 'cash') as LocalReceipt['paymentMethod'],
        note: before.note ? String(before.note) : null,
      });
      break;
    case 'expense.updated':
      if (!before) throw new Error('UNDO_NOT_SUPPORTED');
      await updateLocalExpense(workspaceId, entityId, {
        expenseDate: String(before.expenseDate ?? ''),
        scope: String(before.scope ?? 'personal') as LocalExpense['scope'],
        category: String(before.category ?? ''),
        amountPence: Number(before.amountPence ?? 0),
        note: before.note ? String(before.note) : null,
      });
      break;
    case 'income.updated':
      if (!before) throw new Error('UNDO_NOT_SUPPORTED');
      await updateLocalOtherIncome(workspaceId, entityId, {
        incomeDate: String(before.incomeDate ?? ''),
        category: String(before.category ?? ''),
        amountPence: Number(before.amountPence ?? 0),
        note: before.note ? String(before.note) : null,
      });
      break;
    case 'cash.updated':
      if (!before) throw new Error('UNDO_NOT_SUPPORTED');
      await updateLocalCashCheck(workspaceId, entityId, {
        checkDate: String(before.checkDate ?? ''),
        expectedBalancePence: Number(before.expectedBalancePence ?? 0),
        actualBalancePence: Number(before.actualBalancePence ?? 0),
        note: before.note ? String(before.note) : null,
      });
      break;
    case 'student.updated':
      if (!before) throw new Error('UNDO_NOT_SUPPORTED');
      await updateLocalStudent(workspaceId, entityId, {
        name: String(before.name ?? ''),
        age: typeof before.age === 'number' ? before.age : null,
        guardianName: before.guardianName ? String(before.guardianName) : '',
        guardianPhone: before.guardianPhone ? String(before.guardianPhone) : '',
        level: before.level ? String(before.level) : '',
        notes: before.notes ? String(before.notes) : '',
      });
      break;
    default:
      throw new Error('UNDO_NOT_SUPPORTED');
  }

  await markActivityUndone(event.id, workspaceId);
}

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}
