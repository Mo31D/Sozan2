import { useState } from 'react';
import type { SimpleWorkspaceData } from '../../data';
import { QuickForm, ScheduleTab, ScreenHeader } from '../components';
import type { AddDraft, ScheduleMode } from '../types';
import { startOfMonth, todayIso, weekdayForIso, WEEKDAYS } from '../utils';
import { EditScheduleView } from './schedule/EditScheduleView';
import { FreeTimeView } from './schedule/FreeTimeView';
import { MonthView } from './schedule/MonthView';
import { WeekView } from './schedule/WeekView';

export function ScheduleScreen({
  data,
  busy,
  onAdd,
  onUpdate,
}: {
  data: SimpleWorkspaceData;
  busy: boolean;
  onAdd: (form: FormData) => Promise<boolean>;
  onUpdate: (sessionId: string, form: FormData) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<ScheduleMode>('week');
  const [showAdd, setShowAdd] = useState(false);
  const [addDraft, setAddDraft] = useState<AddDraft>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [monthCursor, setMonthCursor] = useState(() => startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState(todayIso());
  const [freeStart, setFreeStart] = useState('09:00');
  const [freeEnd, setFreeEnd] = useState('21:00');

  const openAdd = (draft: AddDraft = null) => {
    setAddDraft(draft);
    setShowAdd(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openEdit = (sessionId: string) => {
    setEditingId(sessionId);
    setMode('edit');
  };

  const pendingCount = data.sessions.filter((session) => session.scheduleStatus === 'pending').length;

  return (
    <section className="simple-screen">
      <ScreenHeader kicker="مساعد سوزان" title="جدولي" />
      <div className="screen-action-row">
        <button className="primary-small" type="button" onClick={() => showAdd ? setShowAdd(false) : openAdd(null)}>{showAdd ? 'إغلاق' : '＋ طالب / مجموعة'}</button>
        {pendingCount > 0 && <span className="schedule-attention">{pendingCount} موعد محتاج وقت</span>}
      </div>

      {showAdd && (
        <QuickForm key={`${addDraft?.weekday ?? 'new'}-${addDraft?.startTime ?? ''}`} title="أضيفي موعدًا" onSubmit={async (form) => {
          if (await onAdd(form)) {
            setShowAdd(false);
            setAddDraft(null);
          }
        }} busy={busy}>
          <input name="title" placeholder="اسم الطالب أو المجموعة" required />
          <select name="sessionType" defaultValue="private_student_home"><option value="private_student_home">خاص عند الطالب</option><option value="private_tutor_home">خاص عند المدرس</option><option value="online">أونلاين</option><option value="center_group">السنتر</option><option value="own_group">مجموعة خاصة</option></select>
          <fieldset className="quick-student-picker">
            <legend>الطلاب المرتبطون بالحصة</legend>
            {data.students.map((student) => <label key={student.id}><input type="checkbox" name="studentIds" value={student.id} />{student.name}</label>)}
            {!data.students.length && <small>يمكن حفظ الموعد الآن وربط الطلاب لاحقًا من «إدارة».</small>}
          </fieldset>
          <select name="scheduleStatus" defaultValue="confirmed"><option value="confirmed">الموعد محدد</option><option value="pending">الوقت لسه غير محدد</option></select>
          <select name="weekday" defaultValue={addDraft?.weekday ?? weekdayForIso(todayIso())}>{WEEKDAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}</select>
          <input name="startTime" type="time" defaultValue={addDraft?.startTime ?? '16:00'} />
          <input name="durationMinutes" type="number" min="15" max="360" defaultValue="60" placeholder="مدة الحصة بالدقائق" />
          <input name="travelMinutes" type="number" min="0" max="360" defaultValue="0" placeholder="وقت الانتقال بالدقائق" />
          <select name="priceBasis" defaultValue="total_session"><option value="total_session">السعر للحصة بالكامل</option><option value="per_student">السعر لكل طالب</option></select>
          <input name="price" type="number" min="0" step="0.01" placeholder="سعر الحصة إن وجد" />
          <input name="expectedStudentCount" type="number" min="1" max="100" defaultValue="1" placeholder="عدد الطلاب المتوقع" />
          <input name="centerCut" type="number" min="0" max="100" step="0.01" defaultValue="0" placeholder="عمولة السنتر %" />
          <input name="location" placeholder="المكان أو ملاحظة" />
        </QuickForm>
      )}

      <div className="schedule-tabs" role="tablist" aria-label="عرض الجدول">
        <ScheduleTab active={mode === 'week'} label="أسبوع" onClick={() => setMode('week')} />
        <ScheduleTab active={mode === 'month'} label="شهر" onClick={() => setMode('month')} />
        <ScheduleTab active={mode === 'free'} label="أوقات فاضية" onClick={() => setMode('free')} />
        <ScheduleTab active={mode === 'edit'} label="تعديل" onClick={() => setMode('edit')} />
      </div>

      {mode === 'week' && <WeekView data={data} onEdit={openEdit} />}
      {mode === 'month' && (
        <MonthView
          data={data}
          cursor={monthCursor}
          selectedDay={selectedDay}
          onSelectedDay={setSelectedDay}
          onCursor={setMonthCursor}
          onEdit={openEdit}
        />
      )}
      {mode === 'free' && (
        <FreeTimeView
          data={data}
          start={freeStart}
          end={freeEnd}
          onStart={setFreeStart}
          onEnd={setFreeEnd}
          onUseSlot={(date, startTime) => openAdd({ weekday: weekdayForIso(date), startTime })}
        />
      )}
      {mode === 'edit' && (
        <EditScheduleView
          data={data}
          busy={busy}
          editingId={editingId}
          onEditing={setEditingId}
          onSave={onUpdate}
        />
      )}
    </section>
  );
}
