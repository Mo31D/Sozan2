import {
  rebuildStudentFinancialState,
  reconcileWorkspaceFinancialState,
} from './financial-reconcile';
import type { SyncMutation, SyncPostApplyHook } from '../sync/contracts';

/**
 * Finance reacts to tutoring mutations through an integration hook. The sync
 * transport does not know why tutoring changes require a financial rebuild,
 * and the tutoring module stays independent from the finance implementation.
 */
export const financialReconcileSyncHook: SyncPostApplyHook = {
  supports(mutation: SyncMutation): boolean {
    return mutation.moduleKey === 'tutoring';
  },

  async afterApply(db: D1Database, workspaceId: string, mutation: SyncMutation): Promise<void> {
    if (mutation.operation === 'billing.configure') {
      // Changing opening package progress is an explicit correction. Existing
      // allocations may point at a cycle that has just moved from due→open (or
      // open→due), so preserving them would misstate both due and prepaid
      // credit. Rebuild this student's allocation ledger deterministically.
      await rebuildStudentFinancialState(db, workspaceId, mutation.entityId);
      return;
    }
    await reconcileWorkspaceFinancialState(db, workspaceId);
  },
};
