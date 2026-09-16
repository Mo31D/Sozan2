export type ModuleKey = 'tutoring' | 'finance' | 'planner' | 'reports' | (string & {});

export type ModuleNavItem = {
  id: string;
  labelKey: string;
  surface: string;
  order: number;
};

export type ModuleWidget = {
  id: string;
  surface: 'home' | 'me' | 'workspace' | (string & {});
  labelKey: string;
  order: number;
};

export type ModuleDefinition = {
  key: ModuleKey;
  version: number;
  title: string;
  description: string;
  dependencies: ModuleKey[];
  defaultEnabled: boolean;
  nav: ModuleNavItem[];
  widgets: ModuleWidget[];
  labels: Record<string, string>;
};

export function validateModuleGraph(modules: readonly ModuleDefinition[]): void {
  const byKey = new Map(modules.map((module) => [module.key, module]));

  if (byKey.size !== modules.length) {
    throw new Error('Duplicate module key');
  }

  for (const module of modules) {
    for (const dependency of module.dependencies) {
      if (!byKey.has(dependency)) {
        throw new Error(`Module ${module.key} requires missing module ${dependency}`);
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (key: string): void => {
    if (visited.has(key)) return;
    if (visiting.has(key)) throw new Error(`Circular module dependency at ${key}`);

    visiting.add(key);
    const module = byKey.get(key);
    for (const dependency of module?.dependencies ?? []) visit(dependency);
    visiting.delete(key);
    visited.add(key);
  };

  for (const module of modules) visit(module.key);
}
