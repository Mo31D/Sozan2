export type WorkspaceTemplate = {
  key: string;
  title: string;
  implemented: boolean;
  modules: string[];
  labels: Record<string, string>;
};

export const WORKSPACE_TEMPLATES: readonly WorkspaceTemplate[] = [
  {
    key: 'tutoring', title: 'Teaching / Tutoring', implemented: true,
    modules: ['tutoring', 'finance', 'planner', 'reports'],
    labels: {
      'entity.person.singular': 'طالب', 'entity.person.plural': 'طلاب',
      'entity.activity.singular': 'حصة', 'entity.activity.plural': 'حصص', 'entity.package.singular': 'باقة',
    },
  },
  {
    key: 'appointments', title: 'Appointments / Services', implemented: true,
    modules: ['appointments', 'finance', 'planner', 'reports'],
    labels: {
      'entity.person.singular': 'عميل', 'entity.person.plural': 'عملاء',
      'entity.activity.singular': 'موعد', 'entity.activity.plural': 'مواعيد',
    },
  },
  {
    key: 'small_business', title: 'Small Business', implemented: false,
    modules: ['finance', 'planner', 'reports'],
    labels: {
      'entity.person.singular': 'عميل', 'entity.person.plural': 'عملاء',
      'entity.activity.singular': 'مهمة', 'entity.activity.plural': 'مهام',
    },
  },
  { key: 'custom', title: 'Custom', implemented: false, modules: ['finance', 'planner'], labels: {} },
];

export function getWorkspaceTemplate(key: string): WorkspaceTemplate | undefined {
  return WORKSPACE_TEMPLATES.find((template) => template.key === key);
}
