import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { RecurringSession } from '../../modules/tutoring/domain/session';
import { SessionsService } from '../../modules/tutoring/services/sessions.service';
import { StudentsService } from '../../modules/tutoring/services/students.service';
import type { LocalPlatformSnapshot } from '../adapters/indexeddb/platform.repository';
import { IndexedDbSessionRepository } from '../adapters/indexeddb/tutoring-sessions.repository';
import { IndexedDbStudentRepository } from '../adapters/indexeddb/tutoring-students.repository';
import { CloudLinkPanel } from '../cloud/CloudAccess';
import { addLocalExpense } from '../finance/local-commands';
import { Sozan1MigrationPanel } from '../migration/Sozan1MigrationPanel';
import { runWorkspaceSync } from '../sync/engine';
import { pendingSyncCount } from '../sync/outbox';
import { completeLocalSession } from '../tutoring/attendance-commands';
import {
  collectLocalStudentPayment,
  configureLocalStudentBilling,
} from '../tutoring/local-commands';
import {
  activeCycleFor,
  loadSimpleWorkspaceData,
  planFor,
  studentForSession,
  type SimpleWorkspaceData,
} from './data';

const studentsService = new StudentsService(new IndexedDbStudentRepository(), crypto.randomUUID);
const sessionsService = new SessionsService(new IndexedDbSessionRepository(), crypto.randomUUID);
const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

type PageKey = 'today' | 'money' | 'schedule' | 'me';
type MoneyMode = 'none' | 'receipt' | 'expense';

export function SimpleWorkspace({
  snapshot,
  cloudAvailable,
  onPlatformChanged,
}: {
  snapshot: LocalPlatformSnapshot;
  cloudAvailable: boolean;
  onPlatformChanged: () => Promise<void>;
}) {
  const workspaceId = snapshot.workspace.id;
  const [page, setPage] = useState<PageKey>('today');
  const [data, setData] = useState<SimpleWorkspaceData | null>(null);
  const [pendingSync, setPendingSync] = useState(0);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [moneyMode, setMoneyMode] = useState<MoneyMode>('none');
  const [showAddSession, setShowAddSession] = useState(false);
  const [showAddStudent, setShowAddStudent] = useState(false);

  const refresh = async () => {
    const [nextData, nextPending] = await Promise.all([
      loadSimpleWorkspaceData(workspaceId),
      pendingSyncCount(workspaceId),
    ]);
    setData(nextData);
    setPendingSync(nextPending);
  };

  useEffect(() => {
    void refresh();
    // workspaceId is the local data boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  const syncAfterWrite = async () => {
    if (snapshot.cloudLink && navigator.onLine) {
      try {
        await runWorkspaceSync(workspaceId);
      } catch {
        // The local write is durable and remains queued for the next sync.
      }
    }
    await refresh();
  };

  const runAction = async (action: () => Promise<void>, success: string) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(success);
      await syncAfterWrite();
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  };

  const openMoney = (mode: Exclude<MoneyMode, 'none'>) => {
    setMoneyMode(mode);
    setPage('money');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (!data) {
    return <div className="simple-loading">جاري تجهيز بياناتك…</div>;
  }

  return (
    <main className="simple-app" dir="rtl">
      <div className="simple-content">
        {notice && <div className="simple-toast good">{notice}</div>}
        {error && <div className="simple-toast bad">{error}</div>}

        {page === 'today' && (
          <TodayPage
            snapshot={snapshot}
            data={data}
            busy={busy}
            onOpenMoney={openMoney}
            onComplete={(session, date) => runAction(
              () => completeLocalSession(workspaceId, session, date),
              'تم تسجيل الحصة.',
            )}
          />
        )}

        {page === 'money' && (
          <MoneyPage
            snapshot={snapshot}
            data={data}
            mode={moneyMode}
            busy={busy}
            onMode={setMoneyMode}
            onCollect={(form) => runAction(async () => {
              await collectLocalStudentPayment({
                workspaceId,
                studentId: String(form.get('studentId') ?? ''),
                amountPence: toPence(form.get('amount')),
                receivedAt: String(form.get('receivedAt') ?? todayIso()),
                paymentMethod: String(form.get('paymentMethod') ?? 'cash') as 'cash' | 'bank' | 'wallet' | 'other',
                note: String(form.get('note') ?? ''),
              });
              setMoneyMode('none');
            }, 'تم تسجيل التحصيل.')}
            onExpense={(form) => runAction(async () => {
              await addLocalExpense({
                workspaceId,
                expenseDate: String(form.get('expenseDate') ?? todayIso()),
                scope: String(form.get('scope') ?? 'personal') as 'business' | 'personal',
                category: String(form.get('category') ?? 'أخرى'),
                amountPence: toPence(form.get('amount')),
                note: String(form.get('note') ?? ''),
              });
              setMoneyMode('none');
            }, 'تم تسجيل المصروف.')}
          />
        )}

        {page === 'schedule' && (
          <SchedulePage
            data={data}
            busy={busy}
            showAdd={showAddSession}
            onToggleAdd={() => setShowAddSession((value) => !value)}
            onAdd={(form) => runAction(async () => {
              const pending = String(form.get('scheduleStatus') ?? 'confirmed') === 'pending';
              await sessionsService.create(workspaceId, {
                title: String(form.get('title') ?? ''),
                sessionType: String(form.get('sessionType') ?? 'private_student_home'),
                scheduleStatus: pending ? 'pending' : 'confirmed',
                weekday: Number(form.get('weekday') ?? 0),
                startTime: pending ? null : String(form.get('startTime') ?? ''),
                durationMinutes: Number(form.get('durationMinutes') ?? 60),
                travelMinutes: 0,
                location: String(form.get('location') ?? ''),
                priceBasis: 'total_session',
                defaultPricePence: toPence(form.get('price'), true),
                expectedStudentCount: 1,
                centerCutBps: 0,
                studentIds: form.get('studentId') ? [String(form.get('studentId'))] : [],
              });
              setShowAddSession(false);
            }, 'تم حفظ الموعد.')}
          />
        )}

        {page === 'me' && (
          <MePage
            snapshot={snapshot}
            data={data}
            cloudAvailable={cloudAvailable}
            pendingSync={pendingSync}
            busy={busy}
            showAddStudent={showAddStudent}
            onToggleAddStudent={() => setShowAddStudent((value) => !value)}
            onPlatformChanged={async () => {
              await onPlatformChanged();
              await refresh();
            }}
            onStudentAdd={(form) => runAction(async () => {
              await studentsService.create(workspaceId, {
                name: String(form.get('name') ?? ''),
                guardianName: String(form.get('guardianName') ?? ''),
                guardianPhone: String(form.get('guardianPhone') ?? ''),
                level: String(form.get('level') ?? ''),
                notes: String(form.get('notes') ?? ''),
              });
              setShowAddStudent(false);
            }, 'تمت إضافة الطالب.')}
            onPackage={(studentId, form) => runAction(async () => {
              await configureLocalStudentBilling(workspaceId, studentId, {
                billingMode: 'package',
                packageSize: Number(form.get('packageSize') ?? 8),
                packagePricePence: toPence(form.get('packagePrice'), true),
                openingCompletedCount: Number(form.get('openingCompletedCount') ?? 0),
                effectiveFrom: String(form.get('effectiveFrom') ?? todayIso()),
                cycleAnchorDate: null,
              });
            }, 'تم حفظ الباقة.')}
          />
        )}
      </div>

      <nav className="simple-bottom-nav" aria-label="التنقل الرئيسي">
        <NavButton active={page === 'today'} label="اليوم" icon="⌂" onClick={() => setPage('today')} />
        <NavButton active={page === 'money'} label="فلوسي" icon="▣" onClick={() => setPage('money')} />
        <NavButton active={page === 'schedule'} label="جدولي" icon="▦" onClick={() => setPage('schedule')} />
        <NavButton active={page === 'me'} label="أنا" icon="○" onClick={() => setPage('me')} />
      </nav>
    </main>
  );
}

function TodayPage({
  snapshot,
  data,
  busy,
  onOpenMoney,
  onComplete,
}: {
  snapshot: LocalPlatformSnapshot;
  data: SimpleWorkspaceData;
  busy: boolean;
  onOpenMoney: (mode: 'receipt' | 'expense') => void;
  onComplete: (session: RecurringSession, date: string) => void;
}) {
  const today = todayIso();
  const month = today.slice(0, 7);
  const weekday = weekdayForIso(today);
  const sessions = data.sessions
    .filter((session) => session.scheduleStatus === 'confirmed' && session.weekday === weekday)
    .sort(compareSessionTime);
  const monthReceipts = sum(data.receipts.filter((row) => row.receivedAt.startsWith(month)).map((row) => row.amountPence));
  const monthOther = sum(data.otherIncome.filter((row) => row.incomeDate.startsWith(month)).map((row) => row.amountPence));
  const monthExpenses = sum(data.expenses.filter((row) => row.expenseDate.startsWith(month)).map((row) => row.amountPence));
  const net = monthReceipts + monthOther - monthExpenses;
  const due = dueTotal(data);
  const greeting = greetingForHour(new Date().getHours());

  return (
    <section className="simple-screen">
      <ScreenHeader kicker="مساعد سوزان" title="اليوم" />

      <article className="today-hero">
        <div className="today-hero-top">
          <div>
            <strong>{greeting} يا {snapshot.user.displayName}</strong>
            <span>{formatArabicDate(today)}</span>
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

      <SectionTitle eyebrow="اليوم" title="حصصك" />
      <div className="lesson-list">
        {sessions.map((session) => {
          const occurrence = data.occurrences.find((row) => row.recurringSessionId === session.id && row.sessionDate === today);
          const student = studentForSession(data, session);
          const cycle = student ? activeCycleFor(data, student.id) : null;
          const plan = student ? planFor(data, student.id) : null;
          const done = occurrence?.status === 'completed';
          return (
            <article className={`lesson-card ${done ? 'done' : ''}`} key={session.id}>
              <div className="lesson-main">
                <div>
                  <strong>{session.title}</strong>
                  <small>{session.startTime ?? 'الوقت غير محدد'} · {sessionTypeLabel(session.sessionType)}</small>
                  {plan?.billingMode === 'package' && (
                    <small>باقة · {cycle ? cycle.openingCompletedCount + cycle.realCompletedCount : 0}/{cycle?.sessionLimit ?? plan.packageSize ?? 8}</small>
                  )}
                </div>
                {plan?.billingMode === 'package' && (
                  <span className="progress-chip">{cycle ? cycle.openingCompletedCount + cycle.realCompletedCount : 0}/{cycle?.sessionLimit ?? plan.packageSize ?? 8}</span>
                )}
              </div>
              <button
                className="lesson-done-button"
                type="button"
                disabled={busy || done}
                onClick={() => onComplete(session, today)}
              >
                {done ? 'تمت ✓' : 'تمت'}
              </button>
            </article>
          );
        })}
        {!sessions.length && <div className="friendly-empty">مفيش حصص مؤكدة النهارده.</div>}
      </div>
    </section>
  );
}

function MoneyPage({
  snapshot,
  data,
  mode,
  busy,
  onMode,
  onCollect,
  onExpense,
}: {
  snapshot: LocalPlatformSnapshot;
  data: SimpleWorkspaceData;
  mode: MoneyMode;
  busy: boolean;
  onMode: (mode: MoneyMode) => void;
  onCollect: (form: FormData) => void;
  onExpense: (form: FormData) => void;
}) {
  const month = todayIso().slice(0, 7);
  const receipts = data.receipts.filter((row) => row.receivedAt.startsWith(month));
  const expenses = data.expenses.filter((row) => row.expenseDate.startsWith(month));
  const income = data.otherIncome.filter((row) => row.incomeDate.startsWith(month));
  const received = sum(receipts.map((row) => row.amountPence));
  const spent = sum(expenses.map((row) => row.amountPence));
  const other = sum(income.map((row) => row.amountPence));
  const due = dueTotal(data);

  return (
    <section className="simple-screen">
      <ScreenHeader kicker="مساعد سوزان" title="فلوسي" />
      <div className="screen-action-row">
        <button className="primary-small" type="button" onClick={() => onMode(mode === 'receipt' ? 'none' : 'receipt')}>＋ قبضت فلوس</button>
        <button className="secondary-small" type="button" onClick={() => onMode(mode === 'expense' ? 'none' : 'expense')}>− مصروف</button>
      </div>

      {mode === 'receipt' && (
        <QuickForm title="سجلّي التحصيل" onSubmit={(form) => onCollect(form)} busy={busy}>
          <select name="studentId" required defaultValue="">
            <option value="" disabled>اختاري الطالب</option>
            {data.students.map((student) => <option key={student.id} value={student.id}>{student.name}</option>)}
          </select>
          <input name="amount" type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="المبلغ" required />
          <input name="receivedAt" type="date" defaultValue={todayIso()} required />
          <select name="paymentMethod" defaultValue="cash">
            <option value="cash">كاش</option><option value="bank">بنك</option><option value="wallet">محفظة</option><option value="other">أخرى</option>
          </select>
          <input name="note" placeholder="ملاحظة اختيارية" />
        </QuickForm>
      )}

      {mode === 'expense' && (
        <QuickForm title="سجلّي المصروف" onSubmit={(form) => onExpense(form)} busy={busy}>
          <input name="amount" type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="المبلغ" required />
          <input name="expenseDate" type="date" defaultValue={todayIso()} required />
          <select name="scope" defaultValue="personal"><option value="personal">شخصي</option><option value="business">شغل</option></select>
          <input name="category" placeholder="التصنيف: بيت، مواصلات، أدوات…" required />
          <input name="note" placeholder="ملاحظة اختيارية" />
        </QuickForm>
      )}

      <SectionTitle eyebrow="صورة الشهر" title="فلوسي" />
      <div className="money-grid">
        <Metric label="قبضت" value={money(received, snapshot.workspace.currencyLabel)} />
        <Metric label="دخل آخر" value={money(other, snapshot.workspace.currencyLabel)} />
        <Metric label="صرفت" value={money(spent, snapshot.workspace.currencyLabel)} />
        <Metric label="مطلوب تحصيله الآن" value={money(due, snapshot.workspace.currencyLabel)} accent />
      </div>

      <p className="money-note">{due > 0 ? 'فيه مستحقات جاهزة للتحصيل.' : 'مفيش شغل داخل باقات مكتملة ومستحقة حاليًا.'}</p>

      <SectionTitle eyebrow="التحصيل" title="مين دفع ومين لسه؟" />
      <div className="student-money-list">
        {data.students.map((student) => {
          const plan = planFor(data, student.id);
          const cycle = activeCycleFor(data, student.id);
          const paid = sum(data.receipts.filter((row) => row.payerRefId === student.id).map((row) => row.amountPence));
          const progress = plan?.billingMode === 'package'
            ? `${cycle ? cycle.openingCompletedCount + cycle.realCompletedCount : 0}/${cycle?.sessionLimit ?? plan.packageSize ?? 8}`
            : 'بالحصة';
          const dueNow = cycle?.status === 'due';
          return (
            <article className="student-money-row" key={student.id}>
              <div className="avatar-circle">{student.name.trim().charAt(0)}</div>
              <div><strong>{student.name}</strong><small>{plan?.billingMode === 'package' ? `الدورة الحالية · ${progress}` : 'الحساب بالحصة'}</small></div>
              <div className="student-money-status"><span className={dueNow ? 'needs' : 'ok'}>{dueNow ? 'مطلوب' : progress}</span>{paid > 0 && <small>دفع {money(paid, snapshot.workspace.currencyLabel)}</small>}</div>
            </article>
          );
        })}
      </div>

      <SectionTitle eyebrow="آخر حركة" title="المقبوض والمصروف" />
      <div className="activity-list">
        {recentMoneyRows(data, snapshot.workspace.currencyLabel).map((row) => (
          <div className="activity-row" key={row.id}><div><strong>{row.title}</strong><small>{row.date}</small></div><b className={row.kind}>{row.value}</b></div>
        ))}
      </div>
    </section>
  );
}

function SchedulePage({
  data,
  busy,
  showAdd,
  onToggleAdd,
  onAdd,
}: {
  data: SimpleWorkspaceData;
  busy: boolean;
  showAdd: boolean;
  onToggleAdd: () => void;
  onAdd: (form: FormData) => void;
}) {
  const pendingSessions = data.sessions.filter((row) => row.scheduleStatus === 'pending');
  return (
    <section className="simple-screen">
      <ScreenHeader kicker="مساعد سوزان" title="جدولي" />
      <div className="screen-action-row"><button className="primary-small" type="button" onClick={onToggleAdd}>＋ طالب / مجموعة</button></div>

      {showAdd && (
        <QuickForm title="أضيفي موعدًا" onSubmit={onAdd} busy={busy}>
          <input name="title" placeholder="اسم الطالب أو المجموعة" required />
          <select name="studentId" defaultValue=""><option value="">بدون طالب محدد</option>{data.students.map((student) => <option key={student.id} value={student.id}>{student.name}</option>)}</select>
          <select name="sessionType" defaultValue="private_student_home">
            <option value="private_student_home">خاص عند الطالب</option><option value="private_tutor_home">خاص عند المدرس</option><option value="online">أونلاين</option><option value="center_group">السنتر</option><option value="own_group">مجموعة خاصة</option>
          </select>
          <select name="scheduleStatus" defaultValue="confirmed"><option value="confirmed">الموعد محدد</option><option value="pending">الوقت لسه غير محدد</option></select>
          <select name="weekday" defaultValue={0}>{WEEKDAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}</select>
          <input name="startTime" type="time" defaultValue="16:00" />
          <input name="durationMinutes" type="number" min="15" max="360" defaultValue="60" placeholder="مدة الحصة بالدقائق" />
          <input name="price" type="number" min="0" step="0.01" placeholder="سعر الحصة إن وجد" />
          <input name="location" placeholder="المكان أو ملاحظة" />
        </QuickForm>
      )}

      <div className="schedule-tabs"><span className="active">أسبوع</span><span>شهر</span><span>أوقات فاضية</span><span>تعديل</span></div>

      {WEEKDAYS.map((day, weekday) => {
        const rows = data.sessions.filter((session) => session.scheduleStatus === 'confirmed' && session.weekday === weekday).sort(compareSessionTime);
        if (!rows.length) return null;
        return (
          <section className="day-block" key={day}>
            <div className="day-heading"><strong>{day}</strong><span>{rows.length} {rows.length === 1 ? 'حصة' : 'حصص'}</span></div>
            {rows.map((session) => (
              <div className="schedule-row" key={session.id}>
                <span className={`session-color type-${session.sessionType}`} />
                <div><strong>{session.title}</strong><small>{sessionTypeLabel(session.sessionType)}{studentForSession(data, session) ? '' : ' · بدون طالب محدد'}</small></div>
                <time>{session.startTime ?? 'غير محدد'}</time>
              </div>
            ))}
          </section>
        );
      })}

      {pendingSessions.length > 0 && (
        <section className="day-block pending-block">
          <div className="day-heading"><strong>مواعيد تحتاج تحديد</strong><span>{pendingSessions.length}</span></div>
          {pendingSessions.map((session) => (
            <div className="schedule-row" key={session.id}><span className="session-color pending" /><div><strong>{session.title}</strong><small>{session.weekday === null ? 'اليوم والوقت غير محددين' : `${WEEKDAYS[session.weekday]} · الوقت غير محدد`}</small></div><time>—</time></div>
          ))}
        </section>
      )}
    </section>
  );
}

function MePage({
  snapshot,
  data,
  cloudAvailable,
  pendingSync,
  busy,
  showAddStudent,
  onToggleAddStudent,
  onPlatformChanged,
  onStudentAdd,
  onPackage,
}: {
  snapshot: LocalPlatformSnapshot;
  data: SimpleWorkspaceData;
  cloudAvailable: boolean;
  pendingSync: number;
  busy: boolean;
  showAddStudent: boolean;
  onToggleAddStudent: () => void;
  onPlatformChanged: () => Promise<void>;
  onStudentAdd: (form: FormData) => void;
  onPackage: (studentId: string, form: FormData) => void;
}) {
  const pendingTimes = data.sessions.filter((row) => row.scheduleStatus === 'pending').length;
  const due = dueTotal(data);
  const month = todayIso().slice(0, 7);
  const balance = sum(data.receipts.filter((row) => row.receivedAt.startsWith(month)).map((row) => row.amountPence))
    + sum(data.otherIncome.filter((row) => row.incomeDate.startsWith(month)).map((row) => row.amountPence))
    - sum(data.expenses.filter((row) => row.expenseDate.startsWith(month)).map((row) => row.amountPence));

  const notes = [
    pendingSync > 0 ? `${pendingSync} تغيير مستني المزامنة` : null,
    pendingTimes > 0 ? `${pendingTimes} مواعيد محتاجة تحديد وقت` : null,
    due > 0 ? `فيه ${money(due, snapshot.workspace.currencyLabel)} جاهزة للتحصيل` : null,
  ].filter(Boolean) as string[];

  return (
    <section className="simple-screen">
      <ScreenHeader kicker="مساعد سوزان" title="أنا" />

      <article className="attention-card">
        <span>ملاحظات ذكية</span>
        <h2>إيه اللي محتاج انتباهك؟</h2>
        {notes.length ? notes.map((note) => <p key={note}>{note}</p>) : <div className="stable-box"><strong>الصورة مستقرة</strong><small>مفيش حاجة ملحّة محتاجة مراجعة دلوقتي.</small></div>}
      </article>

      <article className="cash-card">
        <span>الصورة المسجلة</span><h2>الموجود في الحسابات</h2><strong>{money(balance, snapshot.workspace.currencyLabel)}</strong><small>المقبوض والدخل الآخر ناقص المصروفات المسجلة خلال الشهر.</small>
      </article>

      <details className="settings-card">
        <summary>الطلاب</summary>
        <div className="settings-body">
          <button className="primary-small" type="button" onClick={onToggleAddStudent}>＋ إضافة طالب</button>
          {showAddStudent && (
            <QuickForm title="طالب جديد" onSubmit={onStudentAdd} busy={busy}>
              <input name="name" placeholder="اسم الطالب" required />
              <input name="guardianName" placeholder="ولي الأمر" />
              <input name="guardianPhone" placeholder="رقم الهاتف" inputMode="tel" />
              <input name="level" placeholder="المستوى" />
              <input name="notes" placeholder="ملاحظات" />
            </QuickForm>
          )}
          <div className="student-settings-list">
            {data.students.map((student) => {
              const plan = planFor(data, student.id);
              const cycle = activeCycleFor(data, student.id);
              return (
                <details className="student-setting-row" key={student.id}>
                  <summary><strong>{student.name}</strong><span>{plan?.billingMode === 'package' ? `باقة ${cycle?.sessionLimit ?? plan.packageSize ?? 8}` : 'بالحصة'}</span></summary>
                  <form onSubmit={(event) => { event.preventDefault(); onPackage(student.id, new FormData(event.currentTarget)); }}>
                    <div className="inline-fields">
                      <label>عدد الحصص<input name="packageSize" type="number" min="1" max="100" defaultValue={cycle?.sessionLimit ?? plan?.packageSize ?? 8} /></label>
                      <label>سعر الباقة<input name="packagePrice" type="number" min="0" step="0.01" defaultValue={(cycle?.pricePence ?? plan?.packagePricePence ?? 0) / 100 || ''} /></label>
                      <label>المكتمل قبل البرنامج<input name="openingCompletedCount" type="number" min="0" max="100" defaultValue={cycle?.openingCompletedCount ?? 0} /></label>
                    </div>
                    <input name="effectiveFrom" type="hidden" value={plan?.effectiveFrom ?? todayIso()} />
                    <button className="secondary-small" type="submit" disabled={busy}>حفظ الباقة</button>
                  </form>
                </details>
              );
            })}
          </div>
        </div>
      </details>

      <details className="settings-card">
        <summary>الحساب والمزامنة</summary>
        <div className="settings-body"><CloudLinkPanel snapshot={snapshot} available={cloudAvailable} onLinked={onPlatformChanged} /></div>
      </details>

      <details className="settings-card">
        <summary>نقل أو استعادة البيانات</summary>
        <div className="settings-body">
          <Sozan1MigrationPanel workspaceId={snapshot.workspace.id} cloudLinked={Boolean(snapshot.cloudLink)} currencyLabel={snapshot.workspace.currencyLabel} onImported={onPlatformChanged} />
        </div>
      </details>
    </section>
  );
}

function QuickForm({ title, onSubmit, busy, children }: { title: string; onSubmit: (form: FormData) => void; busy: boolean; children: React.ReactNode }) {
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); onSubmit(new FormData(event.currentTarget)); };
  return <form className="quick-form" onSubmit={submit}><h3>{title}</h3>{children}<button className="form-submit" type="submit" disabled={busy}>{busy ? 'جاري الحفظ…' : 'حفظ'}</button></form>;
}

function ScreenHeader({ kicker, title }: { kicker: string; title: string }) {
  return <header className="simple-header"><span>{kicker}</span><h1>{title}</h1></header>;
}

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return <div className="simple-section-title"><span>{eyebrow}</span><h2>{title}</h2></div>;
}

function Metric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return <div className={`metric-card ${accent ? 'accent' : ''}`}><span>{label}</span><strong>{value}</strong></div>;
}

function NavButton({ active, label, icon, onClick }: { active: boolean; label: string; icon: string; onClick: () => void }) {
  return <button type="button" className={active ? 'active' : ''} onClick={onClick}><b>{icon}</b><span>{label}</span></button>;
}

function recentMoneyRows(data: SimpleWorkspaceData, currencyLabel: string) {
  return [
    ...data.receipts.map((row) => ({ id: `r-${row.id}`, date: row.receivedAt, kind: 'in' as const, title: data.students.find((student) => student.id === row.payerRefId)?.name ? `تحصيل من ${data.students.find((student) => student.id === row.payerRefId)?.name}` : 'تحصيل', value: `+ ${money(row.amountPence, currencyLabel)}` })),
    ...data.expenses.map((row) => ({ id: `e-${row.id}`, date: row.expenseDate, kind: 'out' as const, title: `مصروف · ${row.category}`, value: `− ${money(row.amountPence, currencyLabel)}` })),
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
}

function dueTotal(data: SimpleWorkspaceData): number {
  return data.billingCycles.filter((cycle) => cycle.status === 'due').reduce((total, cycle) => {
    const allocated = data.allocations.filter((row) => row.targetId === cycle.id).reduce((sumValue, row) => sumValue + row.amountPence, 0);
    return total + Math.max(0, cycle.pricePence - allocated);
  }, 0);
}

function compareSessionTime(a: RecurringSession, b: RecurringSession): number {
  return (a.startTime ?? '99:99').localeCompare(b.startTime ?? '99:99') || a.title.localeCompare(b.title, 'ar');
}

function sessionTypeLabel(type: RecurringSession['sessionType']): string {
  return ({ private_student_home: 'خاص عند الطالب', private_tutor_home: 'خاص عند المدرس', online: 'أونلاين', center_group: 'السنتر', own_group: 'مجموعة خاصة' } as const)[type];
}

function money(pence: number, label: string): string {
  return `${(pence / 100).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ${label}`;
}

function sum(values: number[]): number { return values.reduce((total, value) => total + Number(value || 0), 0); }

function toPence(value: FormDataEntryValue | null, allowZero = false): number {
  const numeric = Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(numeric) || numeric < 0 || (!allowZero && numeric <= 0)) throw new Error('AMOUNT_INVALID');
  return Math.round(numeric * 100);
}

function todayIso(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function weekdayForIso(iso: string): number { return new Date(`${iso}T12:00:00`).getDay(); }

function formatArabicDate(iso: string): string {
  return new Intl.DateTimeFormat('ar-EG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${iso}T12:00:00`));
}

function greetingForHour(hour: number): string { return hour < 12 ? 'صباح الخير' : hour < 18 ? 'مساء الخير' : 'مساء الخير'; }

function messageFor(cause: unknown): string {
  const code = cause instanceof Error ? cause.message : 'UNKNOWN';
  const messages: Record<string, string> = {
    AMOUNT_INVALID: 'اكتبي مبلغًا صحيحًا.',
    EXPENSE_AMOUNT_INVALID: 'اكتبي مبلغ المصروف بشكل صحيح.',
    EXPENSE_CATEGORY_REQUIRED: 'اكتبي تصنيف المصروف.',
    BILLING_MODE_LOCKED_BY_HISTORY: 'لا يمكن تغيير نظام الحساب بعد وجود تاريخ مالي؛ يمكن تعديل تفاصيل الباقة نفسها.',
    OCCURRENCE_STATE_INVALID: 'حالة الحصة لا تسمح بهذا التعديل.',
  };
  return messages[code] ?? `تعذر إكمال العملية (${code})`;
}
