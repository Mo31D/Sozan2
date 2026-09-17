import { reconcileWorkspaceFinancialState } from './financial-reconcile';
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

  async afterApply(db: D1Database, workspaceId: string): Promise<void> {
    await reconcileWorkspaceFinancialState(db, workspaceId);
  },
};
