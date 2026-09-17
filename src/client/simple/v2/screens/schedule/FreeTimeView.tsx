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
import { buildDayTimeline, type TimelineSegment } from './timeline';

export function FreeTimeView({
  data,
  start,
  end,
  onStart,
  onEnd,
  onUseSlot,
  onOpenLesson,
  onEditTravel,
}: {
  data: SimpleWorkspaceData;
  start: string;
  end: string;
  onStart: (value: string) => void;
  onEnd: (value: string) => void;
  onUseSlot: (date: string, startTime: string) => void;
  onOpenLesson: (sessionId: string) => void;
  onEditTravel: (sessionId: string) => void;
}) {
  const startMinute = timeToMinutes(start);
  const endMinute = timeToMinutes(end);
  const validWindow = startMinute !== null && endMinute !== null && startMinute < endMinute;
  const today = todayIso();
  const pendingCount = data.sessions.filter((session) => session.scheduleStatus === 'pending').length;

  return (
    <div className="free-planner free-timeline-planner">
      <div className="free-controls">
        <label>من<ArabicTimeField value={start} onValueChange={onStart} ariaLabel="بداية الوقت المتاح" /></label>
        <label>إلى<ArabicTimeField value={end} onValueChange={onEnd} ariaLabel="نهاية الوقت المتاح" /></label>
      </div>
      <div className="timeline-legend" aria-label="مفتاح ألوان الجدول">
        <span><i className="legend-lesson" />حصة</span>
        <span><i className="legend-travel" />انتقال</span>
        <span><i className="legend-free" />فاضي</span>
      </div>
      <p className="free-timeline-copy">كل يوم ظاهر كشريط زمني واحد. وقت الانتقال بيتقسم تلقائيًا قبل وبعد الحصة؛ اضغطي على أي جزء للتصرف فيه.</p>
      {pendingCount > 0 && (
        <div className="free-warning free-global-warning">
          عندك {pendingCount} {pendingCount === 1 ? 'موعد لسه محتاج وقت' : 'مواعيد لسه محتاجة وقت'}؛ الجدول المعروض محسوب بدونها.
        </div>
      )}
      {!validWindow && <div className="simple-toast bad">اختاري وقت بداية ونهاية صحيح.</div>}
      {validWindow && Array.from({ length: 7 }, (_, index) => addDays(today, index)).map((date) => {
        const entries = scheduleEntriesForDate(data, date).filter((entry) => entry.status !== 'cancelled');
        const unknown = entries.filter((entry) => timeToMinutes(entry.startTime) === null);
        const timeline = buildDayTimeline(entries, startMinute, endMinute);
        const free = timeline.filter((segment) => segment.kind === 'free');
        const totalFree = free.reduce((total, segment) => total + segment.end - segment.start, 0);
        const windowLength = endMinute - startMinute;

        return (
          <section className="timeline-day" key={date}>
            <div className="timeline-day-head">
              <strong>{formatArabicDate(date)}</strong>
              <span>{totalFree ? `${formatDurationArabic(totalFree)} فاضي` : 'اليوم محجوز'}</span>
            </div>
            <div className="timeline-hours" dir="ltr"><span>{formatClockTime(start)}</span><span>{formatClockTime(end)}</span></div>
            <div className="timeline-track" dir="ltr" role="group" aria-label={`الجدول الزمني ${formatArabicDate(date)}`}>
              {timeline.map((segment, segmentIndex) => {
                const width = ((segment.end - segment.start) / windowLength) * 100;
                return (
                  <TimelineButton
                    key={`${date}-${segment.start}-${segment.kind}-${segmentIndex}`}
                    segment={segment}
                    width={width}
                    data={data}
                    onClick={() => {
                      if (segment.kind === 'free') onUseSlot(date, minutesToTime(segment.start));
                      else if (segment.kind === 'travel' && segment.sessionIds[0]) onEditTravel(segment.sessionIds[0]);
                      else if (segment.sessionIds[0]) onOpenLesson(segment.sessionIds[0]);
                    }}
                  />
                );
              })}
            </div>
            <div className="timeline-free-chips">
              {free.filter((segment) => segment.end - segment.start >= 30).map((segment) => (
                <button type="button" key={`${date}-free-${segment.start}`} onClick={() => onUseSlot(date, minutesToTime(segment.start))}>
                  <strong>{formatClockTime(minutesToTime(segment.start))} – {formatClockTime(minutesToTime(segment.end))}</strong>
                  <small>{formatDurationArabic(segment.end - segment.start)} · إضافة موعد</small>
                </button>
              ))}
              {!free.some((segment) => segment.end - segment.start >= 30) && <span className="schedule-empty-row">مفيش فراغ نصف ساعة أو أكثر</span>}
            </div>
            {unknown.length > 0 && <div className="free-warning">{unknown.length} حصة مؤكدة وقتها غير محدد؛ راجعيها قبل الاعتماد على الخط الزمني.</div>}
          </section>
        );
      })}
    </div>
  );
}

function TimelineButton({
  segment,
  width,
  data,
  onClick,
}: {
  segment: TimelineSegment;
  width: number;
  data: SimpleWorkspaceData;
  onClick: () => void;
}) {
  const session = segment.sessionIds[0] ? data.sessions.find((row) => row.id === segment.sessionIds[0]) : null;
  const from = formatClockTime(minutesToTime(segment.start));
  const to = formatClockTime(minutesToTime(segment.end));
  const label = segment.kind === 'free'
    ? `فاضي ${from} إلى ${to}`
    : segment.kind === 'travel'
      ? `انتقال ${from} إلى ${to}${session ? ` لحصة ${session.title}` : ''}`
      : `${session?.title ?? 'حصة'} ${from} إلى ${to}`;
  const showText = width >= 13;

  return (
    <button
      type="button"
      className={`timeline-segment ${segment.kind}`}
      style={{ width: `${Math.max(width, 0.25)}%` }}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {showText && <span>{segment.kind === 'free' ? 'فاضي' : segment.kind === 'travel' ? 'انتقال' : session?.title ?? 'حصة'}</span>}
    </button>
  );
}
