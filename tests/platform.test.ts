import { describe, expect, it } from 'vitest';
import { BUILTIN_MODULES } from '../src/platform/modules/catalog';
import { composeSurface } from '../src/platform/surfaces/layout';
import { canManageWorkspace, canWriteWorkspace, resolveLabel } from '../src/platform/workspaces/workspace';

describe('workspace platform', () => {
  it('supports user-neutral permissions', () => {
    expect(canManageWorkspace('owner')).toBe(true);
    expect(canManageWorkspace('admin')).toBe(true);
    expect(canManageWorkspace('member')).toBe(false);
    expect(canWriteWorkspace('viewer')).toBe(false);
  });

  it('allows workspace terminology to override module defaults', () => {
    expect(resolveLabel('entity.activity.singular', { 'entity.activity.singular': 'موعد' }, { 'entity.activity.singular': 'حصة' }, 'نشاط')).toBe('موعد');
  });

  it('composes the Me surface from independent module widgets', () => {
    const me = composeSurface(BUILTIN_MODULES, 'me');
    expect(me.map((item) => item.widgetId)).toContain('review');
    expect(me.map((item) => item.widgetId)).toContain('insights');
    expect(me.map((item) => item.widgetId)).toContain('cash-check');
  });

  it('can hide one widget without changing other modules', () => {
    const me = composeSurface(BUILTIN_MODULES, 'me', {
      surfaceKey: 'me',
      widgets: [{ widgetId: 'insights', visible: false, order: 30 }],
    });
    expect(me.map((item) => item.widgetId)).not.toContain('insights');
    expect(me.map((item) => item.widgetId)).toContain('cash-check');
  });
});
