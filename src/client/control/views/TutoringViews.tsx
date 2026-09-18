import type { FormEvent } from 'react';
import { buildStudentFinancialSummary } from '../../../modules/reports/student-finance';
import type { Student } from '../../../modules/tutoring/domain/student';
import type { RecurringSession } from '../../../modules/tutoring/domain/session';
import { ArabicTimeField } from '../../simple/v2/localized-fields';
import { formatClockTime } from '../../simple/v2/utils';
import { archiveLocalSession, updateLocalSessionDetails } from '../../tutoring/session-corrections';
import { updateLocalStudent } from '../../tutoring/student-corrections';
import type { ControlCenterData } from '../data';
import { formatShortDate, money, toPenceZero, weekdayLabel } from '../presentation';
import { Empty, type CommonListProps } from './shared';

export function StudentsView({
  data,
  profileId,
  setProfileId,
  editId,
  setEditId,
  busy,
  currency,
  act,
  workspaceId,
}: CommonListProps & {
  data: ControlCenterData;
  profileId: string | null;
  setProfileId: (id: string | null) => void;
}) {
  const student = data.simple.students.find((row) => row.id === profileId) ?? null;
  if (!student) {
    return (
      <div className="control-list">
        {data.simple.students.map((row) => (
          <button className="student-control-row" type="button" key={row.id} onClick={() => setProfileId(row.id)}>
            <span className="student-avatar-control">{row.name.trim().charAt(0)}</span>
            <span><strong>{row.name}</strong><small>{row.guardianName || 'ولي الأمر غير مسجل'}</small></span>
            <b>فتح</b>
          </button>
        ))}
        {!data.simple.students.length && <Empty text="لا يوجد طلاب." />}
      </div>
    );
  }

  const sessions = data.simple.sessions.filter((row) => row.studentIds.includes(student.id));
  const receipts = data.receipts.filter((row) => row.payerRefId === student.id && !row.deletedAt);
  const cycles = data.simple.billingCycles
    .filter((row) => row.studentId === student.id && row.status !== 'cancelled')
    .sort((a, b) => b.sequenceNo - a.sequenceNo);
  const cycle = cycles[0];
  const financial = buildStudentFinancialSummary(data.simple, student.id);

  return (
    <div className="student-profile-control">
      <div className="profile-top">
        <button type="button" onClick={() => { setProfileId(null); setEditId(null); }}>رجوع</button>
        <div><small>ملف الطالب</small><h3>{student.name}</h3></div>
        <button type="button" onClick={() => setEditId(editId === student.id ? null : student.id)}>تعديل</button>
      </div>
      <div className="profile-metrics">
        <div><span>الباقة</span><strong>{cycle ? `${cycle.openingCompletedCount + cycle.realCompletedCount}/${cycle.sessionLimit}` : 'بالحصة'}</strong></div>
        <div><span>مطلوب تحصيله الآن</span><strong>{money(financial.duePence, currency)}</strong></div>
        <div><span>رصيد مقدم</span><strong>{money(financial.creditPence, currency)}</strong></div>
        <div><span>قبضتي منه</span><strong>{money(financial.receivedPence, currency)}</strong></div>
        <div>
          <span>آخر تحصيل</span>
          <strong>{financial.lastPayment ? money(financial.lastPayment.amountPence, currency) : '—'}</strong>
          {financial.lastPayment && <small>{formatShortDate(financial.lastPayment.receivedAt)}</small>}
        </div>
        <div><span>المواعيد</span><strong>{sessions.length}</strong></div>
      </div>
      {editId === student.id ? (
        <StudentForm
          student={student}
          busy={busy}
          onSubmit={(form) => act(async () => {
            await updateLocalStudent(workspaceId, student.id, {
              name: String(form.get('name') ?? ''),
              age: form.get('age') ? Number(form.get('age')) : null,
              guardianName: String(form.get('guardian') ?? ''),
              guardianPhone: String(form.get('phone') ?? ''),
              level: String(form.get('level') ?? ''),
              notes: String(form.get('notes') ?? ''),
            });
            setEditId(null);
          }, 'تم تعديل بيانات الطالب.')}
        />
      ) : (
        <div className="profile-info">
          <p><span>ولي الأمر</span><b>{student.guardianName || 'غير مسجل'}</b></p>
          <p><span>الهاتف</span><b>{student.guardianPhone || 'غير مسجل'}</b></p>
          <p><span>المستوى</span><b>{student.level || 'غير مسجل'}</b></p>
          {student.notes && <p><span>ملاحظات</span><b>{student.notes}</b></p>}
        </div>
      )}
      <h4>المواعيد</h4>
      <div className="mini-history">
        {sessions.map((row) => (
          <div key={row.id}>
            <strong>{row.title}</strong>
            <small>{row.scheduleStatus === 'pending' ? 'موعد غير محدد' : `${weekdayLabel(row.weekday)} · ${formatClockTime(row.startTime)}`}</small>
          </div>
        ))}
      </div>
      <h4>آخر التحصيلات</h4>
      <div className="mini-history">
        {receipts.slice(0, 10).map((row) => <div key={row.id}><strong>{money(row.amountPence, currency)}</strong><small>{formatShortDate(row.receivedAt)}</small></div>)}
      </div>
    </div>
  );
}

export function SessionsView({ data, editId, setEditId, busy, act, workspaceId }: CommonListProps & { data: ControlCenterData }) {
  const session = data.sessions.find((row) => row.id === editId) ?? null;
  if (!session) {
    const activeSessions = data.sessions.filter((row) => row.active);
    return (
      <div className="control-list">
        {activeSessions.map((row) => (
          <button className="student-control-row" type="button" key={row.id} onClick={() => setEditId(row.id)}>
            <span className="student-avatar-control">{row.title.trim().charAt(0)}</span>
            <span><strong>{row.title}</strong><small>{row.scheduleStatus === 'pending' ? 'موعد غير محدد' : `${weekdayLabel(row.weekday)} · ${formatClockTime(row.startTime)}`}</small></span>
            <b>تعديل</b>
          </button>
        ))}
        {!activeSessions.length && <Empty text="لا توجد حصص متكررة نشطة." />}
      </div>
    );
  }

  return (
    <div className="student-profile-control">
      <div className="profile-top">
        <button type="button" onClick={() => setEditId(null)}>رجوع</button>
        <div><small>تعديل الحصة</small><h3>{session.title}</h3></div>
        <button className="danger-inline" type="button" disabled={busy} onClick={() => {
          if (confirm('إيقاف هذا الموعد المتكرر؟ التاريخ السابق سيظل محفوظًا.')) {
            void act(async () => {
              await archiveLocalSession(workspaceId, session.id);
              setEditId(null);
            }, 'تم إيقاف الموعد مع الاحتفاظ بالتاريخ.');
          }
        }}>إيقاف</button>
      </div>
      <form className="control-edit-form session-full-form" onSubmit={(event) => submitSessionEdit(event, session, workspaceId, setEditId, act)}>
        <label className="wide">الاسم<input name="title" defaultValue={session.title} required /></label>
        <label>النوع<select name="sessionType" defaultValue={session.sessionType}><option value="private_student_home">خاص عند الطالب</option><option value="private_tutor_home">خاص عند المدرس</option><option value="online">أونلاين</option><option value="center_group">السنتر</option><option value="own_group">مجموعة خاصة</option></select></label>
        <label>حالة الموعد<select name="scheduleStatus" defaultValue={session.scheduleStatus}><option value="confirmed">محدد</option><option value="pending">لسه غير محدد</option></select></label>
        <label>اليوم<select name="weekday" defaultValue={session.weekday ?? ''}><option value="">غير محدد</option>{['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'].map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label>
        <label>الوقت<ArabicTimeField name="startTime" defaultValue={session.startTime ?? '16:00'} ariaLabel="وقت الحصة" /></label>
        <label>المدة بالدقائق<input name="duration" type="number" min="15" max="360" defaultValue={session.durationMinutes} /></label>
        <label>وقت الانتقال<input name="travel" type="number" min="0" max="360" defaultValue={session.travelMinutes} /></label>
        <label className="wide">المكان<input name="location" defaultValue={session.location ?? ''} /></label>
        <label>طريقة التسعير<select name="priceBasis" defaultValue={session.priceBasis}><option value="total_session">سعر الحصة بالكامل</option><option value="per_student">سعر لكل طالب</option></select></label>
        <label>السعر<input name="price" type="number" min="0" step="0.01" defaultValue={session.defaultPricePence / 100} /></label>
        <label>عدد الطلاب المتوقع<input name="studentCount" type="number" min="1" max="100" defaultValue={session.expectedStudentCount} /></label>
        <label>عمولة السنتر %<input name="centerCut" type="number" min="0" max="100" step="0.01" defaultValue={session.centerCutBps / 100} /></label>
        <fieldset className="student-picker wide"><legend>الطلاب المرتبطون بالحصة</legend>{data.simple.students.map((student) => <label key={student.id}><input type="checkbox" name="studentIds" value={student.id} defaultChecked={session.studentIds.includes(student.id)} />{student.name}</label>)}</fieldset>
        <p className="wide session-lock-note">لو للحصة تاريخ مكتمل، بيانات التسعير والطلاب تظل مقفولة لحماية الحسابات القديمة؛ اليوم والوقت والمدة والمكان يمكن تعديلهم.</p>
        <button className="save-action wide" type="submit" disabled={busy}>حفظ كل التفاصيل</button>
      </form>
    </div>
  );
}

function StudentForm({ student, busy, onSubmit }: { student: Student; busy: boolean; onSubmit: (form: FormData) => Promise<boolean> }) {
  return (
    <form className="control-edit-form" onSubmit={(event) => { event.preventDefault(); void onSubmit(new FormData(event.currentTarget)); }}>
      <label>الاسم<input name="name" defaultValue={student.name} required /></label>
      <label>العمر<input name="age" type="number" min="1" max="120" defaultValue={student.age ?? ''} /></label>
      <label>ولي الأمر<input name="guardian" defaultValue={student.guardianName ?? ''} /></label>
      <label>الهاتف<input name="phone" defaultValue={student.guardianPhone ?? ''} /></label>
      <label>المستوى<input name="level" defaultValue={student.level ?? ''} /></label>
      <label>ملاحظات<input name="notes" defaultValue={student.notes ?? ''} /></label>
      <button className="save-action wide" type="submit" disabled={busy}>حفظ البيانات</button>
    </form>
  );
}

function submitSessionEdit(
  event: FormEvent<HTMLFormElement>,
  session: RecurringSession,
  workspaceId: string,
  setEditId: (id: string | null) => void,
  act: CommonListProps['act'],
) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  void act(async () => {
    await updateLocalSessionDetails(workspaceId, session.id, {
      title: String(form.get('title') ?? ''),
      sessionType: String(form.get('sessionType') ?? 'online') as RecurringSession['sessionType'],
      scheduleStatus: String(form.get('scheduleStatus') ?? 'confirmed') as RecurringSession['scheduleStatus'],
      weekday: form.get('weekday') === '' ? null : Number(form.get('weekday')),
      startTime: String(form.get('startTime') ?? '') || null,
      durationMinutes: Number(form.get('duration') ?? 60),
      travelMinutes: Number(form.get('travel') ?? 0),
      location: String(form.get('location') ?? '') || null,
      priceBasis: String(form.get('priceBasis') ?? 'total_session') as RecurringSession['priceBasis'],
      defaultPricePence: toPenceZero(form.get('price')),
      expectedStudentCount: Number(form.get('studentCount') ?? 1),
      centerCutBps: Math.round(Number(form.get('centerCut') ?? 0) * 100),
      studentIds: form.getAll('studentIds').map(String),
      payerStudentId: session.payerStudentId,
    });
    setEditId(null);
  }, 'تم تعديل بيانات الحصة القادمة.');
}
