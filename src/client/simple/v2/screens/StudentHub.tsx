import { useState } from 'react';
import { buildStudentFinancialSummary } from '../../../../modules/reports/student-finance';
import type { LocalPlatformSnapshot } from '../../../adapters/indexeddb/platform.repository';
import type { ControlTab } from '../../../control/contracts';
import { activeCycleFor, planFor, type SimpleWorkspaceData } from '../../data';
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
  onStudentSave,
  onSessionSave,
  onBillingSave,
  onCollect,
  onOpenAdvanced,
  onOpenStudent,
  onLinkSibling,
  onUnlinkFamily,
  onArchive,
}: {
  snapshot: LocalPlatformSnapshot;
  data: SimpleWorkspaceData;
  studentId: string;
  busy: boolean;
  onBack: () => void;
  onStudentSave: (studentId: string, form: FormData) => Promise<boolean>;
  onSessionSave: (sessionId: string, form: FormData) => Promise<boolean>;
  onBillingSave: (studentId: string, form: FormData) => Promise<boolean>;
  onCollect: (studentId: string, form: FormData) => Promise<boolean>;
  onOpenAdvanced: (tab: ControlTab) => void;
  onOpenStudent: (studentId: string) => void;
  onLinkSibling: (studentId: string, siblingId: string) => Promise<boolean>;
  onUnlinkFamily: (studentId: string) => Promise<boolean>;
  onArchive: (studentId: string) => Promise<boolean>;
}) {
  const student = data.students.find((row) => row.id === studentId) ?? null;
  const [editingDetails, setEditingDetails] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const plan = student ? planFor(data, student.id) : null;
  const cycle = student ? activeCycleFor(data, student.id) : null;
  const [billingMode, setBillingMode] = useState<'per_session' | 'package'>(plan?.billingMode ?? 'per_session');

  if (!student) {
    return (
      <section className="simple-screen student-hub">
        <StudentHubHeader title="الطالب غير موجود" onBack={onBack} />
        <div className="friendly-empty">تعذر العثور على بيانات الطالب.</div>
      </section>
    );
  }

  const currency = snapshot.workspace.currencyLabel;
  const financial = buildStudentFinancialSummary(data, student.id);
  const sessions = data.sessions
    .filter((session) => session.studentIds.includes(student.id))
    .sort((a, b) => (a.weekday ?? 99) - (b.weekday ?? 99) || (a.startTime ?? '99:99').localeCompare(b.startTime ?? '99:99'));
  const sessionIds = new Set(sessions.map((session) => session.id));
  const history = data.occurrences
    .filter((row) => sessionIds.has(row.recurringSessionId))
    .sort((a, b) => (b.rescheduledToDate ?? b.sessionDate).localeCompare(a.rescheduledToDate ?? a.sessionDate))
    .slice(0, 12);
  const receipts = data.receipts
    .filter((row) => row.payerRefId === student.id)
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || b.id.localeCompare(a.id));
  const billingHistoryExists = data.billingCycles.some((row) => row.studentId === student.id);
  const packageSize = cycle?.sessionLimit ?? plan?.packageSize ?? 8;
  const packagePrice = cycle?.pricePence ?? plan?.packagePricePence ?? 0;
  const openingLocked = Boolean(cycle?.openingProgressLockedAt) || (cycle?.realCompletedCount ?? 0) > 0;
  const siblings = student.familyId
    ? data.students.filter((row) => row.id !== student.id && row.familyId === student.familyId)
    : [];
  const familyOptions = data.students.filter((row) => row.id !== student.id && !siblings.some((sibling) => sibling.id === row.id));

  return (
    <section className="simple-screen student-hub">
      <StudentHubHeader title={student.name} subtitle="ملف الطالب" onBack={onBack} />

      <article className="student-hub-hero">
        <div className="student-hub-avatar">{student.name.trim().charAt(0)}</div>
        <div>
          <strong>{student.name}</strong>
          <span>{student.level || student.guardianName || 'بيانات الطالب'}</span>
        </div>
        <button type="button" onClick={() => setEditingDetails((value) => !value)}>{editingDetails ? 'إغلاق' : 'تعديل'}</button>
      </article>

      <div className="student-hub-metrics">
        <HubMetric label="نظام الحساب" value={plan?.billingMode === 'package' ? `باقة ${packageProgress(data, student.id)}` : 'بالحصة'} />
        <HubMetric label="مطلوب الآن" value={money(financial.duePence, currency)} attention={financial.duePence > 0} />
        <HubMetric label="قبضت منه" value={money(financial.receivedPence, currency)} />
        <HubMetric label="رصيد مقدم" value={money(financial.creditPence, currency)} />
      </div>

      <HubSection title="بيانات الطالب" action={!editingDetails ? undefined : 'تعديل مفتوح'}>
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
            <p><span>العمر</span><b>{student.age ? `${student.age}` : 'غير مسجل'}</b></p>
            <p><span>المستوى</span><b>{student.level || 'غير مسجل'}</b></p>
            {student.notes && <p><span>ملاحظات</span><b>{student.notes}</b></p>}
          </div>
        )}
      </HubSection>

      <HubSection title="الإخوة" action={siblings.length ? `${siblings.length} مرتبط` : 'اختياري'}>
        <p className="student-hub-note">الرابط هنا للتنقل فقط. كل أخ أو أخت يظل له ملف وحصص وباقة وفلوس مستقلة.</p>
        {siblings.length > 0 && (
          <div className="student-family-links">
            {siblings.map((sibling) => (
              <button type="button" key={sibling.id} onClick={() => onOpenStudent(sibling.id)}>
                <span>{sibling.name.trim().charAt(0)}</span><strong>{sibling.name}</strong><b>فتح</b>
              </button>
            ))}
          </div>
        )}
        {familyOptions.length > 0 && (
          <form className="student-family-form" onSubmit={async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const siblingId = String(form.get('siblingId') ?? '');
            if (siblingId) await onLinkSibling(student.id, siblingId);
          }}>
            <select name="siblingId" defaultValue="" required>
              <option value="" disabled>ربط بأخ / أخت…</option>
              {familyOptions.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
            </select>
            <button type="submit" disabled={busy}>ربط</button>
          </form>
        )}
        {student.familyId && <button className="student-hub-text-action" type="button" disabled={busy} onClick={() => void onUnlinkFamily(student.id)}>فصل هذا الطالب عن رابط الإخوة</button>}
      </HubSection>

      <HubSection title="الحساب والباقة" action={billingHistoryExists ? 'التاريخ المالي محفوظ' : undefined}>
        <form className="student-hub-form" onSubmit={(event) => {
          event.preventDefault();
          void onBillingSave(student.id, new FormData(event.currentTarget));
        }}>
          <label>طريقة الحساب
            <select name="billingMode" value={billingMode} disabled={billingHistoryExists} onChange={(event) => setBillingMode(event.currentTarget.value as 'per_session' | 'package')}>
              <option value="per_session">بالحصة</option>
              <option value="package">باقة حصص</option>
            </select>
          </label>
          {billingHistoryExists && <input type="hidden" name="billingMode" value={plan?.billingMode ?? billingMode} />}
          {billingMode === 'package' && (
            <>
              <label>عدد حصص الباقة<input name="packageSize" type="number" min="1" max="100" defaultValue={packageSize} /></label>
              <label>سعر الباقة<input name="packagePrice" type="number" min="0" step="0.01" defaultValue={packagePrice ? packagePrice / 100 : ''} /></label>
              <label>التقدم عند البداية<input name="openingCompletedCount" type="number" min="0" max={cycle?.sessionLimit ?? 100} defaultValue={cycle?.openingCompletedCount ?? 0} readOnly={openingLocked} /></label>
            </>
          )}
          <input type="hidden" name="effectiveFrom" value={plan?.effectiveFrom ?? todayIso()} />
          <button className="student-hub-save wide" type="submit" disabled={busy}>حفظ نظام الحساب</button>
        </form>
        {billingHistoryExists && <p className="student-hub-note">بعد وجود تاريخ مالي لا نغيّر «باقة ↔ بالحصة» حتى لا نعيد تفسير الحسابات القديمة، لكن تفاصيل الباقة الحالية تظل قابلة للتعديل في الحدود الآمنة.</p>}
      </HubSection>

      <HubSection title="المواعيد والحصص" action={`${sessions.length} ${sessions.length === 1 ? 'موعد' : 'مواعيد'}`}>
        <div className="student-hub-session-list">
          {sessions.map((session) => (
            <details key={session.id} className="student-hub-session">
              <summary>
                <span className={`session-color type-${session.sessionType}`} />
                <span><strong>{session.title}</strong><small>{session.scheduleStatus === 'pending' ? 'موعد غير محدد' : `${session.weekday === null ? 'اليوم غير محدد' : WEEKDAYS[session.weekday]} · ${formatClockTime(session.startTime)}`} · {sessionTypeLabel(session.sessionType)}</small></span>
                <b>تعديل</b>
              </summary>
              <form className="student-hub-form" onSubmit={async (event) => {
                event.preventDefault();
                const element = event.currentTarget.closest('details');
                if (await onSessionSave(session.id, new FormData(event.currentTarget)) && element) element.open = false;
              }}>
                <label>نوع الحصة<select name="sessionType" defaultValue={session.sessionType}><option value="private_student_home">خاص عند الطالب</option><option value="private_tutor_home">خاص عند المدرس</option><option value="online">أونلاين</option><option value="center_group">السنتر</option><option value="own_group">مجموعة خاصة</option></select></label>
                <label>حالة الموعد<select name="scheduleStatus" defaultValue={session.scheduleStatus}><option value="confirmed">موعد محدد</option><option value="pending">لسه غير محدد</option></select></label>
                <label>اليوم<select name="weekday" defaultValue={session.weekday ?? ''}><option value="">غير محدد</option>{WEEKDAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label>
                <label>الوقت<ArabicTimeField name="startTime" defaultValue={session.startTime ?? '16:00'} ariaLabel={`وقت ${session.title}`} /></label>
                <label>مدة الحصة<input name="durationMinutes" type="number" min="15" max="360" defaultValue={session.durationMinutes} /></label>
                <label>وقت الانتقال<input name="travelMinutes" type="number" min="0" max="360" defaultValue={session.travelMinutes} /></label>
                <label className="wide">المكان<input name="location" defaultValue={session.location ?? ''} /></label>
                <div className="student-hub-session-preview wide"><span>المحجوز في الجدول</span><b>{formatDurationArabic(session.durationMinutes + session.travelMinutes)}</b></div>
                <button className="student-hub-save wide" type="submit" disabled={busy}>حفظ الموعد</button>
              </form>
            </details>
          ))}
          {!sessions.length && <div className="friendly-empty">لا توجد مواعيد مرتبطة بهذا الطالب.</div>}
        </div>
      </HubSection>

      <HubSection title="المدفوعات" action={receipts.length ? `${receipts.length} عملية` : undefined}>
        <button className="student-hub-primary-action" type="button" onClick={() => setCollecting((value) => !value)}>＋ تسجيل تحصيل</button>
        {collecting && (
          <form className="student-hub-form student-hub-collect" onSubmit={async (event) => {
            event.preventDefault();
            if (await onCollect(student.id, new FormData(event.currentTarget))) setCollecting(false);
          }}>
            <label>المبلغ<input name="amount" type="number" min="0.01" step="0.01" inputMode="decimal" required /></label>
            <label>التاريخ<ArabicDateField name="receivedAt" defaultValue={todayIso()} ariaLabel="تاريخ التحصيل" /></label>
            <label>طريقة الدفع<select name="paymentMethod" defaultValue="cash"><option value="cash">كاش</option><option value="bank">بنك</option><option value="wallet">محفظة</option><option value="other">أخرى</option></select></label>
            <label>ملاحظة<input name="note" placeholder="اختياري" /></label>
            <button className="student-hub-save wide" type="submit" disabled={busy}>حفظ التحصيل</button>
          </form>
        )}
        <div className="student-hub-ledger">
          {receipts.slice(0, 10).map((receipt) => <div key={receipt.id}><span><strong>{money(receipt.amountPence, currency)}</strong><small>{formatArabicDate(receipt.receivedAt)} · {paymentMethodLabel(receipt.paymentMethod)}</small></span></div>)}
          {!receipts.length && <div className="friendly-empty">لا توجد مدفوعات مسجلة.</div>}
        </div>
        {receipts.length > 0 && <button className="student-hub-text-action" type="button" onClick={() => onOpenAdvanced('receipts')}>تصحيح أو تعديل تحصيل قديم</button>}
      </HubSection>

      <HubSection title="سجل الحضور" action={history.length ? `آخر ${history.length}` : undefined}>
        <div className="student-hub-history">
          {history.map((occurrence) => {
            const session = data.sessions.find((row) => row.id === occurrence.recurringSessionId);
            return (
              <div key={occurrence.id}>
                <span><strong>{formatArabicDate(occurrence.rescheduledToDate ?? occurrence.sessionDate)}</strong><small>{session?.title ?? 'حصة'}{occurrence.scheduledStart ? ` · ${formatClockTime(occurrence.rescheduledToStart ?? occurrence.scheduledStart)}` : ''}</small></span>
                <b className={`student-hub-state state-${occurrence.status}`}>{occurrenceStatus(occurrence.status)}</b>
              </div>
            );
          })}
          {!history.length && <div className="friendly-empty">لسه مفيش تاريخ حضور مسجل.</div>}
        </div>
      </HubSection>

      <HubSection title="إدارة الملف">
        <div className="student-hub-archive">
          <div><strong>إيقاف الطالب</strong><small>يختفي من قائمة الطلاب والمواعيد القادمة، لكن الحضور والمدفوعات والتاريخ يفضلوا محفوظين.</small></div>
          {!confirmArchive ? (
            <button type="button" disabled={busy} onClick={() => setConfirmArchive(true)}>إيقاف</button>
          ) : (
            <div className="student-hub-confirm-actions">
              <button type="button" onClick={() => setConfirmArchive(false)}>رجوع</button>
              <button className="danger" type="button" disabled={busy} onClick={() => void onArchive(student.id)}>تأكيد الإيقاف</button>
            </div>
          )}
        </div>
      </HubSection>
    </section>
  );
}

function StudentHubHeader({ title, subtitle, onBack }: { title: string; subtitle?: string; onBack: () => void }) {
  return <header className="student-hub-header"><div>{subtitle && <small>{subtitle}</small>}<h1>{title}</h1></div><button type="button" onClick={onBack}>رجوع</button></header>;
}

function HubSection({ title, action, children }: { title: string; action?: string; children: React.ReactNode }) {
  return <section className="student-hub-section"><div className="student-hub-section-title"><h2>{title}</h2>{action && <span>{action}</span>}</div>{children}</section>;
}

function HubMetric({ label, value, attention = false }: { label: string; value: string; attention?: boolean }) {
  return <div className={attention ? 'attention' : ''}><span>{label}</span><strong>{value}</strong></div>;
}

function paymentMethodLabel(method: 'cash' | 'bank' | 'wallet' | 'other'): string {
  if (method === 'cash') return 'كاش';
  if (method === 'bank') return 'بنك';
  if (method === 'wallet') return 'محفظة';
  return 'أخرى';
}

function occurrenceStatus(status: 'scheduled' | 'completed' | 'cancelled' | 'missed'): string {
  if (status === 'completed') return 'تمت';
  if (status === 'cancelled') return 'ملغاة';
  if (status === 'missed') return 'فائتة';
  return 'مجدولة';
}
