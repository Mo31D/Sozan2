import { useState } from 'react';
import type { SimpleWorkspaceData } from '../../data';
import { QuickForm, ScheduleTab, ScreenHeader } from '../components';
import { ArabicTimeField } from '../localized-fields';
import { lessonTimeDefaults } from '../session-defaults';
import type { AddDraft, ScheduleMode } from '../types';
import { todayIso, weekdayForIso, WEEKDAYS } from '../utils';
import { EditScheduleView } from './schedule/EditScheduleView';
import { FreeTimeView } from './schedule/FreeTimeView';
import { MonthView } from './schedule/MonthView';
import { WeekView } from './schedule/WeekView';

export function ScheduleScreen({
  data,
  busy,
  mode,
  assistantLabel,
  onMode,
  monthCursor,
  onMonthCursor,
  openPendingOnMount = false,
  onAdd,
  onUpdate,
  onOpenDay,
  onOpenStudent,
}: {
  data: SimpleWorkspaceData;
  busy: boolean;
  mode: ScheduleMode;
  assistantLabel: string;
  onMode: (mode: ScheduleMode) => void;
  monthCursor: Date;
  onMonthCursor: (date: Date) => void;
  openPendingOnMount?: boolean;
  onAdd: (form: FormData) => Promise<boolean>;
  onUpdate: (sessionId: string, form: FormData) => Promise<boolean>;
  onOpenDay: (date: string) => void;
  onOpenStudent: (studentId: string) => void;
}) {
  const initialDefaults = lessonTimeDefaults(1);
  const [showAdd, setShowAdd] = useState(false);
  const [addDraft, setAddDraft] = useState<AddDraft>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [freeStart, setFreeStart] = useState('09:00');
  const [freeEnd, setFreeEnd] = useState('21:00');
  const [focusPending, setFocusPending] = useState(openPendingOnMount);
  const [selectedAddStudentIds, setSelectedAddStudentIds] = useState<string[]>([]);
  const [durationMinutes, setDurationMinutes] = useState(initialDefaults.durationMinutes);
  const [travelMinutes, setTravelMinutes] = useState(initialDefaults.travelMinutes);
  const [expectedStudentCount, setExpectedStudentCount] = useState(initialDefaults.expectedStudentCount);
  const [durationTouched, setDurationTouched] = useState(false);
  const [travelTouched, setTravelTouched] = useState(false);
  const [countTouched, setCountTouched] = useState(false);

  const resetAddDefaults = () => {
    const defaults = lessonTimeDefaults(1);
    setSelectedAddStudentIds([]);
    setDurationMinutes(defaults.durationMinutes);
    setTravelMinutes(defaults.travelMinutes);
    setExpectedStudentCount(defaults.expectedStudentCount);
    setDurationTouched(false);
    setTravelTouched(false);
    setCountTouched(false);
  };

  const openAdd = (draft: AddDraft = null) => {
    resetAddDefaults();
    setAddDraft(draft);
    setShowAdd(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const toggleAddStudent = (studentId: string, checked: boolean) => {
    setSelectedAddStudentIds((current) => {
      const next = checked
        ? [...current.filter((id) => id !== studentId), studentId]
        : current.filter((id) => id !== studentId);
      const defaults = lessonTimeDefaults(next.length);
      if (!durationTouched) setDurationMinutes(defaults.durationMinutes);
      if (!travelTouched) setTravelMinutes(defaults.travelMinutes);
      if (!countTouched) setExpectedStudentCount(defaults.expectedStudentCount);
      return next;
    });
  };

  const openEdit = (sessionId: string) => {
    setEditingId(sessionId);
    setFocusPending(false);
    onMode('edit');
  };

  const openPending = () => {
    setEditingId(null);
    setFocusPending(true);
    onMode('edit');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const pendingCount = data.sessions.filter((session) => session.scheduleStatus === 'pending').length;

  return (
    <section className="simple-screen">
      <ScreenHeader kicker={assistantLabel} title="جدولي" />
      <div className="screen-action-row">
        <button className="primary-small" type="button" onClick={() => showAdd ? setShowAdd(false) : openAdd(null)}>{showAdd ? 'إغلاق' : '＋ طالب / مجموعة'}</button>
        {pendingCount > 0 && (
          <button className="schedule-attention" type="button" onClick={openPending}>
            {pendingCount} موعد محتاج وقت
          </button>
        )}
      </div>

      {showAdd && (
        <QuickForm key={`${addDraft?.weekday ?? 'new'}-${addDraft?.startTime ?? ''}`} title="أضيفي موعدًا" onSubmit={async (form) => {
          if (await onAdd(form)) {
            setShowAdd(false);
            setAddDraft(null);
            resetAddDefaults();
          }
        }} busy={busy}>
          <input name="title" placeholder="اسم الطالب أو المجموعة" required />
          <select name="sessionType" defaultValue="private_student_home"><option value="private_student_home">خاص عند الطالب</option><option value="private_tutor_home">خاص عند المدرس</option><option value="online">أونلاين</option><option value="center_group">السنتر</option><option value="own_group">مجموعة خاصة</option></select>
          <fieldset className="quick-student-picker">
            <legend>الطلاب المرتبطون بالحصة</legend>
            {data.students.map((student) => <label key={student.id}><input type="checkbox" name="studentIds" value={student.id} checked={selectedAddStudentIds.includes(student.id)} onChange={(event) => toggleAddStudent(student.id, event.currentTarget.checked)} />{student.name}</label>)}
            {!data.students.length && <small>يمكن حفظ الموعد الآن وربط الطلاب لاحقًا من «إدارة».</small>}
          </fieldset>
          <select name="scheduleStatus" defaultValue="confirmed"><option value="confirmed">الموعد محدد</option><option value="pending">الوقت لسه غير محدد</option></select>
          <select name="weekday" defaultValue={addDraft?.weekday ?? weekdayForIso(todayIso())}>{WEEKDAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}</select>
          <ArabicTimeField name="startTime" defaultValue={addDraft?.startTime ?? '16:00'} ariaLabel="وقت الموعد" />
          <label className="compact-form-field">مدة الحصة بالدقائق<input name="durationMinutes" type="number" min="15" max="360" value={durationMinutes} onChange={(event) => { setDurationTouched(true); setDurationMinutes(Number(event.currentTarget.value)); }} /></label>
          <label className="compact-form-field">وقت الانتقال بالدقائق<input name="travelMinutes" type="number" min="0" max="360" value={travelMinutes} onChange={(event) => { setTravelTouched(true); setTravelMinutes(Number(event.currentTarget.value)); }} /></label>
          <select name="priceBasis" defaultValue="total_session"><option value="total_session">السعر للحصة بالكامل</option><option value="per_student">السعر لكل طالب</option></select>
          {selectedAddStudentIds.length > 1 && (
            <label className="compact-form-field">
              المسؤول عن سعر الحصة بالكامل
              <select name="payerStudentId" defaultValue="">
                <option value="">غير محدد — حدديه لو السعر على شخص واحد</option>
                {data.students
                  .filter((student) => selectedAddStudentIds.includes(student.id))
                  .map((student) => <option key={student.id} value={student.id}>{student.name}</option>)}
              </select>
            </label>
          )}
          <input name="price" type="number" min="0" step="0.01" placeholder="سعر الحصة إن وجد" />
          <label className="compact-form-field">عدد الطلاب المتوقع<input name="expectedStudentCount" type="number" min="1" max="100" value={expectedStudentCount} onChange={(event) => { setCountTouched(true); setExpectedStudentCount(Number(event.currentTarget.value)); }} /></label>
          <input name="centerCut" type="number" min="0" max="100" step="0.01" defaultValue="0" placeholder="عمولة السنتر %" />
          <input name="location" placeholder="المكان أو ملاحظة" />
          <p className="quick-form-hint">الافتراضي: ساعة ونصف لكل طالب. لطالب واحد نحسب ٣٠ دقيقة انتقال؛ وعند ربط أكثر من طالب بنفس الموعد نفترض أنهم في نفس المكان بدون انتقال إضافي. كل القيم قابلة للتعديل.</p>
        </QuickForm>
      )}

      <div className="schedule-tabs" role="tablist" aria-label="عرض الجدول">
        <ScheduleTab active={mode === 'week'} label="أسبوع" onClick={() => { onMode('week'); setFocusPending(false); }} />
        <ScheduleTab active={mode === 'month'} label="شهر" onClick={() => { onMode('month'); setFocusPending(false); }} />
        <ScheduleTab active={mode === 'free'} label="أوقات فاضية" onClick={() => { onMode('free'); setFocusPending(false); }} />
        <ScheduleTab active={mode === 'edit'} label="تعديل" onClick={() => { onMode('edit'); setFocusPending(false); }} />
      </div>

      {mode === 'week' && <WeekView data={data} onEdit={openEdit} onOpenStudent={onOpenStudent} />}
      {mode === 'month' && <MonthView data={data} cursor={monthCursor} onCursor={onMonthCursor} onOpenDay={onOpenDay} />}
      {mode === 'free' && <FreeTimeView data={data} start={freeStart} end={freeEnd} onStart={setFreeStart} onEnd={setFreeEnd} onUseSlot={(date, startTime) => openAdd({ weekday: weekdayForIso(date), startTime })} />}
      {mode === 'edit' && <EditScheduleView data={data} busy={busy} editingId={editingId} focusPending={focusPending} onEditing={setEditingId} onSave={onUpdate} onOpenStudent={onOpenStudent} />}
    </section>
  );
}
