import type { LocalReceipt } from '../tutoring/local-commands';

export function paymentLabel(value: LocalReceipt['paymentMethod']): string {
  return ({ cash: 'كاش', bank: 'بنك', wallet: 'محفظة', other: 'أخرى' } as const)[value];
}

export function weekdayLabel(value: number | null): string {
  return value === null
    ? 'اليوم غير محدد'
    : ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'][value] ?? 'غير محدد';
}

export function toPence(value: FormDataEntryValue | null): number {
  const number = Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(number) || number <= 0) throw new Error('AMOUNT_INVALID');
  return Math.round(number * 100);
}

export function toPenceZero(value: FormDataEntryValue | null): number {
  const number = Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(number) || number < 0) throw new Error('AMOUNT_INVALID');
  return Math.round(number * 100);
}

export function toPenceSigned(value: FormDataEntryValue | null): number {
  const number = Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(number)) throw new Error('AMOUNT_INVALID');
  return Math.round(number * 100);
}

export function money(pence: number, label?: string): string {
  const sign = pence < 0 ? '−' : '';
  return `${sign}${(Math.abs(pence) / 100).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ${label ?? 'ج'}`;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function formatShortDate(value: string): string {
  try {
    return new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'short', year: 'numeric' })
      .format(new Date(`${value.slice(0, 10)}T12:00:00`));
  } catch {
    return value.slice(0, 10);
  }
}

export function formatDateTime(value: string): string {
  try {
    return new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
      .format(new Date(value));
  } catch {
    return value;
  }
}

export function controlErrorText(cause: unknown): string {
  const code = cause instanceof Error ? cause.message : 'UNKNOWN';
  const map: Record<string, string> = {
    AMOUNT_INVALID: 'اكتبي مبلغًا صحيحًا.',
    RECEIPT_NOT_FOUND: 'التحصيل غير موجود.',
    RECEIPT_DELETED: 'التحصيل محذوف؛ استرجعيه أولًا.',
    EXPENSE_NOT_FOUND: 'المصروف غير موجود.',
    EXPENSE_DELETED: 'المصروف محذوف؛ استرجعيه أولًا.',
    INCOME_NOT_FOUND: 'الدخل غير موجود.',
    CASH_CHECK_NOT_FOUND: 'مطابقة الرصيد غير موجودة.',
    STUDENT_NOT_FOUND: 'الطالب غير موجود.',
    SESSION_NOT_FOUND: 'الحصة غير موجودة.',
    SESSION_FINANCE_LOCKED_BY_HISTORY: 'للحصة تاريخ سابق؛ لا يمكن تغيير التسعير أو الطلاب لأنها ستغيّر الحسابات القديمة. يمكنك تعديل اليوم والوقت والمدة والمكان.',
    SCHEDULE_DAY_REQUIRED: 'اختاري يومًا للموعد المؤكد.',
    SCHEDULE_TIME_REQUIRED: 'اختاري وقتًا للموعد المؤكد.',
    COMPLETED_REQUIRES_CORRECTION_FLOW: 'الحصة المكتملة تحتاج «رجوع لمجدولة» أولًا.',
    CORRECTION_REQUIRES_SYNC: 'يلزم مزامنة الحساب مرة واحدة قبل تصحيح هذه الحصة القديمة.',
    UNDO_NOT_SUPPORTED: 'هذا التغيير لا يدعم التراجع التلقائي.',
  };
  return map[code] ?? `تعذر إكمال العملية (${code})`;
}
