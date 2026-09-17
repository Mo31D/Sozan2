import type { SimpleWorkspaceData } from '../../../data';
import { ScheduleRow } from '../../components';
import { addDays, formatArabicDate, scheduleEntriesForDate, todayIso } from '../../utils';

export function WeekView({
  data,
  onEdit,
  onOpenStudent,
}: {
  data: SimpleWorkspaceData;
  onEdit: (sessionId: string) => void;
  onOpenStudent: (studentId: string) => void;
}) {
  const start = todayIso();
  return (
    <div className="schedule-week-stack">
      {Array.from({ length: 7 }, (_, index) => addDays(start, index)).map((date, index) => {
        const rows = scheduleEntriesForDate(data, date);
        return (
          <section className={`day-block ${index === 0 ? 'today-day' : ''}`} key={date}>
            <div className="day-heading"><strong>{formatArabicDate(date)}{index === 0 ? ' · النهارده' : ''}</strong><span>{rows.length ? `${rows.length} ${rows.length === 1 ? 'حصة' : 'حصص'}` : 'فاضي'}</span></div>
            {rows.length
              ? rows.map((entry) => {
                const students = entry.session.studentIds
                  .map((id) => data.students.find((student) => student.id === id))
                  .filter((student): student is NonNullable<typeof student> => Boolean(student));
                return (
                  <div className="schedule-row-wrap" key={`${entry.session.id}-${date}-${entry.occurrence?.id ?? 'recurring'}`}>
                    <ScheduleRow entry={entry} onClick={() => onEdit(entry.session.id)} />
                    {students.length > 0 && <div className="student-context-links schedule-student-links">{students.map((student) => <button type="button" key={student.id} onClick={() => onOpenStudent(student.id)}>{student.name}</button>)}</div>}
                  </div>
                );
              })
              : <div className="schedule-empty-row">مفيش حصص</div>}
          </section>
        );
      })}
    </div>
  );
}
