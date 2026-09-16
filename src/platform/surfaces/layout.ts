import type { ModuleDefinition, ModuleWidget } from '../modules/types';

export type SurfaceWidgetPlacement = {
  widgetId: string;
  visible: boolean;
  order: number;
  size?: 'small' | 'medium' | 'large';
};

export type SurfaceLayout = {
  surfaceKey: string;
  widgets: SurfaceWidgetPlacement[];
};

export function availableWidgets(
  modules: readonly ModuleDefinition[],
  surfaceKey: string,
): ModuleWidget[] {
  return modules
    .flatMap((module) => module.widgets)
    .filter((widget) => widget.surface === surfaceKey)
    .sort((a, b) => a.order - b.order);
}

export function composeSurface(
  modules: readonly ModuleDefinition[],
  surfaceKey: string,
  layout?: SurfaceLayout,
): SurfaceWidgetPlacement[] {
  const widgets = availableWidgets(modules, surfaceKey);
  const configured = new Map((layout?.widgets ?? []).map((item) => [item.widgetId, item]));

  return widgets
    .map((widget) => configured.get(widget.id) ?? {
      widgetId: widget.id,
      visible: true,
      order: widget.order,
      size: 'medium' as const,
    })
    .filter((item) => item.visible)
    .sort((a, b) => a.order - b.order);
}
