import { useState } from 'react';
import { buildStudentFinancialSummary } from '../../../../modules/reports/student-finance';
import type { LocalPlatformSnapshot } from '../../../adapters/indexeddb/platform.repository';
import type { ControlTab } from '../../../control/contracts';
import {
  activeCycleFor,
  baselineFor,
  completedLessonCountForStudent,
  planFor,
  sharedBillingOwnerForStudent,
  type SimpleWorkspaceData,
} from '../../data';
import { ArabicDateField, ArabicTimeField } from '../localized-fields';
import {
  formatArabicDate,
  formatClockTime,
  formatDurationArabic,
  money,
  packageProgress,
  sessionTypeLabel,
  todayIso,
  WEEKDAYS,
} from '../utils';

export function StudentHub({
  snapshot,
  data,
  studentId,
  busy,
  onBack,
  onOpenStudent,
  onStudentSave,
  onStudentArchive,
  onSessionSave,
  onBillingSave,
  onCollect,
  onOpenAdvanced,
}: {
  snapshot: LocalPlatformSnapshot;
  data: SimpleWorkspaceData;
  studentId: string;
  busy: boolean;
  onBack: () => void;
  onOpenStudent: (studentId: string) => void;
  onStudentSave: (studentId: string, form: FormData) => Promise<boolean>;
  onStudentArchive: (studentId: string) => Promise<boolean>;
  onSessionSave: (sessionId: string, form: FormData) => Promise<boolean>;
  onBillingSave: (studentId: string, form: FormData) => Promise<boolean>;
  onCollect: (studentId: string, form: FormData) => Promise<boolean>;
  onOpenAdvanced: (tab: ControlTab) => void;
}) {
  const student = data.students.find((row) => row.id === studentId) ?? null;
  const [editingDetails, setEditingDetails] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const sharedBillingOwner = student ? sharedBillingOwnerForStudent(data, student.id) : null;
  const billingStudentId = sharedBillingOwner?.id ?? student?.id ?? '';
  const plan = billingStudentId ? planFor(data, billingStudentId) : null;
  const cycle = billingStudentId ? activeCycleFor(data, billingStudentId) : null;
  const baseline = student ? baselineFor(data, student.id) : null;
  const lessonCount = student ? completedLessonCountForStudent(data, student.id) : { beforeTracking: 0, tracked: 0, total: 0 };
  const [billingMode, setBillingMode] = useState<'' | 'per_session' | 'package'>(plan?.billingMode ?? '');

  if (!student) {
    return <section className="simple-screen student-hub"><HubHeader title="الطالب غير موجود" onBack={onBack} /><div className="friendly-empty">تعذر العثور على بيانات الطالب.</div></section>;
  }

  const currency = snapshot.workspace.currencyLabel;
  const financial = buildStudentFinancialSummary(data, billingStudentId);
  const sessions = data.sessions
    .filter((session) => session.studentIds.includes(student.id))
    .sort((a, b) => (a.weekday ?? 99) - (b.weekday ?? 99) || (a.startTime ?? '99:99').localeCompare(b.startTime ?? '99:99'));
  const historicalSessions = [...data.sessions, ...(data.archivedSessions ?? [])];
  const historicalSessionIds = new Set(
    historicalSessions
      .filter((session) => session.studentIds.includes(student.id))
      .map((session) => session.id),
  );
  const history = data.occurrences
    .filter((row) => (
      row.studentIds?.includes(student.id)
      || historicalSessionIds.has(row.recurringSessionId)
    ))
    .sort((a, b) => (b.rescheduledToDate ?? b.sessionDate).localeCompare(a.rescheduledToDate ?? a.sessionDate))
    .slice(0, 12);
  const receipts = data.receipts
    .filter((row) => row.payerRefId === billingStudentId)
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || b.id.localeCompare(a.id));
  const billingHistoryExists = data.billingCycles.some((row) => row.studentId === billingStudentId);
  const packageSize = cycle?.sessionLimit ?? plan?.packageSize ?? 8;
  const packagePrice = cycle?.pricePence ?? plan?.packagePricePence ?? 0;
  const openingLocked = Boolean(cycle?.openingProgressLockedAt) || (cycle?.realCompletedCount ?? 0) > 0;

  return (
    <section className="simple-screen student-hub">
      <HubHeader title={student.name} subtitle="ملف الطالب" onBack={onBack} />

      <article className="student-hub-hero">
        <div className="student-hub-avatar">{student.name.trim().charAt(0)}</div>
        <div><strong>{student.name}</strong><span>{student.level || student.guardianName || 'بيانات الطالب'}</span></div>
        <button type="button" onClick={() => setEditingDetails((value) => !value)}>{editingDetails ? 'إغلاق' : 'تعديل'}</button>
      </article>

      <div className="student-hub-metrics">
        <Metric
          label="نظام الحساب"
          value={sharedBillingOwner
            ? `مشترك مع ${sharedBillingOwner.name}${plan?.billingMode === 'package' ? ` · باقة ${packageProgress(data, sharedBillingOwner.id)}` : ''}`
            : plan?.billingMode === 'package'
              ? `باقة ${packageProgress(data, student.id)}`
              : plan?.billingMode === 'per_session' ? 'بالحصة' : 'غير محدد'}
        />
        <Metric label="مطلوب الآن" value={money(financial.duePence, currency)} attention={financial.duePence > 0} />
        <Metric label={sharedBillingOwner ? "قبضت للحساب" : "قبضت منه"} value={money(financial.receivedPence, currency)} />
        <Metric label="رصيد مقدم" value={money(financial.creditPence, currency)} />
      </div>

      <Section title="بيانات الطالب">
        {editingDetails ? (
          <form className="student-hub-form" onSubmit={async (event) => {
            event.preventDefault();
            if (await onStudentSave(student.id, new FormData(event.currentTarget))) setEditingDetails(false);
          }}>
            <label>الاسم<input name="name" defaultValue={student.name} required /></label>
            <label>العمر<input name="age" type="number" min="1" max="120" defaultValue={student.age ?? ''} /></label>
            <label>ولي الأمر<input name="guardianName" defaultValue={student.guardianName ?? ''} /></label>
            <label>الهاتف<input name="guardianPhone" inputMode="tel" defaultValue={student.guardianPhone ?? ''} /></label>
            <label>المستوى<input name="level" defaultValue={student.level ?? ''} /></label>
            <label className="wide">ملاحظات<input name="notes" defaultValue={student.notes ?? ''} /></label>
            <button className="student-hub-save wide" type="submit" disabled={busy}>حفظ البيانات</button>
          </form>
        ) : (
          <div className="student-hub-info-list">
            <p><span>ولي الأمر</span><b>{student.guardianName || 'غير مسجل'}</b></p>
            <p><span>الهاتف</span><b>{student.guardianPhone || 'غير مسجل'}</b></p>
            <p><span>العمر</span><b>{student.age ?? 'غير مسجل'}</b></p>
            <p><span>المستوى</span><b>{student.level || 'غير مسجل'}</b></p>
            {student.notes && <p><span>ملاحظات</span><b>{student.notes}</b></p>}
            <p><span>إجمالي الحصص التي أخذها</span><b>{lessonCount.total} حصة</b></p>
            {baseline && <p><span>منها قبل بداية التتبع</span><b>{baseline.completedLessonsBeforeTracking} حصة</b></p>}
            {lessonCount.tracked > 0 && <p><span>حصص مسجلة داخل Sozan2</span><b>{lessonCount.tracked} حصة</b></p>}
          </div>
        )}
      </Section>

      <Section title="الحساب والباقة" action={billingHistoryExists ? 'التاريخ المالي محفوظ' : undefined}>
        {sharedBillingOwner ? (
          <div className="student-hub-shared-account">
            <div>
              <strong>حساب مشترك مع {sharedBillingOwner.name}</strong>
              <span>الحضور يظل منفصلًا لكل طالب، لكن الباقة والاستحقاق والتحصيل يتحسبوا مرة واحدة على الحساب المشترك.</span>
            </div>
            <button type="button" onClick={() => onOpenStudent(sharedBillingOwner.id)}>فتح الحساب المشترك</button>
          </div>
        ) : (
        <form className="student-hub-form" onSubmit={(event) => {
          event.preventDefault();
          void onBillingSave(student.id, new FormData(event.currentTarget));
        }}>
          <label>طريقة الحساب<select name="billingMode" value={billingMode} required disabled={billingHistoryExists} onChange={(event) => setBillingMode(event.currentTarget.value as '' | 'per_session' | 'package')}><option value="" disabled>اختاري نظام الحساب</option><option value="per_session">بالحصة</option><option value="package">باقة حصص</option></select></label>
          {billingHistoryExists && <input type="hidden" name="billingMode" value={plan?.billingMode ?? billingMode} />}
          {billingMode === 'package' && <>
            <label>عدد حصص الباقة<input name="packageSize" type="number" min="1" max="100" defaultValue={packageSize} /></label>
            <label>سعر الباقة<input name="packagePrice" type="number" min="0" step="0.01" defaultValue={packagePrice ? packagePrice / 100 : ''} /></label>
            <label>عدد الحصص المستخدمة من الباقة عند البداية<input name="openingCompletedCount" type="number" min="0" max={cycle?.sessionLimit ?? plan?.packageSize ?? 100} defaultValue={cycle?.openingCompletedCount ?? ''} placeholder="غير معروف" readOnly={openingLocked} /></label>
          </>}
          <input type="hidden" name="effectiveFrom" value={plan?.effectiveFrom ?? todayIso()} />
          <button className="student-hub-save wide" type="submit" disabled={busy}>حفظ نظام الحساب</button>
        </form>
        )}
        {!sharedBillingOwner && billingHistoryExists && <p className="student-hub-note">بعد وجود تاريخ مالي لا نغيّر «باقة ↔ بالحصة» حتى لا نعيد تفسير الحسابات القديمة.</p>}
      </Section>

      <Section title="المواعيد والحصص" action={`${sessions.length} ${sessions.length === 1 ? 'موعد' : 'مواعيد'}`}>
        <div className="student-hub-session-list">
          {sessions.map((session) => {
            const hasHistory = data.occurrences.some((row) => row.recurringSessionId === session.id && ['completed', 'cancelled', 'missed'].includes(row.status));
            const linkedStudents = session.studentIds
              .map((id) => data.students.find((candidate) => candidate.id === id))
              .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));
            const otherStudents = linkedStudents.filter((candidate) => candidate.id !== student.id);
            return (
              <details key={session.id} className="student-hub-session">
                <summary><span className={`session-color type-${session.sessionType}`} /><span><strong>{session.title}</strong><small>{session.scheduleStatus === 'pending' ? 'موعد غير محدد' : `${session.weekday === null ? 'اليوم غير محدد' : WEEKDAYS[session.weekday]} · ${formatClockTime(session.startTime)}`} · {sessionTypeLabel(session.sessionType)}</small></span><b>تعديل</b></summary>
                <div className="student-hub-session-body">
                  {otherStudents.length > 0 && <div className="student-hub-related-row"><span>معه في نفس الحصة</span><div className="student-context-links">{otherStudents.map((candidate) => <button type="button" key={candidate.id} onClick={() => onOpenStudent(candidate.id)}>{candidate.name}</button>)}</div></div>}
                  <form className="student-hub-form" onSubmit={async (event) => {
                    event.preventDefault();
                    const details = event.currentTarget.closest('details');
                    if (await onSessionSave(session.id, new FormData(event.currentTarget)) && details) details.open = false;
                  }}>
                    <label className="wide">اسم الحصة<input name="title" defaultValue={session.title} required /></label>
                    <label>نوع الحصة<select name="sessionType" defaultValue={session.sessionType}><option value="private_student_home">خاص عند الطالب</option><option value="private_tutor_home">خاص عند المدرس</option><option value="online">أونلاين</option><option value="center_group">السنتر</option><option value="own_group">مجموعة خاصة</option></select></label>
                    <label>حالة الموعد<select name="scheduleStatus" defaultValue={session.scheduleStatus}><option value="confirmed">موعد محدد</option><option value="pending">لسه غير محدد</option></select></label>
                    <label>اليوم<select name="weekday" defaultValue={session.weekday ?? ''}><option value="">غير محدد</option>{WEEKDAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label>
                    <label>الوقت<ArabicTimeField name="startTime" defaultValue={session.startTime ?? '16:00'} ariaLabel={`وقت ${session.title}`} /></label>
                    <label>مدة الحصة<input name="durationMinutes" type="number" min="15" max="360" defaultValue={session.durationMinutes} /></label>
                    <label>وقت الانتقال<input name="travelMinutes" type="number" min="0" max="360" defaultValue={session.travelMinutes} /></label>
                    <label className="wide">المكان<input name="location" defaultValue={session.location ?? ''} /></label>
                    <label>طريقة التسعير<select name="priceBasis" defaultValue={session.priceBasis} disabled={hasHistory}><option value="total_session">سعر الحصة بالكامل</option><option value="per_student">سعر لكل طالب</option></select></label>
                    <label>السعر<input name="price" type="number" min="0" step="0.01" defaultValue={session.defaultPricePence / 100} disabled={hasHistory} /></label>
                    <label>عدد الطلاب المتوقع<input name="expectedStudentCount" type="number" min="1" max="100" defaultValue={session.expectedStudentCount} disabled={hasHistory} /></label>
                    <label>عمولة السنتر %<input name="centerCut" type="number" min="0" max="100" step="0.01" defaultValue={session.centerCutBps / 100} disabled={hasHistory} /></label>
                    <label>المسؤول عن سعر الحصة بالكامل<select name="payerStudentId" defaultValue={session.payerStudentId ?? ''} disabled={hasHistory}><option value="">غير محدد</option>{linkedStudents.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>
                    {hasHistory && <input type="hidden" name="payerStudentId" value={session.payerStudentId ?? ''} />}
                    {!hasHistory ? <fieldset className="student-hub-related-students wide"><legend>الطلاب المرتبطون بالحصة</legend><input type="hidden" name="studentIds" value={student.id} />{data.students.filter((candidate) => candidate.id !== student.id).map((candidate) => <label key={candidate.id}><input type="checkbox" name="studentIds" value={candidate.id} defaultChecked={session.studentIds.includes(candidate.id)} />{candidate.name}</label>)}</fieldset> : <>{session.studentIds.map((id) => <input type="hidden" name="studentIds" value={id} key={id} />)}<p className="student-hub-note wide">يوجد تاريخ حضور لهذه الحصة؛ السعر وطريقة التسعير والطلاب المرتبطون مقفولين لحماية الحسابات القديمة. باقي تفاصيل المواعيد القادمة قابلة للتعديل.</p></>}
                    <div className="student-hub-session-preview wide"><span>المحجوز في الجدول الآن</span><b>{formatDurationArabic(session.durationMinutes + session.travelMinutes)}</b></div>
                    <button className="student-hub-save wide" type="submit" disabled={busy}>حفظ كل تفاصيل الحصة</button>
                  </form>
                </div>
              </details>
            );
          })}
          {!sessions.length && <div className="friendly-empty">لا توجد مواعيد مرتبطة بهذا الطالب.</div>}
        </div>
      </Section>

      <Section title="المدفوعات" action={receipts.length ? `${receipts.length} عملية` : undefined}>
        <button className="student-hub-primary-action" type="button" onClick={() => setCollecting((value) => !value)}>＋ {sharedBillingOwner ? `تسجيل تحصيل على حساب ${sharedBillingOwner.name}` : 'تسجيل تحصيل'}</button>
        {sharedBillingOwner && <p className="student-hub-note">المدفوعات هنا تخص الحساب المشترك المسجل باسم {sharedBillingOwner.name}.</p>}
        {collecting && <form className="student-hub-form" onSubmit={async (event) => { event.preventDefault(); if (await onCollect(billingStudentId, new FormData(event.currentTarget))) setCollecting(false); }}>
          <label>المبلغ<input name="amount" type="number" min="0.01" step="0.01" inputMode="decimal" required /></label>
          <label>التاريخ<ArabicDateField name="receivedAt" defaultValue={todayIso()} ariaLabel="تاريخ التحصيل" /></label>
          <label>طريقة الدفع<select name="paymentMethod" defaultValue="cash"><option value="cash">كاش</option><option value="bank">بنك</option><option value="wallet">محفظة</option><option value="other">أخرى</option></select></label>
          <label>ملاحظة<input name="note" placeholder="اختياري" /></label>
          <button className="student-hub-save wide" type="submit" disabled={busy}>حفظ التحصيل</button>
        </form>}
        <div className="student-hub-ledger">{receipts.slice(0, 10).map((receipt) => <div key={receipt.id}><span><strong>{money(receipt.amountPence, currency)}</strong><small>{formatArabicDate(receipt.receivedAt)} · {paymentMethodLabel(receipt.paymentMethod)}</small></span></div>)}{!receipts.length && <div className="friendly-empty">لا توجد مدفوعات مسجلة.</div>}</div>
        {receipts.length > 0 && <button className="student-hub-text-action" type="button" onClick={() => onOpenAdvanced('receipts')}>تصحيح أو تعديل تحصيل قديم</button>}
      </Section>

      <Section title="سجل الحضور" action={history.length ? `آخر ${history.length}` : undefined}>
        <div className="student-hub-history">{history.map((occurrence) => { const session = historicalSessions.find((row) => row.id === occurrence.recurringSessionId); return <div key={occurrence.id}><span><strong>{formatArabicDate(occurrence.rescheduledToDate ?? occurrence.sessionDate)}</strong><small>{session?.title ?? 'حصة'}{occurrence.scheduledStart ? ` · ${formatClockTime(occurrence.rescheduledToStart ?? occurrence.scheduledStart)}` : ''}</small></span><b className={`student-hub-state state-${occurrence.status}`}>{occurrence.status === 'completed' && occurrence.studentIds && !occurrence.studentIds.includes(student.id) ? 'غائب' : occurrenceStatus(occurrence.status)}</b></div>; })}{!history.length && <div className="friendly-empty">
  {lessonCount.beforeTracking > 0
    ? `لا توجد تواريخ حضور مسجلة داخل Sozan2 بعد. يوجد ${lessonCount.beforeTracking} حصة سابقة محفوظة كعدد تاريخي.`
    : 'لسه مفيش تاريخ حضور مسجل.'}
</div>}</div>
      </Section>

      <section className="student-hub-danger-zone">
        <div>
          <strong>إيقاف الطالب</strong>
          <small>للطالب الذي لن يكمل حاليًا. يحتفظ البرنامج بالحضور والباقات والمدفوعات والسجل، ويزيله من العمل والمواعيد المستقبلية.</small>
        </div>
        {!confirmArchive ? (
          <button type="button" disabled={busy} onClick={() => setConfirmArchive(true)}>إيقاف الطالب</button>
        ) : (
          <div className="student-hub-danger-confirm">
            <p>سيتم إيقاف المواعيد الفردية الخاصة بالطالب، وفصله من المواعيد المشتركة المستقبلية. لن يتم حذف أي تاريخ أو مدفوعات.</p>
            <div>
              <button type="button" disabled={busy} onClick={() => setConfirmArchive(false)}>رجوع</button>
              <button type="button" disabled={busy} onClick={() => void onStudentArchive(student.id)}>تأكيد الإيقاف</button>
            </div>
          </div>
        )}
      </section>
    </section>
  );
}

function HubHeader({ title, subtitle, onBack }: { title: string; subtitle?: string; onBack: () => void }) { return <header className="student-hub-header"><div>{subtitle && <small>{subtitle}</small>}<h1>{title}</h1></div><button type="button" onClick={onBack}>رجوع</button></header>; }
function Section({ title, action, children }: { title: string; action?: string; children: React.ReactNode }) { return <section className="student-hub-section"><div className="student-hub-section-title"><h2>{title}</h2>{action && <span>{action}</span>}</div>{children}</section>; }
function Metric({ label, value, attention = false }: { label: string; value: string; attention?: boolean }) { return <div className={attention ? 'attention' : ''}><span>{label}</span><strong>{value}</strong></div>; }
function paymentMethodLabel(method: 'cash' | 'bank' | 'wallet' | 'other'): string { return method === 'cash' ? 'كاش' : method === 'bank' ? 'بنك' : method === 'wallet' ? 'محفظة' : 'أخرى'; }
function occurrenceStatus(status: 'scheduled' | 'completed' | 'cancelled' | 'missed'): string { return status === 'completed' ? 'تمت' : status === 'cancelled' ? 'ملغاة' : status === 'missed' ? 'فائتة' : 'مجدولة'; }
