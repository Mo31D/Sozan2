import { useCallback, useEffect, useRef } from 'react';
import { runWorkspaceSync } from './engine';

export type AutoSyncOptions = {
  workspaceId: string;
  enabled: boolean;
  onSynced: () => Promise<void> | void;
  intervalMs?: number;
};

/**
 * Keeps a local-first workspace synchronized without making network access a
 * prerequisite for writes. All mutations remain in the outbox while offline;
 * this controller retries them when connectivity returns, when the app becomes
 * visible/focused, and periodically while the user is actively using it.
 */
export function useAutoWorkspaceSync({
  workspaceId,
  enabled,
  onSynced,
  intervalMs = 60_000,
}: AutoSyncOptions): () => Promise<void> {
  const syncingRef = useRef(false);
  const rerunRef = useRef(false);
  const onSyncedRef = useRef(onSynced);
  onSyncedRef.current = onSynced;

  const syncNow = useCallback(async () => {
    if (!enabled || typeof navigator === 'undefined' || !navigator.onLine) return;
    if (syncingRef.current) {
      rerunRef.current = true;
      return;
    }

    syncingRef.current = true;
    try {
      do {
        rerunRef.current = false;
        try {
          await runWorkspaceSync(workspaceId);
        } catch {
          // Local data and the outbox are the durable source while offline or
          // when the cloud is temporarily unavailable. A later trigger retries.
        }
        await onSyncedRef.current();
      } while (rerunRef.current && navigator.onLine);
    } finally {
      syncingRef.current = false;
    }
  }, [enabled, workspaceId]);

  useEffect(() => {
    if (!enabled) return undefined;

    const online = () => { void syncNow(); };
    const focus = () => { void syncNow(); };
    const visible = () => {
      if (document.visibilityState === 'visible') void syncNow();
    };

    void syncNow();
    window.addEventListener('online', online);
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', visible);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void syncNow();
    }, intervalMs);

    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', visible);
      window.clearInterval(timer);
    };
  }, [enabled, intervalMs, syncNow]);

  return syncNow;
}
