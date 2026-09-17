function arabicNumber(value: number, minimumIntegerDigits = 1): string {
  return value.toLocaleString('ar-EG-u-nu-arab', {
    useGrouping: false,
    minimumIntegerDigits,
  });
}

export function money(pence: number, label: string): string {
  return `${(Number(pence || 0) / 100).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ${label}`;
}

export function sum(values: number[]): number {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

export function toPence(value: FormDataEntryValue | null, allowZero = false): number {
  const numeric = Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(numeric) || numeric < 0 || (!allowZero && numeric <= 0)) throw new Error('AMOUNT_INVALID');
  return Math.round(numeric * 100);
}

export function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function todayIso(): string {
  return localDate(new Date());
}

export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDate(date);
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function validClockTime(value: string | null | undefined): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/u.test(String(value ?? ''));
}

export function timeToMinutes(value: string | null | undefined): number | null {
  if (!validClockTime(value)) return null;
  const [hours, minutes] = String(value).split(':').map(Number);
  return hours * 60 + minutes;
}

export function minutesToTime(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

export function formatClockTime(value: string | null | undefined): string {
  const total = timeToMinutes(value);
  if (total === null) return 'غير محدد';
  const hour24 = Math.floor(total / 60) % 24;
  const minute = total % 60;
  const hour12 = hour24 % 12 || 12;
  const period = hour24 < 12 ? 'صباحًا' : 'مساءً';
  return minute === 0
    ? `${arabicNumber(hour12)} ${period}`
    : `${arabicNumber(hour12)}:${arabicNumber(minute, 2)} ${period}`;
}

export function formatDurationArabic(totalMinutes: number): string {
  const safe = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;
  if (hours === 0) return `${arabicNumber(minutes)} دقيقة`;

  const hourText = hours === 1
    ? 'ساعة'
    : hours === 2
      ? 'ساعتين'
      : hours >= 3 && hours <= 10
        ? `${arabicNumber(hours)} ساعات`
        : `${arabicNumber(hours)} ساعة`;

  return minutes === 0 ? hourText : `${hourText} و${arabicNumber(minutes)} دقيقة`;
}

export function formatArabicDate(iso: string): string {
  return new Intl.DateTimeFormat('ar-EG-u-nu-arab', { weekday: 'long', day: 'numeric', month: 'long' })
    .format(new Date(`${iso.slice(0, 10)}T12:00:00`));
}

export function formatShortDate(value: string): string {
  const iso = value.slice(0, 10);
  try {
    return new Intl.DateTimeFormat('ar-EG-u-nu-arab', { day: 'numeric', month: 'short' })
      .format(new Date(`${iso}T12:00:00`));
  } catch {
    return iso;
  }
}

export function greetingForHour(hour: number): string {
  return hour < 12 ? 'صباح الخير' : 'مساء الخير';
}
