import { describe, expect, it } from 'vitest';
import { BUILTIN_MODULES } from '../src/platform/modules/catalog';
import { availableCapabilities, canEnableModule, validateModuleGraph } from '../src/platform/modules/types';
import { getWorkspaceTemplate } from '../src/templates/catalog';

describe('module platform', () => {
  it('has a valid acyclic built-in module graph', () => {
    expect(() => validateModuleGraph(BUILTIN_MODULES)).not.toThrow();
  });

  it('keeps built-in business modules independently runnable', () => {
    for (const module of BUILTIN_MODULES) {
      expect(module.dependencies).toEqual([]);
      expect(canEnableModule(module, new Set())).toBe(true);
    }
  });

  it('uses capabilities for optional cross-module integration', () => {
    const tutoring = BUILTIN_MODULES.find((module) => module.key === 'tutoring');
    const appointments = BUILTIN_MODULES.find((module) => module.key === 'appointments');
    const planner = BUILTIN_MODULES.find((module) => module.key === 'planner');
    const capabilities = availableCapabilities(BUILTIN_MODULES);

    expect(tutoring?.uses.some((item) => item.capability === 'finance.receipts' && item.required === false)).toBe(true);
    expect(appointments?.uses.some((item) => item.capability === 'finance.receipts' && item.required === false)).toBe(true);
    expect(appointments?.provides).toContain('schedule.provider');
    expect(planner?.uses.some((item) => item.capability === 'schedule.provider' && item.required === false)).toBe(true);
    expect(capabilities.has('schedule.provider')).toBe(true);
    expect(capabilities.has('finance.receipts')).toBe(true);
  });

  it('keeps tutoring as a template instead of the platform core', () => {
    const template = getWorkspaceTemplate('tutoring');
    expect(template?.implemented).toBe(true);
    expect(template?.modules).toEqual(['tutoring', 'finance', 'planner', 'reports']);
    expect(template?.labels['entity.activity.singular']).toBe('حصة');
  });

  it('implements appointments as a separate template without tutoring semantics', () => {
    const template = getWorkspaceTemplate('appointments');
    expect(template?.implemented).toBe(true);
    expect(template?.modules).toEqual(['appointments', 'finance', 'planner', 'reports']);
    expect(template?.modules).not.toContain('tutoring');
    expect(template?.labels['entity.person.singular']).toBe('عميل');
    expect(template?.labels['entity.activity.singular']).toBe('موعد');
  });

  it('keeps future templates reserved until they are actually implemented', () => {
    expect(getWorkspaceTemplate('small_business')?.implemented).toBe(false);
    expect(getWorkspaceTemplate('custom')?.implemented).toBe(false);
  });
});
