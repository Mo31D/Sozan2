import type { SimpleWorkspaceData } from '../../../data';
import {
  addDays,
  localDate,
  scheduleEntriesForDate,
  startOfMonth,
  todayIso,
  WEEKDAYS,
} from '../../utils';

function arabicDay(value: number): string {
  return value.toLocaleString('ar-EG-u-nu-arab', { useGrouping: false });
}

export function MonthView({
  data,
  cursor,
  onCursor,
  onOpenDay,
}: {
  data: SimpleWorkspaceData;
  cursor: Date;
  onCursor: (date: Date) => void;
  onOpenDay: (date: string) => void;
}) {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const gridStartDate = new Date(year, month, 1 - first.getDay());
  const gridStart = localDate(gridStartDate);
  const today = todayIso();

  return (
    <div className="month-wrap">
      <div className="month-head">
        <strong>{new Intl.DateTimeFormat('ar-EG-u-nu-arab', { month: 'long', year: 'numeric' }).format(first)}</strong>
        <div>
          <button type="button" aria-label="الشهر السابق" onClick={() => onCursor(new Date(year, month - 1, 1))}>‹</button>
          <button type="button" onClick={() => onCursor(startOfMonth(new Date()))}>الحالي</button>
          <button type="button" aria-label="الشهر التالي" onClick={() => onCursor(new Date(year, month + 1, 1))}>›</button>
        </div>
      </div>
      <div className="month-weekdays">{WEEKDAYS.map((day) => <span key={day}>{day.slice(0, 3)}</span>)}</div>
      <div className="month-grid">
        {Array.from({ length: 42 }, (_, index) => {
          const date = addDays(gridStart, index);
          const dateObject = new Date(`${date}T12:00:00`);
          const count = scheduleEntriesForDate(data, date).length;
          return (
            <button
              type="button"
              key={date}
              aria-label={`فتح يوم ${new Intl.DateTimeFormat('ar-EG-u-nu-arab', { weekday: 'long', day: 'numeric', month: 'long' }).format(dateObject)}`}
              className={`month-cell ${dateObject.getMonth() !== month ? 'outside' : ''} ${date === today ? 'today selected' : ''}`}
              onClick={() => onOpenDay(date)}
            >
              <b>{arabicDay(dateObject.getDate())}</b>
              {count > 0 && <small>{arabicDay(count)} {count === 1 ? 'حصة' : 'حصص'}</small>}
            </button>
          );
        })}
      </div>
      <p className="month-open-hint">اضغطي على أي يوم لفتح صفحة اليوم وحصصه.</p>
    </div>
  );
}
