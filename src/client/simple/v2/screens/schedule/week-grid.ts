import type { ScheduledEntry } from '../../types';
import { addDays, timeToMinutes, weekdayForIso } from '../../utils';

export const WEEK_GRID_START_MINUTE = 8 * 60;
export const WEEK_GRID_END_MINUTE = 20 * 60;
export const WEEK_GRID_TOTAL_MINUTES = WEEK_GRID_END_MINUTE - WEEK_GRID_START_MINUTE;
export const WEEK_GRID_DAY_ORDER = [6, 0, 1, 2, 3, 4, 5] as const;

export const WEEK_GRID_BANDS = [
  { start: 8 * 60, end: 11 * 60 },
  { start: 11 * 60, end: 14 * 60 },
  { start: 14 * 60, end: 17 * 60 },
  { start: 17 * 60, end: 20 * 60 },
] as const;

export type WeekGridLayoutEntry = {
  entry: ScheduledEntry;
  startMinute: number;
  endMinute: number;
  visibleStartMinute: number;
  visibleEndMinute: number;
  topPercent: number;
  heightPercent: number;
  lane: number;
  laneCount: number;
  clippedBefore: boolean;
  clippedAfter: boolean;
};

export function saturdayWeekStart(iso: string): string {
  const weekday = weekdayForIso(iso);
  const daysSinceSaturday = (weekday + 1) % 7;
  return addDays(iso, -daysSinceSaturday);
}

export function saturdayWeekDates(iso: string): string[] {
  const start = saturdayWeekStart(iso);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

export function entryDurationMinutes(entry: ScheduledEntry): number {
  const historical = entry.occurrence?.durationMinutesSnapshot;
  return Math.max(15, Number(historical ?? entry.session.durationMinutes ?? 0));
}

function visibleInterval(entry: ScheduledEntry): {
  startMinute: number;
  endMinute: number;
  visibleStartMinute: number;
  visibleEndMinute: number;
} | null {
  const startMinute = timeToMinutes(entry.startTime);
  if (startMinute === null) return null;
  const endMinute = startMinute + entryDurationMinutes(entry);
  if (endMinute <= WEEK_GRID_START_MINUTE || startMinute >= WEEK_GRID_END_MINUTE) return null;

  return {
    startMinute,
    endMinute,
    visibleStartMinute: Math.max(startMinute, WEEK_GRID_START_MINUTE),
    visibleEndMinute: Math.min(endMinute, WEEK_GRID_END_MINUTE),
  };
}

function assignClusterLanes(
  entries: Array<{
    entry: ScheduledEntry;
    startMinute: number;
    endMinute: number;
    visibleStartMinute: number;
    visibleEndMinute: number;
  }>,
): WeekGridLayoutEntry[] {
  if (!entries.length) return [];

  const laneEnds: number[] = [];
  const assigned = entries.map((item) => {
    let lane = laneEnds.findIndex((end) => end <= item.startMinute);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.endMinute);
    } else {
      laneEnds[lane] = item.endMinute;
    }
    return { item, lane };
  });

  const laneCount = Math.max(1, laneEnds.length);
  return assigned.map(({ item, lane }) => ({
    ...item,
    topPercent: ((item.visibleStartMinute - WEEK_GRID_START_MINUTE) / WEEK_GRID_TOTAL_MINUTES) * 100,
    heightPercent: ((item.visibleEndMinute - item.visibleStartMinute) / WEEK_GRID_TOTAL_MINUTES) * 100,
    lane,
    laneCount,
    clippedBefore: item.startMinute < WEEK_GRID_START_MINUTE,
    clippedAfter: item.endMinute > WEEK_GRID_END_MINUTE,
  }));
}

export function layoutWeekGridEntries(entries: ScheduledEntry[]): {
  visible: WeekGridLayoutEntry[];
  outside: ScheduledEntry[];
} {
  const outside: ScheduledEntry[] = [];
  const candidates = entries
    .map((entry) => {
      const interval = visibleInterval(entry);
      if (!interval) {
        outside.push(entry);
        return null;
      }
      return { entry, ...interval };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) =>
      a.startMinute - b.startMinute
      || a.endMinute - b.endMinute
      || a.entry.session.title.localeCompare(b.entry.session.title, 'ar'),
    );

  const visible: WeekGridLayoutEntry[] = [];
  let cluster: typeof candidates = [];
  let clusterEnd = -1;

  const flush = () => {
    visible.push(...assignClusterLanes(cluster));
    cluster = [];
    clusterEnd = -1;
  };

  for (const item of candidates) {
    if (cluster.length && item.startMinute >= clusterEnd) flush();
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.endMinute);
  }
  if (cluster.length) flush();

  return { visible, outside };
}

export function activeBandIndex(minuteOfDay: number): number | null {
  const index = WEEK_GRID_BANDS.findIndex((band) =>
    minuteOfDay >= band.start && minuteOfDay < band.end,
  );
  return index === -1 ? null : index;
}

export function clockMinuteInTimeZone(timeZone: string, now = new Date()): number {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
  } catch {
    return now.getHours() * 60 + now.getMinutes();
  }

  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? now.getHours());
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? now.getMinutes());
  return hour * 60 + minute;
}
