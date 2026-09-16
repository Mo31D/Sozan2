import type { SimpleWorkspaceData } from '../../../data';
import { ScheduleRow } from '../../components';
import {
  addDays,
  formatArabicDate,
  localDate,
  scheduleEntriesForDate,
  startOfMonth,
  todayIso,
  WEEKDAYS,
} from '../../utils';

export function MonthView({
  data,
  cursor,
  selectedDay,
  onSelectedDay,
  onCursor,
  onEdit,
}: {
  data: SimpleWorkspaceData;
  cursor: Date;
  selectedDay: string;
  onSelectedDay: (date: string) => void;
  onCursor: (date: Date) => void;
  onEdit: (sessionId: string) => void;
}) {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const gridStartDate = new Date(year, month, 1 - first.getDay());
  const gridStart = localDate(gridStartDate);
  const today = todayIso();
  const selectedInGrid = selectedDay >= gridStart && selectedDay <= addDays(gridStart, 41)
    ? selectedDay
    : localDate(first);
  const detailRows = scheduleEntriesForDate(data, selectedInGrid);

  return (
    <div className="month-wrap">
      <div className="month-head">
        <strong>{new Intl.DateTimeFormat('ar-EG', { month: 'long', year: 'numeric' }).format(first)}</strong>
        <div>
          <button type="button" aria-label="الشهر السابق" onClick={() => onCursor(new Date(year, month - 1, 1))}>‹</button>
          <button type="button" onClick={() => { onCursor(startOfMonth(new Date())); onSelectedDay(today); }}>الحالي</button>
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
              className={`month-cell ${dateObject.getMonth() !== month ? 'outside' : ''} ${date === today ? 'today' : ''} ${date === selectedInGrid ? 'selected' : ''}`}
              onClick={() => onSelectedDay(date)}
            >
              <b>{dateObject.getDate()}</b>
              {count > 0 && <small>{count} {count === 1 ? 'حصة' : 'حصص'}</small>}
            </button>
          );
        })}
      </div>
      <div className="month-detail">
        <strong className="month-detail-title">{formatArabicDate(selectedInGrid)}</strong>
        {detailRows.length
          ? detailRows.map((entry) => <ScheduleRow key={`${entry.session.id}-${selectedInGrid}`} entry={entry} onClick={() => onEdit(entry.session.id)} />)
          : <div className="friendly-empty">مفيش حصص في اليوم ده.</div>}
      </div>
    </div>
  );
}
