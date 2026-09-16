import type { SimpleWorkspaceData } from '../../../data';
import {
  compareSessionTime,
  sessionTypeLabel,
  validClockTime,
  WEEKDAYS,
} from '../../utils';

export function EditScheduleView({
  data,
  busy,
  editingId,
  onEditing,
  onSave,
}: {
  data: SimpleWorkspaceData;
  busy: boolean;
  editingId: string | null;
  onEditing: (sessionId: string | null) => void;
  onSave: (sessionId: string, form: FormData) => Promise<boolean>;
}) {
  const sessions = [...data.sessions].sort((a, b) =>
    (a.weekday ?? 99) - (b.weekday ?? 99) || compareSessionTime(a, b),
  );
  const editing = sessions.find((session) => session.id === editingId) ?? null;

  if (editing) {
    return (
      <div className="edit-schedule-card">
        <div className="edit-title-row"><div><small>تعديل الموعد</small><h2>{editing.title}</h2></div><button type="button" onClick={() => onEditing(null)}>رجوع</button></div>
        <form onSubmit={async (event) => {
          event.preventDefault();
          if (await onSave(editing.id, new FormData(event.currentTarget))) onEditing(null);
        }}>
          <label>حالة الموعد<select name="scheduleStatus" defaultValue={editing.scheduleStatus}><option value="confirmed">موعد محدد</option><option value="pending">لسه غير محدد</option></select></label>
          <label>اليوم<select name="weekday" defaultValue={editing.weekday ?? ''}><option value="">اليوم غير محدد</option>{WEEKDAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label>
          <label>الوقت<input name="startTime" type="time" defaultValue={validClockTime(editing.startTime) ? editing.startTime ?? '' : ''} /></label>
          <div className="edit-readonly"><span>نوع الحصة</span><strong>{sessionTypeLabel(editing.sessionType)}</strong></div>
          <div className="edit-readonly"><span>المدة</span><strong>{editing.durationMinutes} دقيقة</strong></div>
          <button className="form-submit" type="submit" disabled={busy}>{busy ? 'جاري الحفظ…' : 'حفظ التعديل'}</button>
        </form>
        <p className="edit-hint">التعديل هنا خاص بموعد التكرار: اليوم والساعة وحالة الموعد. بيانات الطالب والحساب تظل في مكانها حتى لا تختلط التعديلات المالية بالجدول.</p>
      </div>
    );
  }

  return (
    <div className="edit-session-list">
      {sessions.map((session) => (
        <button type="button" key={session.id} onClick={() => onEditing(session.id)}>
          <span className={`session-color type-${session.sessionType}`} />
          <span><strong>{session.title}</strong><small>{session.scheduleStatus === 'pending' ? `${session.weekday === null ? 'اليوم غير محدد' : WEEKDAYS[session.weekday]} · الوقت غير محدد` : `${session.weekday === null ? 'اليوم غير محدد' : WEEKDAYS[session.weekday]} · ${session.startTime ?? 'غير محدد'}`}</small></span>
          <b>تعديل</b>
        </button>
      ))}
      {!sessions.length && <div className="friendly-empty">مفيش مواعيد محفوظة.</div>}
    </div>
  );
}
