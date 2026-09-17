import type { ScheduledEntry } from '../../types';
import { timeToMinutes } from '../../utils';

export type TimelineKind = 'free' | 'lesson' | 'travel';

export type TimelineSegment = {
  kind: TimelineKind;
  start: number;
  end: number;
  sessionIds: string[];
};

type BusyInterval = {
  kind: Exclude<TimelineKind, 'free'>;
  start: number;
  end: number;
  sessionId: string;
};

export function buildDayTimeline(
  entries: ScheduledEntry[],
  windowStart: number,
  windowEnd: number,
): TimelineSegment[] {
  if (!Number.isFinite(windowStart) || !Number.isFinite(windowEnd) || windowStart >= windowEnd) return [];

  const busy: BusyInterval[] = [];
  for (const entry of entries) {
    if (entry.status === 'cancelled') continue;
    const lessonStart = timeToMinutes(entry.startTime);
    if (lessonStart === null) continue;
    const lessonEnd = lessonStart + Math.max(15, entry.session.durationMinutes);
    const totalTravel = Math.max(0, entry.session.travelMinutes);
    const travelBefore = Math.floor(totalTravel / 2);
    const travelAfter = totalTravel - travelBefore;

    if (travelBefore > 0) busy.push({ kind: 'travel', start: lessonStart - travelBefore, end: lessonStart, sessionId: entry.session.id });
    busy.push({ kind: 'lesson', start: lessonStart, end: lessonEnd, sessionId: entry.session.id });
    if (travelAfter > 0) busy.push({ kind: 'travel', start: lessonEnd, end: lessonEnd + travelAfter, sessionId: entry.session.id });
  }

  const clipped = busy
    .map((item) => ({ ...item, start: Math.max(windowStart, item.start), end: Math.min(windowEnd, item.end) }))
    .filter((item) => item.end > item.start);
  const boundaries = [...new Set([windowStart, windowEnd, ...clipped.flatMap((item) => [item.start, item.end])])].sort((a, b) => a - b);
  const raw: TimelineSegment[] = [];

  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    if (end <= start) continue;
    const covering = clipped.filter((item) => item.start < end && item.end > start);
    const lessons = covering.filter((item) => item.kind === 'lesson');
    const travels = covering.filter((item) => item.kind === 'travel');
    const selected = lessons.length ? lessons : travels;
    raw.push({
      kind: lessons.length ? 'lesson' : travels.length ? 'travel' : 'free',
      start,
      end,
      sessionIds: [...new Set(selected.map((item) => item.sessionId))].sort(),
    });
  }

  const merged: TimelineSegment[] = [];
  for (const segment of raw) {
    const previous = merged.at(-1);
    const sameSessions = previous && previous.sessionIds.join('|') === segment.sessionIds.join('|');
    if (previous && previous.kind === segment.kind && sameSessions && previous.end === segment.start) previous.end = segment.end;
    else merged.push({ ...segment });
  }
  return merged;
}
