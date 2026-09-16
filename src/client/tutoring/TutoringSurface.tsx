import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { Student } from '../../modules/tutoring/domain/student';
import type { RecurringSession } from '../../modules/tutoring/domain/session';
import { SessionsService } from '../../modules/tutoring/services/sessions.service';
import { StudentsService } from '../../modules/tutoring/services/students.service';
import { IndexedDbSessionRepository } from '../adapters/indexeddb/tutoring-sessions.repository';
import { IndexedDbStudentRepository } from '../adapters/indexeddb/tutoring-students.repository';
import { pendingSyncCount } from '../sync/outbox';
import { runWorkspaceSync } from '../sync/engine';
import {
  collectLocalStudentPayment,
  configureLocalStudentBilling,
  getLocalBilling,
  listLocalStudentReceipts,
  type LocalBillingCycle,
  type LocalBillingPlan,
  type LocalReceipt,
} from './local-commands';

const studentsService = new StudentsService(new IndexedDbStudentRepository(), crypto.randomUUID);
const sessionsService = new SessionsService(new IndexedDbSessionRepository(), crypto.randomUUID);

const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function money(subunits: number, label: string): string {
  return `${(subunits / 100).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ${label}`;
}

function toSubunits(value: FormDataEntryValue | null): number {
  const number = Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(number) || number < 0) throw new Error('AMOUNT_INVALID');
  return Math.round(number * 100);
}

export function TutoringSurface({
  workspaceId,
  currencyLabel,
  cloudLinked,
}: {
  workspaceId: string;
  currencyLabel: string;
  cloudLinked: boolean;
}) {
  const [students, setStudents] = useState<Student[]>([]);
  const [sessions, setSessions] = useState<RecurringSession[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState<string>('');
  const [billing, setBilling] = useState<{ plan: LocalBillingPlan | null; cycle: LocalBillingCycle | null }>({
    plan: null,
    cycle: null,
  });
  const [receipts, setReceipts] = useState<LocalReceipt[]>([]);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const selectedStudent = useMemo(
    () => students.find((student) => student.id === selectedStudentId) ?? null,
    [students, selectedStudentId],
  );

  const refresh = async (preferredStudentId?: string) => {
    const [nextStudents, nextSessions, nextPending] = await Promise.all([
      studentsService.list(workspaceId),
      sessionsService.list(workspaceId),
      pendingSyncCount(workspaceId),
    ]);
    setStudents(nextStudents);
    setSessions(nextSessions);
    setPending(nextPending);
    const nextSelected = preferredStudentId
      ?? (selectedStudentId && nextStudents.some((student) => student.id === selectedStudentId)
        ? selectedStudentId
        : nextStudents[0]?.id ?? '');
    setSelectedStudentId(nextSelected);
    if (nextSelected) {
      const [nextBilling, nextReceipts] = await Promise.all([
        getLocalBilling(workspaceId, nextSelected),
        listLocalStudentReceipts(workspaceId, nextSelected),
      ]);
      setBilling(nextBilling);
      setReceipts(nextReceipts);
    } else {
      setBilling({ plan: null, cycle: null });
      setReceipts([]);
    }
  };

  useEffect(() => {
    void refresh();
    // workspace switch is the lifecycle boundary for this module surface.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  useEffect(() => {
    if (!selectedStudentId) return;
    void Promise.all([
      getLocalBilling(workspaceId, selectedStudentId),
      listLocalStudentReceipts(workspaceId, selectedStudentId),
    ]).then(([nextBilling, nextReceipts]) => {
      setBilling(nextBilling);
      setReceipts(nextReceipts);
    });
  }, [workspaceId, selectedStudentId]);

  const syncAfterLocalWrite = async () => {
    if (!cloudLinked || !navigator.onLine) {
      await refresh();
      return;
    }
    try {
      await runWorkspaceSync(workspaceId);
    } catch {
      // Local write is already durable; failed cloud sync remains queued.
    }
    await refresh();
  };

  const addStudent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    const form = new FormData(event.currentTarget);
    try {
      const student = await studentsService.create(workspaceId, {
        name: String(form.get('name') ?? ''),
        guardianName: String(form.get('guardianName') ?? ''),
        guardianPhone: String(form.get('guardianPhone') ?? ''),
        level: String(form.get('level') ?? ''),
        notes: String(form.get('notes') ?? ''),
      });
      event.currentTarget.reset();
      setSelectedStudentId(student.id);
      setNotice('تم حفظ الطالب محليًا.');
      await syncAfterLocalWrite();
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  };

  const addSession = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    const form = new FormData(event.currentTarget);
    try {
      const scheduleStatus = String(form.get('scheduleStatus') ?? 'confirmed') as 'confirmed' | 'pending';
      await sessionsService.create(workspaceId, {
        title: String(form.get('title') ?? ''),
        sessionType: String(form.get('sessionType') ?? 'private_student_home'),
        scheduleStatus,
        weekday: scheduleStatus === 'confirmed' ? Number(form.get('weekday')) : null,
        startTime: scheduleStatus === 'confirmed' ? String(form.get('startTime') ?? '') : null,
        durationMinutes: Number(form.get('durationMinutes') ?? 60),
        travelMinutes: Number(form.get('travelMinutes') ?? 0),
        location: String(form.get('location') ?? ''),
        priceBasis: 'total_session',
        defaultPricePence: toSubunits(form.get('price')),
        expectedStudentCount: 1,
        centerCutBps: 0,
        studentIds: form.get('studentId') ? [String(form.get('studentId'))] : [],
      });
      event.currentTarget.reset();
      setNotice('تم حفظ الموعد محليًا.');
      await syncAfterLocalWrite();
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  };

  const configureBilling = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedStudent) return;
    setBusy(true);
    setError('');
    setNotice('');
    const form = new FormData(event.currentTarget);
    try {
      const billingMode = String(form.get('billingMode') ?? 'package');
      const input = billingMode === 'package'
        ? {
            billingMode: 'package',
            packageSize: Number(form.get('packageSize') ?? 8),
            packagePricePence: toSubunits(form.get('packagePrice')),
            openingCompletedCount: Number(form.get('openingCompletedCount') ?? 0),
            effectiveFrom: String(form.get('effectiveFrom') ?? today()),
            cycleAnchorDate: null,
          }
        : {
            billingMode: 'per_session',
            effectiveFrom: String(form.get('effectiveFrom') ?? today()),
          };
      await configureLocalStudentBilling(workspaceId, selectedStudent.id, input);
      setNotice('تم حفظ نظام الحساب محليًا.');
      await syncAfterLocalWrite();
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  };

  const collectPayment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedStudent) return;
    setBusy(true);
    setError('');
    setNotice('');
    const form = new FormData(event.currentTarget);
    try {
      await collectLocalStudentPayment({
        workspaceId,
        studentId: selectedStudent.id,
        amountPence: toSubunits(form.get('amount')),
        receivedAt: String(form.get('receivedAt') ?? today()),
        paymentMethod: String(form.get('paymentMethod') ?? 'cash') as 'cash' | 'bank' | 'wallet' | 'other',
        note: String(form.get('note') ?? ''),
      });
      event.currentTarget.reset();
      setNotice('تم تسجيل التحصيل محليًا.');
      await syncAfterLocalWrite();
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="tutoring-surface" dir="rtl">
      <div className="surface-title-row">
        <div>
          <p className="eyebrow">Tutoring module</p>
          <h2>التدريس</h2>
          <p className="surface-note">البيانات تُكتب محليًا أولًا، ثم تُزامن عند توفر الحساب والإنترنت.</p>
        </div>
        <span className={`sync-pill ${pending ? 'pending' : ''}`}>
          {pending ? `${pending} تغيير بانتظار المزامنة` : 'محلي محفوظ'}
        </span>
      </div>

      {error && <div className="status bad">{error}</div>}
      {notice && <div className="status good">{notice}</div>}

      <div className="tutoring-grid">
        <section className="panel tutoring-panel">
          <div className="section-heading compact-heading">
            <div><p className="eyebrow">Students</p><h3>الطلاب</h3></div>
            <span>{students.length}</span>
          </div>
          <form className="compact-form" onSubmit={addStudent}>
            <input name="name" placeholder="اسم الطالب" required />
            <input name="guardianName" placeholder="ولي الأمر" />
            <input name="guardianPhone" placeholder="الهاتف" inputMode="tel" />
            <input name="level" placeholder="المستوى" />
            <textarea name="notes" placeholder="ملاحظات" rows={2} />
            <button className="primary-button" type="submit" disabled={busy}>إضافة طالب</button>
          </form>
          <div className="student-list">
            {students.map((student) => (
              <button
                type="button"
                key={student.id}
                className={`student-row ${student.id === selectedStudentId ? 'selected' : ''}`}
                onClick={() => setSelectedStudentId(student.id)}
              >
                <strong>{student.name}</strong>
                <small>{student.level || student.guardianName || 'بدون تفاصيل إضافية'}</small>
              </button>
            ))}
            {!students.length && <div className="empty-state">أضف أول طالب للبدء.</div>}
          </div>
        </section>

        <section className="panel tutoring-panel">
          <div className="section-heading compact-heading">
            <div><p className="eyebrow">Student account</p><h3>{selectedStudent?.name ?? 'اختر طالبًا'}</h3></div>
          </div>
          {selectedStudent ? (
            <>
              <div className="billing-summary">
                <span>النظام</span>
                <strong>{billing.plan?.billingMode === 'package' ? 'باقة' : billing.plan ? 'بالحصة' : 'غير محدد'}</strong>
                {billing.cycle && (
                  <small>
                    تقدم الباقة: {billing.cycle.openingCompletedCount + billing.cycle.realCompletedCount}/{billing.cycle.sessionLimit}
                    {' · '}{money(billing.cycle.pricePence, currencyLabel)}
                  </small>
                )}
              </div>
              <form className="compact-form" onSubmit={configureBilling}>
                <select name="billingMode" defaultValue={billing.plan?.billingMode ?? 'package'}>
                  <option value="package">باقة</option>
                  <option value="per_session">بالحصة</option>
                </select>
                <div className="form-row three">
                  <input name="packageSize" type="number" min="1" max="100" defaultValue={billing.plan?.packageSize ?? 8} placeholder="عدد الحصص" />
                  <input name="packagePrice" type="number" min="0" step="0.01" defaultValue={billing.plan?.packagePricePence ? billing.plan.packagePricePence / 100 : ''} placeholder="سعر الباقة" />
                  <input name="openingCompletedCount" type="number" min="0" max="100" defaultValue={billing.cycle?.openingCompletedCount ?? 0} placeholder="بدأ من" />
                </div>
                <input name="effectiveFrom" type="date" defaultValue={billing.plan?.effectiveFrom ?? today()} />
                <button className="secondary-button" type="submit" disabled={busy}>حفظ نظام الحساب</button>
              </form>

              <div className="panel-separator" />
              <form className="compact-form" onSubmit={collectPayment}>
                <div className="form-row three">
                  <input name="amount" type="number" min="0.01" step="0.01" placeholder="المبلغ" required />
                  <input name="receivedAt" type="date" defaultValue={today()} required />
                  <select name="paymentMethod" defaultValue="cash">
                    <option value="cash">كاش</option>
                    <option value="bank">بنك</option>
                    <option value="wallet">محفظة</option>
                    <option value="other">أخرى</option>
                  </select>
                </div>
                <input name="note" placeholder="ملاحظة اختيارية" />
                <button className="primary-button" type="submit" disabled={busy}>قبضت فلوس</button>
              </form>
              <div className="receipt-list">
                {receipts.slice(0, 5).map((receipt) => (
                  <div className="receipt-row" key={receipt.id}>
                    <div><strong>{money(receipt.amountPence, currencyLabel)}</strong><small>{receipt.receivedAt}</small></div>
                    {receipt.pendingSync && <span>بانتظار المزامنة</span>}
                  </div>
                ))}
              </div>
            </>
          ) : <div className="empty-state">اختر طالبًا لإدارة الباقة والتحصيل.</div>}
        </section>
      </div>

      <section className="panel tutoring-panel schedule-panel">
        <div className="section-heading compact-heading">
          <div><p className="eyebrow">Planner provider</p><h3>الجدول المتكرر</h3></div>
          <span>{sessions.length}</span>
        </div>
        <form className="schedule-form" onSubmit={addSession}>
          <input name="title" placeholder="اسم الحصة / المجموعة" required />
          <select name="studentId" defaultValue="">
            <option value="">بدون طالب محدد</option>
            {students.map((student) => <option key={student.id} value={student.id}>{student.name}</option>)}
          </select>
          <select name="sessionType" defaultValue="private_student_home">
            <option value="private_student_home">برايفت عند الطالب</option>
            <option value="private_tutor_home">برايفت عند المدرس</option>
            <option value="online">أونلاين</option>
            <option value="center_group">مجموعة سنتر</option>
            <option value="own_group">مجموعة خاصة</option>
          </select>
          <select name="scheduleStatus" defaultValue="confirmed">
            <option value="confirmed">موعد مؤكد</option>
            <option value="pending">هظبطه بعدين</option>
          </select>
          <select name="weekday" defaultValue="0">
            {WEEKDAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}
          </select>
          <input name="startTime" type="time" defaultValue="16:00" />
          <input name="durationMinutes" type="number" min="15" max="360" defaultValue="60" placeholder="المدة" />
          <input name="travelMinutes" type="number" min="0" max="360" defaultValue="0" placeholder="الانتقال" />
          <input name="price" type="number" min="0" step="0.01" placeholder="السعر" />
          <input name="location" placeholder="المكان" />
          <button className="primary-button" type="submit" disabled={busy}>إضافة للجدول</button>
        </form>
        <div className="session-list">
          {sessions.map((session) => (
            <article className="session-row" key={session.id}>
              <div>
                <strong>{session.title}</strong>
                <small>
                  {session.scheduleStatus === 'pending'
                    ? 'موعد يحتاج ترتيب'
                    : `${WEEKDAYS[session.weekday ?? 0]} · ${session.startTime}`}
                </small>
              </div>
              <span>{money(session.defaultPricePence, currencyLabel)}</span>
            </article>
          ))}
          {!sessions.length && <div className="empty-state">لا توجد حصص متكررة بعد.</div>}
        </div>
      </section>
    </section>
  );
}

function messageFor(cause: unknown): string {
  const code = cause instanceof Error ? cause.message : 'UNKNOWN';
  const messages: Record<string, string> = {
    BILLING_MODE_LOCKED_BY_HISTORY: 'لا يمكن تغيير نوع الحساب بعد وجود تاريخ مالي لهذه الحالة.',
    COLLECTION_AMOUNT_INVALID: 'أدخل مبلغًا صحيحًا أكبر من صفر.',
    AMOUNT_INVALID: 'أدخل قيمة مالية صحيحة.',
    SESSION_NOT_FOUND: 'الحصة غير موجودة.',
  };
  return messages[code] ?? `تعذر تنفيذ العملية (${code})`;
}
