import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { calendarDateInTimeZone } from '../../../../../platform/time/calendar-date';
import type { SimpleWorkspaceData } from '../../../data';
import {
  packageLessonLabelForEntry,
  packageLessonNumbersForEntry,
  scheduleEntriesForDate,
  todayIso,
  WEEKDAYS,
  weekdayForIso,
} from '../../utils';
import {
  activeBandIndex,
  clockMinuteInTimeZone,
  layoutWeekGridEntries,
  saturdayWeekDates,
  WEEK_GRID_BANDS,
  WEEK_GRID_END_MINUTE,
  WEEK_GRID_START_MINUTE,
  WEEK_GRID_TOTAL_MINUTES,
  type WeekGridLayoutEntry,
} from './week-grid';

function compactDate(iso: string): string {
  return new Intl.DateTimeFormat('ar-EG-u-nu-arab', {
    day: 'numeric',
    month: 'numeric',
  }).format(new Date(`${iso}T12:00:00`));
}

function compactRange(start: string, end: string): string {
  const formatter = new Intl.DateTimeFormat('ar-EG-u-nu-arab', {
    day: 'numeric',
    month: 'short',
  });
  return `${formatter.format(new Date(`${start}T12:00:00`))} — ${formatter.format(new Date(`${end}T12:00:00`))}`;
}

function compactHour(totalMinutes: number): string {
  const hour24 = Math.floor(totalMinutes / 60);
  const hour12 = hour24 % 12 || 12;
  const numeral = hour12.toLocaleString('ar-EG-u-nu-arab', { useGrouping: false });
  return `${numeral} ${hour24 < 12 ? 'ص' : 'م'}`;
}

function compactClockParts(totalMinutes: number): { time: string; period: 'ص' | 'م' } {
  const normalized = ((totalMinutes % (24 * 60)) + (24 * 60)) % (24 * 60);
  const hour24 = Math.floor(normalized / 60);
  const hour12 = hour24 % 12 || 12;
  const minute = normalized % 60;
  const hourText = hour12.toLocaleString('ar-EG-u-nu-arab', { useGrouping: false });
  const minuteText = minute.toLocaleString('ar-EG-u-nu-arab', {
    useGrouping: false,
    minimumIntegerDigits: 2,
  });
  return { time: `${hourText}:${minuteText}`, period: hour24 < 12 ? 'ص' : 'م' };
}

function compactLessonRange(startMinute: number, endMinute: number): string {
  const start = compactClockParts(startMinute);
  const end = compactClockParts(endMinute);
  return start.period === end.period
    ? `${start.time}–${end.time} ${end.period}`
    : `${start.time} ${start.period}–${end.time} ${end.period}`;
}

function segmentStyle(
  layout: WeekGridLayoutEntry,
  startMinute: number,
  endMinute: number,
): CSSProperties {
  const laneWidth = 100 / layout.laneCount;
  const gapPercent = Math.min(3, laneWidth * 0.08);
  const inlineStart = layout.lane * laneWidth;
  return {
    '--week-entry-top': `${((startMinute - WEEK_GRID_START_MINUTE) / WEEK_GRID_TOTAL_MINUTES) * 100}%`,
    '--week-entry-height': `${((endMinute - startMinute) / WEEK_GRID_TOTAL_MINUTES) * 100}%`,
    '--week-entry-inline-start': `${inlineStart}%`,
    '--week-entry-width': `${Math.max(0, laneWidth - gapPercent)}%`,
  } as CSSProperties;
}

function entryStyle(layout: WeekGridLayoutEntry): CSSProperties {
  return segmentStyle(layout, layout.visibleStartMinute, layout.visibleEndMinute);
}

function travelStyle(
  layout: WeekGridLayoutEntry,
  side: 'before' | 'after',
): CSSProperties | null {
  const start = side === 'before'
    ? layout.visibleTravelBeforeStartMinute
    : layout.visibleTravelAfterStartMinute;
  const end = side === 'before'
    ? layout.visibleTravelBeforeEndMinute
    : layout.visibleTravelAfterEndMinute;
  return start === null || end === null ? null : segmentStyle(layout, start, end);
}

export function WeekGridView({
  data,
  timeZone,
  onEdit,
}: {
  data: SimpleWorkspaceData;
  timeZone: string;
  onEdit: (sessionId: string) => void;
}) {
  const [now, setNow] = useState(() => new Date());
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  let currentIso: string;
  try {
    currentIso = calendarDateInTimeZone(timeZone, now);
  } catch {
    currentIso = todayIso();
  }

  const dates = useMemo(() => saturdayWeekDates(currentIso), [currentIso]);

  useEffect(() => {
    if (!window.matchMedia('(max-width: 700px)').matches) return;
    const frame = window.requestAnimationFrame(() => {
      const activeHeader = scrollRef.current?.querySelector<HTMLElement>('[data-active-day="true"]');
      activeHeader?.scrollIntoView({ block: 'nearest', inline: 'center' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentIso]);

  const minuteOfDay = clockMinuteInTimeZone(timeZone, now);
  const currentBand = activeBandIndex(minuteOfDay);
  const currentTimeTop = minuteOfDay >= WEEK_GRID_START_MINUTE && minuteOfDay < WEEK_GRID_END_MINUTE
    ? ((minuteOfDay - WEEK_GRID_START_MINUTE) / WEEK_GRID_TOTAL_MINUTES) * 100
    : null;

  const days = dates.map((date) => {
    const entries = scheduleEntriesForDate(data, date);
    return {
      date,
      entries,
      layout: layoutWeekGridEntries(entries),
    };
  });

  const outside = days.flatMap((day) =>
    day.layout.outside.map((entry) => ({ date: day.date, entry })),
  );

  return (
    <div className="week-grid-view" aria-label="الجدول الأسبوعي">
      <div className="week-grid-meta">
        <div>
          <strong>الجدول الأسبوعي</strong>
          <span>{compactRange(dates[0], dates[6])}</span>
        </div>
        <small>٨ ص — ١١ م · كل صف ٣ ساعات</small>
      </div>

      <div ref={scrollRef} className="week-grid-scroll" tabIndex={0} aria-label="مرر أفقيًا لرؤية أيام الأسبوع">
        <div className="week-grid-board" role="grid" aria-rowcount={6} aria-colcount={8}>
          <div className="week-grid-corner" role="columnheader">الوقت</div>

          {days.map(({ date }) => {
            const weekday = weekdayForIso(date);
            const active = date === currentIso;
            return (
              <div
                className={`week-grid-day-head ${active ? 'active' : ''}`}
                role="columnheader"
                aria-current={active ? 'date' : undefined}
                data-active-day={active ? 'true' : undefined}
                key={`head-${date}`}
              >
                <strong>{WEEKDAYS[weekday]}</strong>
                <small>{compactDate(date)}{active ? ' · اليوم' : ''}</small>
              </div>
            );
          })}

          <div className="week-grid-time-axis" role="rowheader">
            {WEEK_GRID_BANDS.map((band, index) => (
              <div
                className={`week-grid-time-band ${currentBand === index ? 'active' : ''}`}
                key={band.start}
              >
                <strong>{compactHour(band.start)}</strong>
                {index === WEEK_GRID_BANDS.length - 1 && <span>{compactHour(band.end)}</span>}
              </div>
            ))}
          </div>

          {days.map(({ date, layout }) => {
            const activeDay = date === currentIso;
            return (
              <div
                className={`week-grid-day-column ${activeDay ? 'active-day' : ''}`}
                role="gridcell"
                key={date}
                aria-label={`${WEEKDAYS[weekdayForIso(date)]} ${compactDate(date)}`}
              >
                {WEEK_GRID_BANDS.map((band, index) => (
                  <div
                    className={`week-grid-band ${activeDay && currentBand === index ? 'active' : ''}`}
                    key={band.start}
                  />
                ))}

                {activeDay && currentTimeTop !== null && (
                  <div
                    className="week-grid-now-line"
                    style={{ '--week-now-top': `${currentTimeTop}%` } as CSSProperties}
                    aria-hidden="true"
                  >
                    <span />
                  </div>
                )}

                {layout.visible.map((item) => {
                  const { entry } = item;
                  const clipped = item.clippedBefore || item.clippedAfter;
                  const lessonLabel = packageLessonLabelForEntry(data, entry);
                  const lessonNumbers = packageLessonNumbersForEntry(data, entry);
                  const timeRange = compactLessonRange(item.startMinute, item.endMinute);
                  const beforeStyle = travelStyle(item, 'before');
                  const afterStyle = travelStyle(item, 'after');
                  const showTravel = entry.status !== 'cancelled' && entry.status !== 'missed';
                  const travelSummary = item.travelBeforeMinutes || item.travelAfterMinutes
                    ? ` · انتقال ${item.travelBeforeMinutes} د قبل + ${item.travelAfterMinutes} د بعد`
                    : '';
                  const key = `${entry.session.id}-${date}-${entry.occurrence?.id ?? 'recurring'}`;
                  return (
                    <Fragment key={key}>
                      {showTravel && beforeStyle && (
                        <span
                          className={`week-grid-travel before status-${entry.status}`}
                          style={beforeStyle}
                          aria-hidden="true"
                        />
                      )}
                      <button
                        type="button"
                        className={`week-grid-entry type-${entry.session.sessionType} status-${entry.status}`}
                        style={entryStyle(item)}
                        title={`${entry.session.title} · ${timeRange}${travelSummary}${lessonLabel ? ` · ${lessonLabel}` : ''}`}
                        onClick={() => onEdit(entry.session.id)}
                      >
                        <span className="week-grid-entry-accent" />
                        <span className="week-grid-entry-copy">
                          <strong>
                            <span>{entry.session.title}</span>
                            {lessonNumbers && <b>{lessonNumbers}</b>}
                          </strong>
                          <small>
                            {timeRange}
                            {clipped ? ' · ممتدة خارج النطاق' : ''}
                          </small>
                        </span>
                      </button>
                      {showTravel && afterStyle && (
                        <span
                          className={`week-grid-travel after status-${entry.status}`}
                          style={afterStyle}
                          aria-hidden="true"
                        />
                      )}
                    </Fragment>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {outside.length > 0 && (
        <details className="week-grid-outside">
          <summary>مواعيد خارج نطاق الجدول <b>{outside.length}</b></summary>
          <div>
            {outside.map(({ date, entry }) => (
              <button
                type="button"
                key={`${date}-${entry.session.id}-${entry.occurrence?.id ?? 'recurring'}`}
                onClick={() => onEdit(entry.session.id)}
              >
                <span>
                  {WEEKDAYS[weekdayForIso(date)]} · {entry.session.title}
                  {packageLessonLabelForEntry(data, entry) ? ` · ${packageLessonLabelForEntry(data, entry)}` : ''}
                </span>
                <strong>
                  {entry.startTime
                    ? compactLessonRange(
                        Number(entry.startTime.slice(0, 2)) * 60 + Number(entry.startTime.slice(3, 5)),
                        Number(entry.startTime.slice(0, 2)) * 60 + Number(entry.startTime.slice(3, 5))
                          + Math.max(15, Number(entry.occurrence?.durationMinutesSnapshot ?? entry.session.durationMinutes ?? 0)),
                      )
                    : 'وقت غير محدد'}
                </strong>
              </button>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
