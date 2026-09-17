import { useMemo, useState } from 'react';
import { minutesToTime, timeToMinutes, todayIso } from './utils';

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
  ariaLabel = 'التاريخ',
}: {
  name: string;
  defaultValue?: string;
  ariaLabel?: string;
}) {
  const initial = parseDate(defaultValue) ?? parseDate(todayIso())!;
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const [day, setDay] = useState(initial.day);
  const daysInMonth = new Date(year, month, 0).getDate();
  const safeDay = Math.min(day, daysInMonth);
  const value = `${year}-${pad(month)}-${pad(safeDay)}`;
  const currentYear = new Date().getFullYear();
  const years = useMemo(
    () => Array.from({ length: 16 }, (_, index) => currentYear - 10 + index),
    [currentYear],
  );

  return (
    <div className="localized-field localized-date-field" role="group" aria-label={ariaLabel}>
      <input type="hidden" name={name} value={value} />
      <select aria-label="اليوم" value={safeDay} onChange={(event) => setDay(Number(event.target.value))}>
        {Array.from({ length: daysInMonth }, (_, index) => index + 1).map((valueDay) => (
          <option key={valueDay} value={valueDay}>{arabicNumber(valueDay)}</option>
        ))}
      </select>
      <select aria-label="الشهر" value={month} onChange={(event) => setMonth(Number(event.target.value))}>
        {MONTHS.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}
      </select>
      <select aria-label="السنة" value={year} onChange={(event) => setYear(Number(event.target.value))}>
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
