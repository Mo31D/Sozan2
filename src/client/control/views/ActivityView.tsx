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
  return (
    <div className="control-list">
      {events.map((event) => (
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
    </div>
  );
}
