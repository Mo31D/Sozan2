import type { SimpleWorkspaceData } from '../../../data';
import { ArabicTimeField } from '../../localized-fields';
import {
  addDays,
  formatArabicDate,
  formatClockTime,
  formatDurationArabic,
  minutesToTime,
  scheduleEntriesForDate,
  timeToMinutes,
  todayIso,
} from '../../utils';

export function FreeTimeView({
  data,
  start,
  end,
  onStart,
  onEnd,
  onUseSlot,
}: {
  data: SimpleWorkspaceData;
  start: string;
  end: string;
  onStart: (value: string) => void;
  onEnd: (value: string) => void;
  onUseSlot: (date: string, startTime: string) => void;
}) {
  const startMinute = timeToMinutes(start);
  const endMinute = timeToMinutes(end);
  const validWindow = startMinute !== null && endMinute !== null && startMinute < endMinute;
  const today = todayIso();
  const pendingCount = data.sessions.filter((session) => session.scheduleStatus === 'pending').length;

  return (
    <div className="free-planner">
      <section className="free-window-card" aria-label="الفترة اليومية التي أبحث داخلها">
        <div className="free-window-head">
          <strong>الفترة اليومية</strong>
          <span>اختاري بداية ونهاية اليوم اللي تحبي تشوفي الفراغات داخله.</span>
        </div>
        <div className="free-controls">
          <label className="free-control-row"><span>من</span><ArabicTimeField value={start} onValueChange={onStart} ariaLabel="بداية الوقت المتاح" /></label>
          <label className="free-control-row"><span>إلى</span><ArabicTimeField value={end} onValueChange={onEnd} ariaLabel="نهاية الوقت المتاح" /></label>
        </div>
      </section>

      <p className="free-explainer">الفراغات تراعي مدة الحصة ووقت الانتقال المسجل. المواعيد المعلقة لا تمنع وقتًا في الجدول حتى يتم تأكيدها.</p>
      {pendingCount > 0 && (
        <div className="free-warning free-global-warning">
          عندك {pendingCount} {pendingCount === 1 ? 'موعد لسه محتاج وقت' : 'مواعيد لسه محتاجة وقت'}؛ الفراغات المعروضة محسوبة بدونها.
        </div>
      )}
      {!validWindow && <div className="simple-toast bad">اختاري وقت بداية ونهاية صحيح.</div>}

      {validWindow && (
        <div className="free-days-stack">
          {Array.from({ length: 7 }, (_, index) => addDays(today, index)).map((date, index) => {
            const entries = scheduleEntriesForDate(data, date).filter((entry) => entry.status !== 'cancelled');
            const unknown = entries.filter((entry) => timeToMinutes(entry.startTime) === null);
            const busy = entries
              .map((entry) => {
                const startAt = timeToMinutes(entry.startTime);
                if (startAt === null) return null;
                return {
                  start: startAt,
                  end: startAt + Math.max(15, entry.session.durationMinutes) + Math.max(0, entry.session.travelMinutes),
                };
              })
              .filter((item): item is { start: number; end: number } => item !== null)
              .sort((a, b) => a.start - b.start);

            const merged: Array<{ start: number; end: number }> = [];
            for (const interval of busy) {
              const last = merged.at(-1);
              if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
              else merged.push({ ...interval });
            }

            const slots: Array<{ start: number; end: number }> = [];
            let cursor = startMinute;
            for (const interval of merged) {
              if (interval.start > cursor) slots.push({ start: cursor, end: Math.min(interval.start, endMinute) });
              cursor = Math.max(cursor, interval.end);
              if (cursor >= endMinute) break;
            }
            if (cursor < endMinute) slots.push({ start: cursor, end: endMinute });
            const usable = slots.filter((slot) => slot.end - slot.start >= 30);

            return (
              <section className={`day-block free-day-card ${index === 0 ? 'today-day' : ''}`} key={date}>
                <div className="day-heading free-day-heading">
                  <strong>{formatArabicDate(date)}</strong>
                  <span>{usable.length ? `${usable.length} ${usable.length === 1 ? 'فترة متاحة' : 'فترات متاحة'}` : 'اليوم ممتلئ'}</span>
                </div>
                <div className="free-slots">
                  {usable.length ? usable.map((slot) => {
                    const from = minutesToTime(slot.start);
                    const to = minutesToTime(slot.end);
                    return (
                      <button className="free-slot-card" type="button" key={`${date}-${from}`} onClick={() => onUseSlot(date, from)}>
                        <span className="free-slot-time"><strong>{formatClockTime(from)}</strong><b>←</b><strong>{formatClockTime(to)}</strong></span>
                        <span className="free-slot-meta"><small>{formatDurationArabic(slot.end - slot.start)}</small><em>إضافة موعد</em></span>
                      </button>
                    );
                  }) : <span className="schedule-empty-row">مفيش فراغ نصف ساعة أو أكثر</span>}
                </div>
                {unknown.length > 0 && <div className="free-warning">{unknown.length} حصة مؤكدة وقتها غير محدد؛ راجعيها قبل الاعتماد على الفراغات.</div>}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
