import { useState } from 'react';
import { effectiveTravelMinutes, splitTravelMinutes } from '../../../../../modules/tutoring/domain/schedule-conflict';
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
import {
  FREE_TIME_REQUIREMENTS,
  freeSlotFits,
  type FreeTimeRequirementId,
} from './free-time';

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
  const [requirementId, setRequirementId] = useState<FreeTimeRequirementId>('standard');
  const requirement = FREE_TIME_REQUIREMENTS.find((option) => option.id === requirementId) ?? FREE_TIME_REQUIREMENTS[0];

  return (
    <div className="free-planner">
      <section className="free-window-card" aria-label="إعداد البحث عن وقت فاضي">
        <div className="free-window-head">
          <strong>أدور على وقت فاضي</strong>
          <span>حددي ساعات اليوم والمدة التي لازم يكون الفراغ قادر يستوعبها.</span>
        </div>
        <div className="free-controls">
          <label className="free-control-row"><span>من</span><ArabicTimeField value={start} onValueChange={onStart} ariaLabel="بداية الوقت المتاح" /></label>
          <label className="free-control-row"><span>إلى</span><ArabicTimeField value={end} onValueChange={onEnd} ariaLabel="نهاية الوقت المتاح" /></label>
        </div>
        <label className="free-requirement">
          <span>وقت يكفي لـ</span>
          <select value={requirementId} onChange={(event) => setRequirementId(event.currentTarget.value as FreeTimeRequirementId)}>
            {FREE_TIME_REQUIREMENTS.map((option) => (
              <option value={option.id} key={option.id}>{option.label} · {formatDurationArabic(option.minutes)}</option>
            ))}
          </select>
        </label>
      </section>

      <p className="free-explainer">نعرض فقط الفراغات التي تكفي {formatDurationArabic(requirement.minutes)} أو أكثر. الحساب يحجز وقت الانتقال قبل وبعد الحصة حتى لا يظهر انتقال مستحيل بين مكانين، والمواعيد المعلقة لا تحجز وقتًا حتى تتحدد.</p>
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
                const travel = splitTravelMinutes(effectiveTravelMinutes(
                  entry.session.sessionType,
                  entry.occurrence?.travelMinutesSnapshot ?? entry.session.travelMinutes,
                ));
                const duration = Math.max(
                  15,
                  Number(entry.occurrence?.durationMinutesSnapshot ?? entry.session.durationMinutes),
                );
                return {
                  start: Math.max(0, startAt - travel.before),
                  end: Math.min(24 * 60, startAt + duration + travel.after),
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
            const usable = slots.filter((slot) => freeSlotFits(slot.start, slot.end, requirement.minutes));

            return (
              <section className={`day-block free-day-card ${index === 0 ? 'today-day' : ''}`} key={date}>
                <div className="day-heading free-day-heading">
                  <strong>{formatArabicDate(date)}</strong>
                  <span>{usable.length ? `${usable.length} ${usable.length === 1 ? 'فترة مناسبة' : 'فترات مناسبة'}` : 'مفيش وقت كافي'}</span>
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
                  }) : <span className="schedule-empty-row">مفيش فراغ يكفي {formatDurationArabic(requirement.minutes)}</span>}
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
