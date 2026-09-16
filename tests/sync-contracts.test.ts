import { describe, expect, it } from 'vitest';
import { getSyncHandler, type ModuleSyncHandler } from '../src/server/sync/contracts';

function handler(moduleKey: string): ModuleSyncHandler {
  return {
    moduleKey,
    async apply() {},
    async snapshot() {
      return { moduleKey, data: {} };
    },
  };
}

describe('modular sync registry', () => {
  it('resolves a module only through its own sync handler', () => {
    const tutoring = handler('tutoring');
    const finance = handler('finance');
    expect(getSyncHandler([tutoring, finance], 'finance')).toBe(finance);
    expect(getSyncHandler([tutoring, finance], 'tutoring')).toBe(tutoring);
  });

  it('rejects mutations for a module that has no registered sync handler', () => {
    expect(() => getSyncHandler([handler('tutoring')], 'inventory')).toThrow('SYNC_MODULE_UNSUPPORTED');
  });
});
