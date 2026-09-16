import type { SimpleWorkspaceData } from '../../../data';
import { ScheduleRow } from '../../components';
import { addDays, formatArabicDate, scheduleEntriesForDate, todayIso } from '../../utils';

export function WeekView({ data, onEdit }: { data: SimpleWorkspaceData; onEdit: (sessionId: string) => void }) {
  const start = todayIso();
  return (
    <div className="schedule-week-stack">
      {Array.from({ length: 7 }, (_, index) => addDays(start, index)).map((date, index) => {
        const rows = scheduleEntriesForDate(data, date);
        return (
          <section className={`day-block ${index === 0 ? 'today-day' : ''}`} key={date}>
            <div className="day-heading"><strong>{formatArabicDate(date)}{index === 0 ? ' · النهارده' : ''}</strong><span>{rows.length ? `${rows.length} ${rows.length === 1 ? 'حصة' : 'حصص'}` : 'فاضي'}</span></div>
            {rows.length
              ? rows.map((entry) => <ScheduleRow key={`${entry.session.id}-${date}`} entry={entry} onClick={() => onEdit(entry.session.id)} />)
              : <div className="schedule-empty-row">مفيش حصص</div>}
          </section>
        );
      })}
    </div>
  );
}
