import type { ModuleDefinition } from './types';
import { validateModuleGraph } from './types';

export const BUILTIN_MODULES = [
  {
    key: 'finance',
    version: 1,
    title: 'Finance',
    description: 'Receipts, expenses, other income, allocation and reconciliation.',
    dependencies: [],
    provides: ['finance.receipts', 'finance.expenses', 'finance.reconciliation'],
    uses: [],
    defaultEnabled: true,
    nav: [{ id: 'money', labelKey: 'nav.money', surface: 'money', order: 20 }],
    widgets: [
      { id: 'money-summary', surface: 'home', labelKey: 'widget.moneySummary', order: 20 },
      { id: 'cash-check', surface: 'me', labelKey: 'widget.cashCheck', order: 40 },
    ],
    labels: {
      'nav.money': 'فلوسي',
      'widget.moneySummary': 'ملخص الفلوس',
      'widget.cashCheck': 'مطابقة الفلوس',
    },
  },
  {
    key: 'planner',
    version: 1,
    title: 'Planner',
    description: 'Planning surface that can consume schedule providers from any enabled module.',
    dependencies: [],
    provides: ['planner.surface'],
    uses: [{ capability: 'schedule.provider', required: false }],
    defaultEnabled: true,
    nav: [{ id: 'planner', labelKey: 'nav.planner', surface: 'planner', order: 30 }],
    widgets: [{ id: 'today-plan', surface: 'home', labelKey: 'widget.todayPlan', order: 10 }],
    labels: {
      'nav.planner': 'الجدول',
      'widget.todayPlan': 'اليوم',
    },
  },
  {
    key: 'tutoring',
    version: 1,
    title: 'Tutoring',
    description: 'Students, recurring lessons, attendance and package billing.',
    dependencies: [],
    provides: ['tutoring.people', 'schedule.provider', 'billing.obligations', 'reports.data'],
    uses: [
      { capability: 'finance.receipts', required: false },
      { capability: 'planner.surface', required: false },
    ],
    defaultEnabled: true,
    nav: [{ id: 'tutoring', labelKey: 'nav.tutoring', surface: 'tutoring', order: 10 }],
    widgets: [
      { id: 'today-lessons', surface: 'home', labelKey: 'widget.todayActivities', order: 10 },
      { id: 'review', surface: 'me', labelKey: 'widget.review', order: 20 },
    ],
    labels: {
      'nav.tutoring': 'التدريس',
      'entity.person.singular': 'طالب',
      'entity.person.plural': 'طلاب',
      'entity.activity.singular': 'حصة',
      'entity.activity.plural': 'حصص',
      'entity.package.singular': 'باقة',
      'widget.todayActivities': 'حصص اليوم',
      'widget.review': 'محتاج مراجعة',
    },
  },
  {
    key: 'reports',
    version: 1,
    title: 'Reports',
    description: 'Derived reporting and deterministic insights from whichever data providers are enabled.',
    dependencies: [],
    provides: ['reports.surface'],
    uses: [
      { capability: 'reports.data', required: false },
      { capability: 'finance.reconciliation', required: false },
    ],
    defaultEnabled: true,
    nav: [{ id: 'reports', labelKey: 'nav.reports', surface: 'reports', order: 40 }],
    widgets: [{ id: 'insights', surface: 'me', labelKey: 'widget.insights', order: 30 }],
    labels: {
      'nav.reports': 'التقارير',
      'widget.insights': 'ملاحظات ذكية',
    },
  },
] as const satisfies readonly ModuleDefinition[];

validateModuleGraph(BUILTIN_MODULES);

export function getModule(key: string): ModuleDefinition | undefined {
  return BUILTIN_MODULES.find((module) => module.key === key);
}
