import { useMemo, useState } from 'react';
import type { LocalActivityEvent } from '../../activity/local-activity';
import { formatDateTime } from '../presentation';
import { canUndoActivity } from '../undo';
import { Empty } from './shared';

export function ActivityView({
  events,
  busy,
  onUndo,
}: {
  events: LocalActivityEvent[];
  busy: boolean;
  onUndo: (event: LocalActivityEvent) => void;
}) {
  const [query, setQuery] = useState('');
  const visibleEvents = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ar');
    if (!normalized) return events;
    return events.filter((event) => [
      event.title,
      event.detail ?? '',
      event.action,
      event.entityType,
    ].join(' ').toLocaleLowerCase('ar').includes(normalized));
  }, [events, query]);

  return (
    <div className="control-list">
      <div className="control-edit-form control-search-form">
        <label className="wide">
          بحث في السجل
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="مثال: تحصيل، مصروف، طالب، حصة…"
            autoComplete="off"
          />
        </label>
      </div>
      {visibleEvents.map((event) => (
        <article className={`control-row ${event.undoneAt ? 'muted' : ''}`} key={event.id}>
          <div className="control-row-main">
            <strong>{event.title}</strong>
            <small>{formatDateTime(event.createdAt)}{event.undoneAt ? ' · تم التراجع' : ''}</small>
            {event.detail && <p>{event.detail}</p>}
          </div>
          {canUndoActivity(event) && (
            <button className="mini-action" type="button" disabled={busy} onClick={() => onUndo(event)}>تراجع</button>
          )}
        </article>
      ))}
      {!events.length && <Empty text="أي إضافة أو تعديل أو حذف جديد سيظهر هنا." />}
      {events.length > 0 && !visibleEvents.length && <Empty text="لا توجد نتائج مطابقة للبحث." />}
    </div>
  );
}
