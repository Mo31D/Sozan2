import { useMemo, useState } from 'react';
import { minutesToTime, timeToMinutes, todayIso } from '../../shared/format';

const MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

function arabicNumber(value: number, minimumIntegerDigits = 1): string {
  return value.toLocaleString('ar-EG-u-nu-arab', {
    useGrouping: false,
    minimumIntegerDigits,
  });
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function parseDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function ArabicDateField({
  name,
  defaultValue = todayIso(),
  value,
  onValueChange,
  ariaLabel = 'التاريخ',
}: {
  name?: string;
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  ariaLabel?: string;
}) {
  const initial = parseDate(value ?? defaultValue) ?? parseDate(todayIso())!;
  const [internalYear, setInternalYear] = useState(initial.year);
  const [internalMonth, setInternalMonth] = useState(initial.month);
  const [internalDay, setInternalDay] = useState(initial.day);
  const controlled = value ? parseDate(value) : null;
  const year = controlled?.year ?? internalYear;
  const month = controlled?.month ?? internalMonth;
  const day = controlled?.day ?? internalDay;
  const daysInMonth = new Date(year, month, 0).getDate();
  const safeDay = Math.min(day, daysInMonth);
  const currentValue = `${year}-${pad(month)}-${pad(safeDay)}`;
  const currentYear = new Date().getFullYear();
  const years = useMemo(
    () => Array.from({ length: 16 }, (_, index) => currentYear - 10 + index),
    [currentYear],
  );

  const update = (nextYear: number, nextMonth: number, nextDay: number) => {
    const maxDay = new Date(nextYear, nextMonth, 0).getDate();
    const normalizedDay = Math.min(nextDay, maxDay);
    const next = `${nextYear}-${pad(nextMonth)}-${pad(normalizedDay)}`;
    if (value === undefined) {
      setInternalYear(nextYear);
      setInternalMonth(nextMonth);
      setInternalDay(normalizedDay);
    }
    onValueChange?.(next);
  };

  return (
    <div className="localized-field localized-date-field" role="group" aria-label={ariaLabel}>
      {name && <input type="hidden" name={name} value={currentValue} />}
      <select aria-label="اليوم" value={safeDay} onChange={(event) => update(year, month, Number(event.target.value))}>
        {Array.from({ length: daysInMonth }, (_, index) => index + 1).map((valueDay) => (
          <option key={valueDay} value={valueDay}>{arabicNumber(valueDay)}</option>
        ))}
      </select>
      <select aria-label="الشهر" value={month} onChange={(event) => update(year, Number(event.target.value), safeDay)}>
        {MONTHS.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}
      </select>
      <select aria-label="السنة" value={year} onChange={(event) => update(Number(event.target.value), month, safeDay)}>
        {years.map((valueYear) => <option key={valueYear} value={valueYear}>{arabicNumber(valueYear)}</option>)}
      </select>
    </div>
  );
}

function parseTime(value: string | null | undefined) {
  const total = timeToMinutes(value);
  const minutes = total ?? 9 * 60;
  const hour24 = Math.floor(minutes / 60) % 24;
  return {
    hour24,
    hour12: hour24 % 12 || 12,
    minute: minutes % 60,
    period: hour24 >= 12 ? 'pm' as const : 'am' as const,
  };
}

export function ArabicTimeField({
  name,
  defaultValue,
  value,
  onValueChange,
  ariaLabel = 'الوقت',
}: {
  name?: string;
  defaultValue?: string | null;
  value?: string;
  onValueChange?: (value: string) => void;
  ariaLabel?: string;
}) {
  const [internal, setInternal] = useState(defaultValue ?? '09:00');
  const current = value ?? internal;
  const parsed = parseTime(current);

  const update = (nextHour12: number, nextMinute: number, nextPeriod: 'am' | 'pm') => {
    let hour24 = nextHour12 % 12;
    if (nextPeriod === 'pm') hour24 += 12;
    const next = minutesToTime(hour24 * 60 + nextMinute);
    if (value === undefined) setInternal(next);
    onValueChange?.(next);
  };

  return (
    <div className="localized-field localized-time-field" role="group" aria-label={ariaLabel}>
      {name && <input type="hidden" name={name} value={current} />}
      <select aria-label="الساعة" value={parsed.hour12} onChange={(event) => update(Number(event.target.value), parsed.minute, parsed.period)}>
        {Array.from({ length: 12 }, (_, index) => index + 1).map((hour) => (
          <option key={hour} value={hour}>{arabicNumber(hour)}</option>
        ))}
      </select>
      <select aria-label="الدقيقة" value={parsed.minute} onChange={(event) => update(parsed.hour12, Number(event.target.value), parsed.period)}>
        {Array.from({ length: 60 }, (_, minute) => (
          <option key={minute} value={minute}>{minute === 0 ? 'بدون دقائق' : arabicNumber(minute, 2)}</option>
        ))}
      </select>
      <select aria-label="الفترة" value={parsed.period} onChange={(event) => update(parsed.hour12, parsed.minute, event.target.value as 'am' | 'pm')}>
        <option value="am">صباحًا</option>
        <option value="pm">مساءً</option>
      </select>
    </div>
  );
}
