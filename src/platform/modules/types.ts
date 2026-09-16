export type ModuleKey = 'tutoring' | 'finance' | 'planner' | 'reports' | (string & {});
export type ModuleCapability = string & {};

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

export type ModuleIntegration = {
  capability: ModuleCapability;
  required?: boolean;
};

export type ModuleDefinition = {
  key: ModuleKey;
  version: number;
  title: string;
  description: string;
  /** Hard dependencies only. Keep this list empty unless the module cannot run at all without another module. */
  dependencies: readonly ModuleKey[];
  /** Capabilities exported through public contracts/events. */
  provides: readonly ModuleCapability[];
  /** Optional integrations do not prevent a module from running independently. */
  uses: readonly ModuleIntegration[];
  defaultEnabled: boolean;
  nav: readonly ModuleNavItem[];
  widgets: readonly ModuleWidget[];
  labels: Readonly<Record<string, string>>;
};

export function validateModuleGraph(modules: readonly ModuleDefinition[]): void {
  const byKey = new Map(modules.map((module) => [module.key, module]));

  if (byKey.size !== modules.length) throw new Error('Duplicate module key');

  for (const module of modules) {
    const provided = new Set(module.provides);
    if (provided.size !== module.provides.length) {
      throw new Error(`Module ${module.key} declares duplicate capabilities`);
    }

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

export function canEnableModule(
  module: ModuleDefinition,
  enabledModuleKeys: ReadonlySet<string>,
): boolean {
  return module.dependencies.every((dependency) => enabledModuleKeys.has(dependency));
}

export function availableCapabilities(
  modules: readonly ModuleDefinition[],
): ReadonlySet<string> {
  return new Set(modules.flatMap((module) => [...module.provides]));
}
