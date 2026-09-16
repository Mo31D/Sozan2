import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
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
import { collectLocalStudentPayment, configureLocalStudentBilling } from '../tutoring/local-commands';
import {
  activeCycleFor,
  loadSimpleWorkspaceData,
  planFor,
  studentForSession,
  type LocalOccurrence,
  type SimpleWorkspaceData,
} from './data';

const studentsService = new StudentsService(new IndexedDbStudentRepository(), crypto.randomUUID);
const sessionsService = new SessionsService(new IndexedDbSessionRepository(), crypto.randomUUID);
const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

type PageKey = 'today' | 'money' | 'schedule' | 'me';
type MoneyMode = 'none' | 'receipt' | 'expense';
type ScheduleMode = 'week' | 'month' | 'free' | 'edit';
type AddDraft = { weekday: number; startTime: string } | null;
type ScheduledEntry = {
  session: RecurringSession;
  occurrence: LocalOccurrence | null;
  date: string;
  startTime: string | null;
  status: LocalOccurrence['status'] | 'scheduled';
};

export function SimpleWorkspaceV2({
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
  }, [workspaceId]);

  const syncAfterWrite = async () => {
    if (snapshot.cloudLink && navigator.onLine) {
      try {
        await runWorkspaceSync(workspaceId);
      } catch {
        // The local write remains durable and queued for the next sync.
      }
    }
    await refresh();
  };

  const runAction = async (action: () => Promise<void>, success: string): Promise<boolean> => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(success);
      await syncAfterWrite();
      return true;
    } catch (cause) {
      setError(messageFor(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const openMoney = (mode: Exclude<MoneyMode, 'none'>) => {
    setMoneyMode(mode);
    setPage('money');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const moveTo = (next: PageKey) => {
    setPage(next);
    setNotice('');
    setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (!data) return <div className="simple-loading">جاري تجهيز بياناتك…</div>;

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
            onComplete={(session, date) => void runAction(
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
            onCollect={(form) => void runAction(async () => {
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
            onExpense={(form) => void runAction(async () => {
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
            onAdd={async (form) => runAction(async () => {
              const pending = String(form.get('scheduleStatus') ?? 'confirmed') === 'pending';
              const weekdayRaw = String(form.get('weekday') ?? '');
              await sessionsService.create(workspaceId, {
                title: String(form.get('title') ?? ''),
                sessionType: String(form.get('sessionType') ?? 'private_student_home'),
                scheduleStatus: pending ? 'pending' : 'confirmed',
                weekday: weekdayRaw === '' ? null : Number(weekdayRaw),
                startTime: pending ? null : String(form.get('startTime') ?? ''),
                durationMinutes: Number(form.get('durationMinutes') ?? 60),
                travelMinutes: Number(form.get('travelMinutes') ?? 0),
                location: String(form.get('location') ?? ''),
                priceBasis: 'total_session',
                defaultPricePence: toPence(form.get('price'), true),
                expectedStudentCount: 1,
                centerCutBps: 0,
                studentIds: form.get('studentId') ? [String(form.get('studentId'))] : [],
              });
            }, 'تم حفظ الموعد.')}
            onUpdate={async (sessionId, form) => runAction(async () => {
              const status = String(form.get('scheduleStatus') ?? 'confirmed') as 'confirmed' | 'pending';
              const weekdayRaw = String(form.get('weekday') ?? '');
              const timeRaw = String(form.get('startTime') ?? '');
              await sessionsService.updateSchedule(workspaceId, sessionId, {
                scheduleStatus: status,
                weekday: weekdayRaw === '' ? null : Number(weekdayRaw),
                startTime: timeRaw || null,
              });
            }, 'تم تعديل الموعد.')}
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
            onStudentAdd={(form) => void runAction(async () => {
              await studentsService.create(workspaceId, {
                name: String(form.get('name') ?? ''),
                guardianName: String(form.get('guardianName') ?? ''),
                guardianPhone: String(form.get('guardianPhone') ?? ''),
                level: String(form.get('level') ?? ''),
                notes: String(form.get('notes') ?? ''),
              });
              setShowAddStudent(false);
            }, 'تمت إضافة الطالب.')}
            onPackage={(studentId, form) => void runAction(async () => {
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
        <NavButton active={page === 'today'} label="اليوم" icon="⌂" onClick={() => moveTo('today')} />
        <NavButton active={page === 'money'} label="فلوسي" icon="▣" onClick={() => moveTo('money')} />
        <NavButton active={page === 'schedule'} label="جدولي" icon="▦" onClick={() => moveTo('schedule')} />
        <NavButton active={page === 'me'} label="أنا" icon="○" onClick={() => moveTo('me')} />
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
  const entries = scheduleEntriesForDate(data, today).filter((entry) => entry.status !== 'cancelled');
  const monthReceipts = sum(data.receipts.filter((row) => row.receivedAt.startsWith(month)).map((row) => row.amountPence));
  const monthOther = sum(data.otherIncome.filter((row) => row.incomeDate.startsWith(month)).map((row) => row.amountPence));
  const monthExpenses = sum(data.expenses.filter((row) => row.expenseDate.startsWith(month)).map((row) => row.amountPence));
  const net = monthReceipts + monthOther - monthExpenses;
  const due = dueTotal(data);

  return (
    <section className="simple-screen">
      <ScreenHeader kicker="مساعد سوزان" title="اليوم" />
      <article className="today-hero">
        <div className="today-hero-top">
          <div>
            <strong>{greetingForHour(new Date().getHours())} يا {snapshot.user.displayName}</strong>
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
        {entries.map((entry) => {
          const { session, occurrence } = entry;
          const student = studentForSession(data, session);
          const cycle = student ? activeCycleFor(data, student.id) : null;
          const plan = student ? planFor(data, student.id) : null;
          const done = occurrence?.status === 'completed';
          return (
            <article className={`lesson-card ${done ? 'done' : ''}`} key={`${session.id}-${today}`}>
              <div className="lesson-main">
                <div>
                  <strong>{session.title}</strong>
                  <small>{entry.startTime ?? 'الوقت غير محدد'} · {sessionTypeLabel(session.sessionType)}</small>
                  {plan?.billingMode === 'package' && <small>باقة · {packageProgress(data, student?.id ?? '')}</small>}
                </div>
                {plan?.billingMode === 'package' && <span className="progress-chip">{packageProgress(data, student?.id ?? '')}</span>}
              </div>
              <button className="lesson-done-button" type="button" disabled={busy || done} onClick={() => onComplete(session, today)}>
                {done ? 'تمت ✓' : 'تمت'}
              </button>
            </article>
          );
        })}
        {!entries.length && <div className="friendly-empty">مفيش حصص مؤكدة النهارده.</div>}
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
        <QuickForm title="سجلّي التحصيل" onSubmit={onCollect} busy={busy}>
          <select name="studentId" required defaultValue=""><option value="" disabled>اختاري الطالب</option>{data.students.map((student) => <option key={student.id} value={student.id}>{student.name}</option>)}</select>
          <input name="amount" type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="المبلغ" required />
          <input name="receivedAt" type="date" defaultValue={todayIso()} required />
          <select name="paymentMethod" defaultValue="cash"><option value="cash">كاش</option><option value="bank">بنك</option><option value="wallet">محفظة</option><option value="other">أخرى</option></select>
          <input name="note" placeholder="ملاحظة اختيارية" />
        </QuickForm>
      )}

      {mode === 'expense' && (
        <QuickForm title="سجلّي المصروف" onSubmit={onExpense} busy={busy}>
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
      <p className="money-note">{due > 0 ? 'فيه مستحقات جاهزة للتحصيل.' : 'مفيش باقات مكتملة ومستحقة حاليًا.'}</p>

      <SectionTitle eyebrow="التحصيل" title="مين دفع ومين لسه؟" />
      <div className="student-money-list">
        {data.students.map((student) => {
          const plan = planFor(data, student.id);
          const cycle = activeCycleFor(data, student.id);
          const paid = sum(data.receipts.filter((row) => row.payerRefId === student.id).map((row) => row.amountPence));
          const progress = plan?.billingMode === 'package' ? packageProgress(data, student.id) : 'بالحصة';
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
          <div className="activity-row" key={row.id}><div><strong>{row.title}</strong><small>{formatShortDate(row.date)}</small></div><b className={row.kind}>{row.value}</b></div>
        ))}
        {!recentMoneyRows(data, snapshot.workspace.currencyLabel).length && <div className="friendly-empty">لسه مفيش حركات مالية مسجلة.</div>}
      </div>
    </section>
  );
}

function SchedulePage({
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
          <select name="studentId" defaultValue=""><option value="">بدون طالب محدد</option>{data.students.map((student) => <option key={student.id} value={student.id}>{student.name}</option>)}</select>
          <select name="sessionType" defaultValue="private_student_home"><option value="private_student_home">خاص عند الطالب</option><option value="private_tutor_home">خاص عند المدرس</option><option value="online">أونلاين</option><option value="center_group">السنتر</option><option value="own_group">مجموعة خاصة</option></select>
          <select name="scheduleStatus" defaultValue="confirmed"><option value="confirmed">الموعد محدد</option><option value="pending">الوقت لسه غير محدد</option></select>
          <select name="weekday" defaultValue={addDraft?.weekday ?? weekdayForIso(todayIso())}>{WEEKDAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}</select>
          <input name="startTime" type="time" defaultValue={addDraft?.startTime ?? '16:00'} />
          <input name="durationMinutes" type="number" min="15" max="360" defaultValue="60" placeholder="مدة الحصة بالدقائق" />
          <input name="travelMinutes" type="number" min="0" max="360" defaultValue="0" placeholder="وقت الانتقال بالدقائق" />
          <input name="price" type="number" min="0" step="0.01" placeholder="سعر الحصة إن وجد" />
          <input name="location" placeholder="المكان أو ملاحظة" />
        </QuickForm>
      )}

      <div className="schedule-tabs" role="tablist" aria-label="عرض الجدول">
        <ScheduleTab active={mode === 'week'} label="أسبوع" onClick={() => setMode('week')} />
        <ScheduleTab active={mode === 'month'} label="شهر" onClick={() => setMode('month')} />
        <ScheduleTab active={mode === 'free'} label="أوقات فاضية" onClick={() => setMode('free')} />
        <ScheduleTab active={mode === 'edit'} label="تعديل" onClick={() => setMode('edit')} />
      </div>

      {mode === 'week' && <WeekSchedule data={data} onEdit={openEdit} />}
      {mode === 'month' && (
        <MonthSchedule
          data={data}
          cursor={monthCursor}
          selectedDay={selectedDay}
          onSelectedDay={setSelectedDay}
          onCursor={setMonthCursor}
          onEdit={openEdit}
        />
      )}
      {mode === 'free' && (
        <FreeSchedule
          data={data}
          start={freeStart}
          end={freeEnd}
          onStart={setFreeStart}
          onEnd={setFreeEnd}
          onUseSlot={(date, startTime) => openAdd({ weekday: weekdayForIso(date), startTime })}
        />
      )}
      {mode === 'edit' && (
        <EditSchedule
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

function WeekSchedule({ data, onEdit }: { data: SimpleWorkspaceData; onEdit: (sessionId: string) => void }) {
  const start = todayIso();
  return (
    <div className="schedule-week-stack">
      {Array.from({ length: 7 }, (_, index) => addDays(start, index)).map((date, index) => {
        const rows = scheduleEntriesForDate(data, date);
        return (
          <section className={`day-block ${index === 0 ? 'today-day' : ''}`} key={date}>
            <div className="day-heading"><strong>{formatArabicDate(date)}{index === 0 ? ' · النهارده' : ''}</strong><span>{rows.length ? `${rows.length} ${rows.length === 1 ? 'حصة' : 'حصص'}` : 'فاضي'}</span></div>
            {rows.length ? rows.map((entry) => <ScheduleRow key={`${entry.session.id}-${date}`} entry={entry} onClick={() => onEdit(entry.session.id)} />) : <div className="schedule-empty-row">مفيش حصص</div>}
          </section>
        );
      })}
    </div>
  );
}

function MonthSchedule({
  data,
  cursor,
  selectedDay,
  onSelectedDay,
  onCursor,
  onEdit,
}: {
  data: SimpleWorkspaceData;
  cursor: Date;
  selectedDay: string;
  onSelectedDay: (date: string) => void;
  onCursor: (date: Date) => void;
  onEdit: (sessionId: string) => void;
}) {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const gridStartDate = new Date(year, month, 1 - first.getDay());
  const gridStart = localDate(gridStartDate);
  const today = todayIso();
  const selectedInGrid = selectedDay >= gridStart && selectedDay <= addDays(gridStart, 41) ? selectedDay : localDate(first);
  const detailRows = scheduleEntriesForDate(data, selectedInGrid);

  return (
    <div className="month-wrap">
      <div className="month-head">
        <strong>{new Intl.DateTimeFormat('ar-EG', { month: 'long', year: 'numeric' }).format(first)}</strong>
        <div>
          <button type="button" aria-label="الشهر السابق" onClick={() => onCursor(new Date(year, month - 1, 1))}>‹</button>
          <button type="button" onClick={() => { onCursor(startOfMonth(new Date())); onSelectedDay(today); }}>الحالي</button>
          <button type="button" aria-label="الشهر التالي" onClick={() => onCursor(new Date(year, month + 1, 1))}>›</button>
        </div>
      </div>
      <div className="month-weekdays">{WEEKDAYS.map((day) => <span key={day}>{day.slice(0, 3)}</span>)}</div>
      <div className="month-grid">
        {Array.from({ length: 42 }, (_, index) => {
          const date = addDays(gridStart, index);
          const dateObject = new Date(`${date}T12:00:00`);
          const count = scheduleEntriesForDate(data, date).length;
          return (
            <button
              type="button"
              key={date}
              className={`month-cell ${dateObject.getMonth() !== month ? 'outside' : ''} ${date === today ? 'today' : ''} ${date === selectedInGrid ? 'selected' : ''}`}
              onClick={() => onSelectedDay(date)}
            >
              <b>{dateObject.getDate()}</b>
              {count > 0 && <small>{count} {count === 1 ? 'حصة' : 'حصص'}</small>}
            </button>
          );
        })}
      </div>
      <div className="month-detail">
        <strong className="month-detail-title">{formatArabicDate(selectedInGrid)}</strong>
        {detailRows.length ? detailRows.map((entry) => <ScheduleRow key={`${entry.session.id}-${selectedInGrid}`} entry={entry} onClick={() => onEdit(entry.session.id)} />) : <div className="friendly-empty">مفيش حصص في اليوم ده.</div>}
      </div>
    </div>
  );
}

function FreeSchedule({
  data,
  start,
  end,
  onStart,
  onEnd,
  onUseSlot,
}: {
  data: SimpleWorkspaceData;
  start: string;
  end: string;
  onStart: (value: string) => void;
  onEnd: (value: string) => void;
  onUseSlot: (date: string, startTime: string) => void;
}) {
  const startMinute = timeToMinutes(start);
  const endMinute = timeToMinutes(end);
  const validWindow = startMinute !== null && endMinute !== null && startMinute < endMinute;
  const today = todayIso();

  return (
    <div className="free-planner">
      <div className="free-controls">
        <label>من<input type="time" value={start} onChange={(event) => onStart(event.target.value)} /></label>
        <label>إلى<input type="time" value={end} onChange={(event) => onEnd(event.target.value)} /></label>
      </div>
      <p>الفراغات تراعي مدة الحصة ووقت الانتقال المسجل. الموعد بدون ساعة يظهر كتنبيه لأنه لا يمكن وضعه على خط زمني.</p>
      {!validWindow && <div className="simple-toast bad">اختاري وقت بداية ونهاية صحيح.</div>}
      {validWindow && Array.from({ length: 7 }, (_, index) => addDays(today, index)).map((date, index) => {
        const entries = scheduleEntriesForDate(data, date).filter((entry) => entry.status !== 'cancelled');
        const unknown = entries.filter((entry) => timeToMinutes(entry.startTime) === null);
        const busy = entries
          .map((entry) => {
            const startAt = timeToMinutes(entry.startTime);
            if (startAt === null) return null;
            return {
              start: startAt,
              end: startAt + Math.max(15, entry.session.durationMinutes) + Math.max(0, entry.session.travelMinutes),
            };
          })
          .filter((item): item is { start: number; end: number } => item !== null)
          .sort((a, b) => a.start - b.start);
        const merged: Array<{ start: number; end: number }> = [];
        for (const interval of busy) {
          const last = merged.at(-1);
          if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
          else merged.push({ ...interval });
        }
        const slots: Array<{ start: number; end: number }> = [];
        let cursor = startMinute;
        for (const interval of merged) {
          if (interval.start > cursor) slots.push({ start: cursor, end: Math.min(interval.start, endMinute) });
          cursor = Math.max(cursor, interval.end);
          if (cursor >= endMinute) break;
        }
        if (cursor < endMinute) slots.push({ start: cursor, end: endMinute });
        const usable = slots.filter((slot) => slot.end - slot.start >= 30);
        return (
          <section className={`day-block ${index === 0 ? 'today-day' : ''}`} key={date}>
            <div className="day-heading"><strong>{formatArabicDate(date)}</strong><span>{usable.length ? 'فترات متاحة' : 'اليوم ممتلئ'}</span></div>
            <div className="free-slots">
              {usable.length ? usable.map((slot) => {
                const from = minutesToTime(slot.start);
                const to = minutesToTime(slot.end);
                return <button type="button" key={`${date}-${from}`} onClick={() => onUseSlot(date, from)}><strong>{from}–{to}</strong><small>{slot.end - slot.start} دقيقة · اضغطي لإضافة موعد</small></button>;
              }) : <span className="schedule-empty-row">مفيش فراغ 30 دقيقة أو أكثر</span>}
            </div>
            {unknown.length > 0 && <div className="free-warning">{unknown.length} حصة وقتها غير محدد؛ راجعيها قبل الاعتماد على الفراغات.</div>}
          </section>
        );
      })}
    </div>
  );
}

function EditSchedule({
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
  const sessions = [...data.sessions].sort((a, b) => (a.weekday ?? 99) - (b.weekday ?? 99) || compareSessionTime(a, b));
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

function ScheduleRow({ entry, onClick }: { entry: ScheduledEntry; onClick: () => void }) {
  const state = entry.status === 'completed' ? ' · تمت' : entry.status === 'cancelled' ? ' · ملغاة' : entry.status === 'missed' ? ' · فائتة' : '';
  return (
    <button type="button" className={`schedule-row schedule-row-button status-${entry.status}`} onClick={onClick}>
      <span className={`session-color type-${entry.session.sessionType}`} />
      <span><strong>{entry.session.title}</strong><small>{sessionTypeLabel(entry.session.sessionType)}{state}</small></span>
      <time>{entry.startTime ?? 'غير محدد'}</time>
    </button>
  );
}

function ScheduleTab({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return <button type="button" role="tab" aria-selected={active} className={active ? 'active' : ''} onClick={onClick}>{label}</button>;
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
      <article className="attention-card"><span>ملاحظات ذكية</span><h2>إيه اللي محتاج انتباهك؟</h2>{notes.length ? notes.map((note) => <p key={note}>{note}</p>) : <div className="stable-box"><strong>الصورة مستقرة</strong><small>مفيش حاجة ملحّة محتاجة مراجعة دلوقتي.</small></div>}</article>
      <article className="cash-card"><span>الصورة المسجلة</span><h2>الموجود في الحسابات</h2><strong>{money(balance, snapshot.workspace.currencyLabel)}</strong><small>المقبوض والدخل الآخر ناقص المصروفات المسجلة خلال الشهر.</small></article>

      <details className="settings-card">
        <summary>الطلاب</summary>
        <div className="settings-body">
          <button className="primary-small" type="button" onClick={onToggleAddStudent}>＋ إضافة طالب</button>
          {showAddStudent && <QuickForm title="طالب جديد" onSubmit={onStudentAdd} busy={busy}><input name="name" placeholder="اسم الطالب" required /><input name="guardianName" placeholder="ولي الأمر" /><input name="guardianPhone" placeholder="رقم الهاتف" inputMode="tel" /><input name="level" placeholder="المستوى" /><input name="notes" placeholder="ملاحظات" /></QuickForm>}
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

      <details className="settings-card"><summary>الحساب والمزامنة</summary><div className="settings-body"><CloudLinkPanel snapshot={snapshot} available={cloudAvailable} onLinked={onPlatformChanged} /></div></details>
      <details className="settings-card"><summary>نقل أو استعادة البيانات</summary><div className="settings-body"><Sozan1MigrationPanel workspaceId={snapshot.workspace.id} cloudLinked={Boolean(snapshot.cloudLink)} currencyLabel={snapshot.workspace.currencyLabel} onImported={onPlatformChanged} /></div></details>
    </section>
  );
}

function QuickForm({ title, onSubmit, busy, children }: { title: string; onSubmit: (form: FormData) => void | Promise<void>; busy: boolean; children: ReactNode }) {
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onSubmit(new FormData(event.currentTarget));
  };
  return <form className="quick-form" onSubmit={(event) => void submit(event)}><h3>{title}</h3>{children}<button className="form-submit" type="submit" disabled={busy}>{busy ? 'جاري الحفظ…' : 'حفظ'}</button></form>;
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

function scheduleEntriesForDate(data: SimpleWorkspaceData, date: string): ScheduledEntry[] {
  const weekday = weekdayForIso(date);
  const byId = new Map<string, ScheduledEntry>();

  for (const session of data.sessions) {
    if (session.scheduleStatus !== 'confirmed' || session.weekday !== weekday) continue;
    const occurrence = data.occurrences.find((row) => row.recurringSessionId === session.id && row.sessionDate === date) ?? null;
    if (occurrence?.rescheduledToDate && occurrence.rescheduledToDate !== date) continue;
    byId.set(session.id, {
      session,
      occurrence,
      date,
      startTime: validClockTime(occurrence?.scheduledStart) ? occurrence?.scheduledStart ?? null : validClockTime(session.startTime) ? session.startTime : null,
      status: occurrence?.status ?? 'scheduled',
    });
  }

  for (const occurrence of data.occurrences.filter((row) => row.rescheduledToDate === date)) {
    const session = data.sessions.find((row) => row.id === occurrence.recurringSessionId);
    if (!session) continue;
    byId.set(session.id, {
      session,
      occurrence,
      date,
      startTime: validClockTime(occurrence.rescheduledToStart) ? occurrence.rescheduledToStart : validClockTime(session.startTime) ? session.startTime : null,
      status: occurrence.status,
    });
  }

  return [...byId.values()].sort((a, b) => (a.startTime ?? '99:99').localeCompare(b.startTime ?? '99:99') || a.session.title.localeCompare(b.session.title, 'ar'));
}

function recentMoneyRows(data: SimpleWorkspaceData, currencyLabel: string) {
  return [
    ...data.receipts.map((row) => ({ id: `r-${row.id}`, date: row.receivedAt, kind: 'in' as const, title: data.students.find((student) => student.id === row.payerRefId)?.name ? `تحصيل من ${data.students.find((student) => student.id === row.payerRefId)?.name}` : 'تحصيل', value: `+ ${money(row.amountPence, currencyLabel)}` })),
    ...data.expenses.map((row) => ({ id: `e-${row.id}`, date: row.expenseDate, kind: 'out' as const, title: `مصروف · ${row.category}`, value: `− ${money(row.amountPence, currencyLabel)}` })),
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
}

function dueTotal(data: SimpleWorkspaceData): number {
  return data.billingCycles.filter((cycle) => cycle.status === 'due').reduce((total, cycle) => {
    const allocated = data.allocations.filter((row) => row.targetId === cycle.id).reduce((value, row) => value + row.amountPence, 0);
    return total + Math.max(0, cycle.pricePence - allocated);
  }, 0);
}

function packageProgress(data: SimpleWorkspaceData, studentId: string): string {
  const plan = planFor(data, studentId);
  const cycle = activeCycleFor(data, studentId);
  const done = cycle ? cycle.openingCompletedCount + cycle.realCompletedCount : 0;
  const size = cycle?.sessionLimit ?? plan?.packageSize ?? 8;
  return `${done}/${size}`;
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

function todayIso(): string { return localDate(new Date()); }

function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDate(date);
}

function startOfMonth(date: Date): Date { return new Date(date.getFullYear(), date.getMonth(), 1); }
function weekdayForIso(iso: string): number { return new Date(`${iso}T12:00:00`).getDay(); }
function validClockTime(value: string | null | undefined): boolean { return /^([01]\d|2[0-3]):[0-5]\d$/u.test(String(value ?? '')); }

function timeToMinutes(value: string | null | undefined): number | null {
  if (!validClockTime(value)) return null;
  const [hours, minutes] = String(value).split(':').map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function formatArabicDate(iso: string): string {
  return new Intl.DateTimeFormat('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${iso}T12:00:00`));
}

function formatShortDate(value: string): string {
  const iso = value.slice(0, 10);
  try { return new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'short' }).format(new Date(`${iso}T12:00:00`)); }
  catch { return iso; }
}

function greetingForHour(hour: number): string { return hour < 12 ? 'صباح الخير' : 'مساء الخير'; }

function messageFor(cause: unknown): string {
  const code = cause instanceof Error ? cause.message : 'UNKNOWN';
  const messages: Record<string, string> = {
    AMOUNT_INVALID: 'اكتبي مبلغًا صحيحًا.',
    EXPENSE_AMOUNT_INVALID: 'اكتبي مبلغ المصروف بشكل صحيح.',
    EXPENSE_CATEGORY_REQUIRED: 'اكتبي تصنيف المصروف.',
    BILLING_MODE_LOCKED_BY_HISTORY: 'لا يمكن تغيير نظام الحساب بعد وجود تاريخ مالي؛ يمكن تعديل تفاصيل الباقة نفسها.',
    OCCURRENCE_STATE_INVALID: 'حالة الحصة لا تسمح بهذا التعديل.',
    SESSION_NOT_FOUND: 'الموعد لم يعد موجودًا.',
    SCHEDULE_DAY_REQUIRED: 'اختاري يومًا للموعد المؤكد.',
    SCHEDULE_TIME_REQUIRED: 'اختاري وقتًا للموعد المؤكد.',
  };
  return messages[code] ?? `تعذر إكمال العملية (${code})`;
}
