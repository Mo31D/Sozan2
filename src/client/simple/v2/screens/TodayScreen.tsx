import { useState } from 'react';
import type { RecurringSession } from '../../../../modules/tutoring/domain/session';
import type { LocalPlatformSnapshot } from '../../../adapters/indexeddb/platform.repository';
import type { AttendanceWorkflowAction } from '../../../tutoring/attendance-workflow';
import {
  activeCycleFor,
  planFor,
  studentForSession,
  type SimpleWorkspaceData,
} from '../../data';
import { ScreenHeader, SectionTitle } from '../components';
import { ArabicDateField, ArabicTimeField } from '../localized-fields';
import {
  dueTotal,
  formatArabicDate,
  formatClockTime,
  greetingForHour,
  money,
  packageProgress,
  scheduleEntriesForDate,
  sessionTypeLabel,
  sum,
  todayIso,
  toPence,
} from '../utils';
import type { ScheduledEntry } from '../types';

export function TodayScreen({
  snapshot,
  data,
  date,
  busy,
  openedFromSchedule,
  onOpenMoney,
  onAttendance,
  onBackToToday,
  onBackToSchedule,
}: {
  snapshot: LocalPlatformSnapshot;
  data: SimpleWorkspaceData;
  date: string;
  busy: boolean;
  openedFromSchedule: boolean;
  onOpenMoney: (mode: 'receipt' | 'expense') => void;
  onAttendance: (action: AttendanceWorkflowAction, success: string) => Promise<boolean>;
  onBackToToday: () => void;
  onBackToSchedule: () => void;
}) {
  const actualToday = todayIso();
  const isToday = date === actualToday;
  const month = date.slice(0, 7);
  const entries = scheduleEntriesForDate(data, date);
  const monthReceipts = sum(data.receipts.filter((row) => row.receivedAt.startsWith(month)).map((row) => row.amountPence));
  const monthOther = sum(data.otherIncome.filter((row) => row.incomeDate.startsWith(month)).map((row) => row.amountPence));
  const monthExpenses = sum(data.expenses.filter((row) => row.expenseDate.startsWith(month)).map((row) => row.amountPence));
  const net = monthReceipts + monthOther - monthExpenses;
  const due = dueTotal(data);

  return (
    <section className="simple-screen">
      <ScreenHeader kicker={isToday ? 'مساعد سوزان' : 'جدولي'} title={isToday ? 'اليوم' : 'يوم محدد'} />

      {isToday ? (
        <>
          <article className="today-hero">
            <div className="today-hero-top">
              <div>
                <strong>{greetingForHour(new Date().getHours())} يا {snapshot.user.displayName}</strong>
                <span>{formatArabicDate(date)}</span>
                <small>المتبقي من اللي قبضتيه هذا الشهر</small>
              </div>
              <span className="spark">✦</span>
            </div>
            <div className="hero-money">{money(net, snapshot.workspace.currencyLabel)}</div>
            <div className="hero-split">
              <div><span>قبضتي</span><strong>{money(monthReceipts + monthOther, snapshot.workspace.currencyLabel)}</strong></div>
              <div><span>صرفتي</span><strong>{money(monthExpenses, snapshot.workspace.currencyLabel)}</strong></div>
            </div>
          </article>

          <div className="quick-actions">
            <button type="button" onClick={() => onOpenMoney('receipt')}><b>＋</b><span><strong>قبضت فلوس</strong><small>من طالب أو ولي أمر</small></span></button>
            <button type="button" onClick={() => onOpenMoney('expense')}><b>−</b><span><strong>مصروف</strong><small>شخصي أو شغل</small></span></button>
          </div>

          <article className="due-card">
            <div><span>جاهز للتحصيل</span><strong>{money(due, snapshot.workspace.currencyLabel)}</strong></div>
            <span className="due-status">{due > 0 ? 'مراجعة' : 'تمام'}</span>
          </article>
        </>
      ) : (
        <article className="opened-day-card">
          <div><small>اليوم المفتوح من التقويم</small><strong>{formatArabicDate(date)}</strong></div>
          <button type="button" onClick={openedFromSchedule ? onBackToSchedule : onBackToToday}>
            {openedFromSchedule ? 'الرجوع للشهر' : 'الرجوع لليوم'}
          </button>
        </article>
      )}

      <SectionTitle eyebrow={isToday ? 'اليوم' : formatArabicDate(date)} title="حصصك" />
      <div className="lesson-list">
        {entries.map((entry) => (
          <AttendanceCard
            key={entry.occurrence?.id ?? `${entry.session.id}-${entry.date}-recurring`}
            entry={entry}
            data={data}
            busy={busy}
            currency={snapshot.workspace.currencyLabel}
            onAttendance={onAttendance}
          />
        ))}
        {!entries.length && <div className="friendly-empty">مفيش حصص مؤكدة في اليوم ده.</div>}
      </div>
    </section>
  );
}

function AttendanceCard({
  entry,
  data,
  busy,
  currency,
  onAttendance,
}: {
  entry: ScheduledEntry;
  data: SimpleWorkspaceData;
  busy: boolean;
  currency: string;
  onAttendance: (action: AttendanceWorkflowAction, success: string) => Promise<boolean>;
}) {
  const [collecting, setCollecting] = useState(false);
  const [moving, setMoving] = useState(false);
  const { session, occurrence } = entry;
  const primaryStudent = studentForSession(data, session);
  const plan = primaryStudent ? planFor(data, primaryStudent.id) : null;
  const done = occurrence?.status === 'completed';
  const cancelled = occurrence?.status === 'cancelled';
  const missed = occurrence?.status === 'missed';
  const future = entry.date > todayIso();
  const statusClass = done ? 'done' : cancelled ? 'cancelled' : missed ? 'missed' : '';
  const linkedStudents = session.studentIds
    .map((id) => data.students.find((student) => student.id === id))
    .filter((student): student is NonNullable<typeof student> => Boolean(student));
  const paymentStudents = linkedStudents.length ? linkedStudents : data.students;
  const defaultStudent = paymentStudents[0] ?? null;
  const suggested = defaultStudent ? suggestedCollectionPence(data, session, defaultStudent.id) : 0;

  const perform = async (action: AttendanceWorkflowAction, success: string) => {
    const ok = await onAttendance(action, success);
    if (ok) {
      setCollecting(false);
      setMoving(false);
    }
    return ok;
  };

  return (
    <article className={`lesson-card ${statusClass}`}>
      <div className="lesson-main">
        <div>
          <strong>{session.title}</strong>
          <small>{entry.startTime ? formatClockTime(entry.startTime) : 'الوقت غير محدد'} · {sessionTypeLabel(session.sessionType)}</small>
          {plan?.billingMode === 'package' && <small>باقة · {packageProgress(data, primaryStudent?.id ?? '')}</small>}
          {future && !done && <small className="lesson-state-note">حصة مستقبلية — يمكن نقلها أو إلغاؤها، والحضور يتسجل في يومها.</small>}
          {cancelled && <small className="lesson-state-note">ملغاة — محفوظة في السجل ويمكن استرجاعها</small>}
          {missed && <small className="lesson-state-note">فائتة — يمكنك استرجاعها أو نقلها</small>}
        </div>
        {plan?.billingMode === 'package' && <span className="progress-chip">{packageProgress(data, primaryStudent?.id ?? '')}</span>}
      </div>

      {!done && !cancelled && !missed && (
        <>
          <div className="lesson-actions">
            <button className="lesson-done-button" type="button" disabled={busy || future} onClick={() => void perform({ kind: 'complete', session, displayedDate: entry.date, occurrenceId: occurrence?.id }, 'تم تسجيل الحصة.')}>تمت</button>
            <button className="lesson-pay-button" type="button" disabled={busy || future || !paymentStudents.length} onClick={() => setCollecting((value) => !value)}>تمت + قبض</button>
          </div>
          <div className="lesson-secondary-actions">
            <button type="button" disabled={busy} onClick={() => void perform({ kind: 'cancel', session, displayedDate: entry.date, occurrenceId: occurrence?.id }, 'تم إلغاء الحصة ويمكن استرجاعها من السجل.')}>إلغاء</button>
            <button type="button" disabled={busy} onClick={() => setMoving((value) => !value)}>نقل</button>
          </div>
        </>
      )}

      {done && (
        <div className="lesson-actions completed-actions">
          <button className="lesson-done-button" type="button" disabled>تمت ✓</button>
          <button className="lesson-pay-button" type="button" disabled={busy || !paymentStudents.length} onClick={() => setCollecting((value) => !value)}>سجّلي التحصيل</button>
          {occurrence && <button className="lesson-reopen-button" type="button" disabled={busy} onClick={() => void perform({ kind: 'reopen', occurrenceId: occurrence.id }, 'تم إرجاع الحصة لمجدولة وإعادة حساب الباقة والمستحقات.')}>إعادة فتح</button>}
        </div>
      )}

      {(cancelled || missed) && (
        <div className="lesson-actions">
          <button className="lesson-restore-button" type="button" disabled={busy} onClick={() => void perform({ kind: 'restore', session, displayedDate: entry.date, occurrenceId: occurrence?.id }, 'تم استرجاع الحصة.')}>استرجاع</button>
          <button className="lesson-pay-button" type="button" disabled={busy} onClick={() => setMoving((value) => !value)}>نقل لموعد آخر</button>
        </div>
      )}

      {collecting && defaultStudent && (
        <form className="lesson-inline-form" onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void perform({
            kind: 'complete-and-collect',
            session,
            displayedDate: entry.date,
            occurrenceId: occurrence?.id,
            studentId: String(form.get('studentId') ?? defaultStudent.id),
            amountPence: toPence(form.get('amount')),
            paymentMethod: String(form.get('paymentMethod') ?? 'cash') as 'cash' | 'bank' | 'wallet' | 'other',
            note: String(form.get('note') ?? ''),
          }, done ? 'تم تسجيل التحصيل وربطه بالطالب.' : 'تم تسجيل الحصة والتحصيل وربطهما بالطالب.');
        }}>
          <strong>{done ? 'تحصيل للحصة' : 'الحصة تمت وتم القبض'}</strong>
          <select name="studentId" defaultValue={defaultStudent.id}>{paymentStudents.map((student) => <option key={student.id} value={student.id}>{student.name}</option>)}</select>
          <input name="amount" type="number" min="0.01" step="0.01" inputMode="decimal" defaultValue={suggested > 0 ? suggested / 100 : undefined} placeholder={`المبلغ ${currency}`} required />
          <select name="paymentMethod" defaultValue="cash"><option value="cash">كاش</option><option value="bank">بنك</option><option value="wallet">محفظة</option><option value="other">أخرى</option></select>
          <input name="note" placeholder="ملاحظة اختيارية" />
          <div className="inline-form-actions"><button type="button" onClick={() => setCollecting(false)}>إلغاء</button><button type="submit" disabled={busy}>حفظ</button></div>
        </form>
      )}

      {moving && (
        <form className="lesson-inline-form" onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void perform({
            kind: 'reschedule',
            session,
            displayedDate: entry.date,
            occurrenceId: occurrence?.id,
            targetDate: String(form.get('date') ?? entry.date),
            targetStart: String(form.get('startTime') ?? '') || null,
            note: String(form.get('note') ?? ''),
          }, 'تم نقل الحصة مع الاحتفاظ بتاريخها الأصلي.');
        }}>
          <strong>نقل هذه الحصة فقط</strong>
          <ArabicDateField name="date" defaultValue={entry.date} ariaLabel="تاريخ الحصة الجديد" />
          <ArabicTimeField name="startTime" defaultValue={entry.startTime ?? '09:00'} ariaLabel="وقت الحصة الجديد" />
          <input name="note" placeholder="سبب أو ملاحظة اختيارية" />
          <div className="inline-form-actions"><button type="button" onClick={() => setMoving(false)}>إلغاء</button><button type="submit" disabled={busy}>نقل الحصة</button></div>
        </form>
      )}
    </article>
  );
}

function suggestedCollectionPence(data: SimpleWorkspaceData, session: RecurringSession, studentId: string): number {
  const plan = planFor(data, studentId);
  const cycle = activeCycleFor(data, studentId);
  if (plan?.billingMode === 'package') return cycle?.pricePence ?? plan.packagePricePence ?? 0;
  if (session.priceBasis === 'per_student' || session.studentIds.length <= 1) return session.defaultPricePence;
  return 0;
}
