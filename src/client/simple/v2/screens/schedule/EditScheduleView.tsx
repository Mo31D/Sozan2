import { useEffect, useState } from 'react';
import type { SimpleWorkspaceData } from '../../../data';
import { ArabicTimeField } from '../../localized-fields';
import {
  compareSessionTime,
  formatClockTime,
  formatDurationArabic,
  sessionTypeLabel,
  validClockTime,
  WEEKDAYS,
} from '../../utils';

function normalizedLabel(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('ar');
}

export function EditScheduleView({
  data,
  busy,
  editingId,
  focusPending,
  onEditing,
  onSave,
  onOpenStudent,
}: {
  data: SimpleWorkspaceData;
  busy: boolean;
  editingId: string | null;
  focusPending: boolean;
  onEditing: (sessionId: string | null) => void;
  onSave: (sessionId: string, form: FormData) => Promise<boolean>;
  onOpenStudent: (studentId: string) => void;
}) {
  const sessions = [...data.sessions].sort((a, b) =>
    (a.weekday ?? 99) - (b.weekday ?? 99) || compareSessionTime(a, b),
  );
  const editing = sessions.find((session) => session.id === editingId) ?? null;
  const pendingSessions = sessions.filter((session) => session.scheduleStatus === 'pending');
  const [selectedKey, setSelectedKey] = useState<number | 'pending'>(() => focusPending ? 'pending' : new Date().getDay());

  useEffect(() => {
    if (focusPending) setSelectedKey('pending');
  }, [focusPending]);

  if (editing) {
    const linkedStudents = editing.studentIds
      .map((id) => data.students.find((student) => student.id === id))
      .filter((student): student is NonNullable<typeof student> => Boolean(student));
    return (
      <div className="edit-schedule-card">
        <div className="edit-title-row"><div><small>تعديل الموعد</small><h2>{editing.title}</h2></div><button type="button" onClick={() => onEditing(null)}>رجوع</button></div>
        {linkedStudents.length > 0 && (
          <div className="student-context-links edit-student-links" aria-label="ملفات الطلاب المرتبطين">
            {linkedStudents.map((student) => <button type="button" key={student.id} onClick={() => onOpenStudent(student.id)}>{student.name}</button>)}
          </div>
        )}
        <form onSubmit={async (event) => {
          event.preventDefault();
          if (await onSave(editing.id, new FormData(event.currentTarget))) onEditing(null);
        }}>
          <label>حالة الموعد<select name="scheduleStatus" defaultValue={editing.scheduleStatus}><option value="confirmed">موعد محدد</option><option value="pending">لسه غير محدد</option></select></label>
          <label>اليوم<select name="weekday" defaultValue={editing.weekday ?? ''}><option value="">اليوم غير محدد</option>{WEEKDAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label>
          <label className="edit-time-field">الوقت<ArabicTimeField name="startTime" defaultValue={validClockTime(editing.startTime) ? editing.startTime : '16:00'} ariaLabel="وقت الموعد" /></label>
          <label>نوع الحصة<select name="sessionType" defaultValue={editing.sessionType}><option value="private_student_home">خاص عند الطالب</option><option value="private_tutor_home">خاص عند المدرس</option><option value="online">أونلاين</option><option value="center_group">السنتر</option><option value="own_group">مجموعة خاصة</option></select></label>
          <label>مدة الحصة بالدقائق<input name="durationMinutes" type="number" min="15" max="360" defaultValue={editing.durationMinutes} /></label>
          <label>وقت الانتقال بالدقائق<input name="travelMinutes" type="number" min="0" max="360" defaultValue={editing.travelMinutes} /></label>
          <div className="edit-readonly edit-duration-preview"><span>الإجمالي المحجوز الآن</span><strong>{formatDurationArabic(editing.durationMinutes + editing.travelMinutes)}</strong></div>
          <button className="form-submit" type="submit" disabled={busy}>{busy ? 'جاري الحفظ…' : 'حفظ التعديل'}</button>
        </form>
        <p className="edit-hint">يمكن تعديل نوع الحصة واليوم والساعة والمدة ووقت الانتقال من هنا. السعر والحساب وربط الطلاب يظلوا في ملف الطالب أو «إدارة» حتى لا تختلط التعديلات المالية بالجدول.</p>
      </div>
    );
  }

  const selectedSessions = selectedKey === 'pending'
    ? pendingSessions
    : sessions.filter((session) => session.weekday === selectedKey);

  return (
    <div className="edit-grid-wrap">
      <div className="edit-week-grid" aria-label="اختاري يومًا لتعديل مواعيده">
        {WEEKDAYS.map((day, index) => {
          const count = sessions.filter((session) => session.weekday === index).length;
          return (
            <button
              type="button"
              key={day}
              className={`edit-day-cell ${selectedKey === index ? 'selected' : ''}`}
              onClick={() => setSelectedKey(index)}
            >
              <strong>{day.slice(0, 3)}</strong>
              <small>{count ? `${count} ${count === 1 ? 'موعد' : 'مواعيد'}` : 'فاضي'}</small>
            </button>
          );
        })}
      </div>

      {pendingSessions.length > 0 && (
        <button
          type="button"
          className={`edit-pending-cell ${selectedKey === 'pending' ? 'selected' : ''}`}
          onClick={() => setSelectedKey('pending')}
        >
          <span><strong>محتاج وقت</strong><small>المواعيد التي تحتاج تحديد أو مراجعة الوقت</small></span>
          <b>{pendingSessions.length}</b>
        </button>
      )}

      <div className="edit-selection-head">
        <strong>{selectedKey === 'pending' ? 'مواعيد محتاجة وقت' : WEEKDAYS[selectedKey]}</strong>
        <span>{selectedSessions.length ? `${selectedSessions.length} ${selectedSessions.length === 1 ? 'موعد' : 'مواعيد'}` : 'لا توجد مواعيد'}</span>
      </div>

      <div className="edit-session-list">
        {selectedSessions.map((session) => {
          const linkedStudents = session.studentIds
            .map((id) => data.students.find((student) => student.id === id))
            .filter((student): student is NonNullable<typeof student> => Boolean(student));
          const titleStudent = linkedStudents.length === 1
            && normalizedLabel(linkedStudents[0].name) === normalizedLabel(session.title)
            ? linkedStudents[0]
            : null;
          const footerStudents = titleStudent ? [] : linkedStudents;
          return (
            <article className="edit-session-card" key={session.id}>
              <div className="edit-session-summary">
                <span className={`session-color type-${session.sessionType}`} />
                <div className="edit-session-copy">
                  <strong>{titleStudent
                    ? <button className="edit-session-student-title" type="button" onClick={() => onOpenStudent(titleStudent.id)}>{session.title}</button>
                    : session.title}</strong>
                  <small>{session.scheduleStatus === 'pending'
                    ? `${session.weekday === null ? 'اليوم غير محدد' : WEEKDAYS[session.weekday]} · الوقت غير محدد`
                    : `${session.weekday === null ? 'اليوم غير محدد' : WEEKDAYS[session.weekday]} · ${formatClockTime(session.startTime)}`}</small>
                  <small>{sessionTypeLabel(session.sessionType)} · {formatDurationArabic(session.durationMinutes)}{session.travelMinutes ? ` + ${formatDurationArabic(session.travelMinutes)} انتقال` : ''}</small>
                </div>
              </div>
              <div className="edit-session-footer">
                {footerStudents.length > 0
                  ? <div className="student-context-links edit-list-student-links" aria-label="ملفات الطلاب">{footerStudents.map((student) => <button type="button" key={student.id} onClick={() => onOpenStudent(student.id)}>{student.name}</button>)}</div>
                  : <span className="edit-session-footer-spacer" />}
                <button className="edit-session-action" type="button" onClick={() => onEditing(session.id)}>تعديل</button>
              </div>
            </article>
          );
        })}
        {!selectedSessions.length && <div className="friendly-empty">مفيش مواعيد في الجزء ده.</div>}
      </div>
    </div>
  );
}
