export type ControlTab = 'activity' | 'receipts' | 'expenses' | 'income' | 'cash' | 'students' | 'sessions' | 'reports';

export type ControlAction = (
  action: () => Promise<void>,
  successMessage: string,
) => Promise<boolean>;
