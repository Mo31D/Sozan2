import { type FormEvent, type ReactNode } from 'react';
import { formatClockTime, sessionTypeLabel } from './utils';
import type { ScheduledEntry } from './types';

export function QuickForm({
  title,
  onSubmit,
  busy,
  children,
}: {
  title: string;
  onSubmit: (form: FormData) => void | Promise<void>;
  busy: boolean;
  children: ReactNode;
}) {
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onSubmit(new FormData(event.currentTarget));
  };
  return (
    <form className="quick-form" onSubmit={(event) => void submit(event)}>
      <h3>{title}</h3>{children}
      <button className="form-submit" type="submit" disabled={busy}>{busy ? 'جاري الحفظ…' : 'حفظ'}</button>
    </form>
  );
}

export function ScreenHeader({ kicker, title }: { kicker: string; title: string }) {
  return <header className="simple-header"><span>{kicker}</span><h1>{title}</h1></header>;
}

export function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return <div className="simple-section-title"><span>{eyebrow}</span><h2>{title}</h2></div>;
}

export function Metric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return <div className={`metric-card ${accent ? 'accent' : ''}`}><span>{label}</span><strong>{value}</strong></div>;
}

export function NavButton({ active, label, icon, onClick }: { active: boolean; label: string; icon: string; onClick: () => void }) {
  return <button type="button" className={active ? 'active' : ''} onClick={onClick}><b>{icon}</b><span>{label}</span></button>;
}

export function ScheduleTab({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return <button type="button" role="tab" aria-selected={active} className={active ? 'active' : ''} onClick={onClick}>{label}</button>;
}

export function ScheduleRow({
  entry,
  onClick,
  lessonLabel,
}: {
  entry: ScheduledEntry;
  onClick: () => void;
  lessonLabel?: string | null;
}) {
  const state = entry.status === 'completed'
    ? ' · تمت'
    : entry.status === 'cancelled'
      ? ' · ملغاة'
      : entry.status === 'missed' ? ' · فائتة' : '';
  return (
    <button type="button" className={`schedule-row schedule-row-button status-${entry.status}`} onClick={onClick}>
      <span className={`session-color type-${entry.session.sessionType}`} />
      <span>
        <strong>{entry.session.title}</strong>
        <small>{sessionTypeLabel(entry.session.sessionType)}{lessonLabel ? ` · ${lessonLabel}` : ''}{state}</small>
      </span>
      <time>{entry.startTime ? formatClockTime(entry.startTime) : 'غير محدد'}</time>
    </button>
  );
}
