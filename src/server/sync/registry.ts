import { financialReconcileSyncHook } from '../integrations/financial-reconcile.sync-hook';
import { appointmentsSyncHandler } from './appointments.sync';
import { coreSyncHandler } from './core.sync';
import { financeSyncHandler } from './finance-router.sync';
import { tutoringSessionSyncHandler } from './tutoring-session-sync';
import type { ModuleSyncHandler, SyncPostApplyHook } from './contracts';

/**
 * Composition root for sync modules. Transport code depends only on the module
 * and hook contracts; replacing a module is a registry change, not a router
 * rewrite.
 */
export const syncHandlers: readonly ModuleSyncHandler[] = [
  coreSyncHandler,
  tutoringSessionSyncHandler,
  appointmentsSyncHandler,
  financeSyncHandler,
];

export const syncPostApplyHooks: readonly SyncPostApplyHook[] = [
  financialReconcileSyncHook,
];
