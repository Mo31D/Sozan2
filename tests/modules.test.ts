import { describe, expect, it } from 'vitest';
import { BUILTIN_MODULES } from '../src/platform/modules/catalog';
import { validateModuleGraph } from '../src/platform/modules/types';
import { getWorkspaceTemplate } from '../src/templates/catalog';

describe('module platform', () => {
  it('has a valid acyclic built-in module graph', () => {
    expect(() => validateModuleGraph(BUILTIN_MODULES)).not.toThrow();
  });

  it('keeps tutoring as a template instead of the platform core', () => {
    const template = getWorkspaceTemplate('tutoring');
    expect(template?.implemented).toBe(true);
    expect(template?.modules).toEqual(['tutoring', 'finance', 'planner', 'reports']);
    expect(template?.labels['entity.activity.singular']).toBe('حصة');
  });

  it('reserves non-tutoring templates without pretending they are implemented', () => {
    expect(getWorkspaceTemplate('appointments')?.implemented).toBe(false);
    expect(getWorkspaceTemplate('appointments')?.labels['entity.activity.singular']).toBe('موعد');
  });
});
