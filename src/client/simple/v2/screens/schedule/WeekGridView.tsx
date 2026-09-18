import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { calendarDateInTimeZone } from '../../../../../platform/time/calendar-date';
import type { SimpleWorkspaceData } from '../../../data';
import {
  formatClockTime,
  scheduleEntriesForDate,
  timeToMinutes,
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

function entryStyle(layout: WeekGridLayoutEntry): CSSProperties {
  const laneWidth = 100 / layout.laneCount;
  const gapPercent = Math.min(3, laneWidth * 0.08);
  const inlineStart = layout.lane * laneWidth;
  return {
    '--week-entry-top': `${layout.topPercent}%`,
    '--week-entry-height': `${layout.heightPercent}%`,
    '--week-entry-inline-start': `${inlineStart}%`,
    '--week-entry-width': `${Math.max(0, laneWidth - gapPercent)}%`,
  } as CSSProperties;
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
  const minuteOfDay = clockMinuteInTimeZone(timeZone, now);
  const currentBand = activeBandIndex(minuteOfDay);
  const currentTimeTop = minuteOfDay >= WEEK_GRID_START_MINUTE && minuteOfDay < WEEK_GRID_END_MINUTE
    ? ((minuteOfDay - WEEK_GRID_START_MINUTE) / WEEK_GRID_TOTAL_MINUTES) * 100
    : null;

  const days = dates.map((date) => {
    const entries = scheduleEntriesForDate(data, date).filter((entry) => entry.status !== 'cancelled');
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
        <small>٨ ص — ٨ م · كل صف ٣ ساعات</small>
      </div>

      <div className="week-grid-scroll" tabIndex={0} aria-label="مرر أفقيًا لرؤية أيام الأسبوع">
        <div className="week-grid-board" role="grid" aria-rowcount={5} aria-colcount={8}>
          <div className="week-grid-corner" role="columnheader">الوقت</div>

          {days.map(({ date }) => {
            const weekday = weekdayForIso(date);
            const active = date === currentIso;
            return (
              <div
                className={`week-grid-day-head ${active ? 'active' : ''}`}
                role="columnheader"
                aria-current={active ? 'date' : undefined}
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
                <span>{compactHour(band.end)}</span>
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
                  return (
                    <button
                      type="button"
                      className={`week-grid-entry type-${entry.session.sessionType} status-${entry.status}`}
                      style={entryStyle(item)}
                      key={`${entry.session.id}-${date}-${entry.occurrence?.id ?? 'recurring'}`}
                      title={`${entry.session.title} · ${entry.startTime ? formatClockTime(entry.startTime) : 'غير محدد'}`}
                      onClick={() => onEdit(entry.session.id)}
                    >
                      <span className="week-grid-entry-accent" />
                      <span className="week-grid-entry-copy">
                        <strong>{entry.session.title}</strong>
                        <small>
                          {entry.startTime ? formatClockTime(entry.startTime) : 'غير محدد'}
                          {clipped ? ' · ممتدة خارج النطاق' : ''}
                        </small>
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {outside.length > 0 && (
        <details className="week-grid-outside">
          <summary>مواعيد خارج ٨ ص–٨ م أو بدون وقت <b>{outside.length}</b></summary>
          <div>
            {outside.map(({ date, entry }) => (
              <button
                type="button"
                key={`${date}-${entry.session.id}-${entry.occurrence?.id ?? 'recurring'}`}
                onClick={() => onEdit(entry.session.id)}
              >
                <span>{WEEKDAYS[weekdayForIso(date)]} · {entry.session.title}</span>
                <strong>{entry.startTime ? formatClockTime(entry.startTime) : 'وقت غير محدد'}</strong>
              </button>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
