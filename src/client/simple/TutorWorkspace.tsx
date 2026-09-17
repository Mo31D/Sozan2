import { useEffect, useState } from 'react';
import { SessionsService } from '../../modules/tutoring/services/sessions.service';
import { StudentsService } from '../../modules/tutoring/services/students.service';
import type { LocalPlatformSnapshot } from '../adapters/indexeddb/platform.repository';
import { IndexedDbSessionRepository } from '../adapters/indexeddb/tutoring-sessions.repository';
import { IndexedDbStudentRepository } from '../adapters/indexeddb/tutoring-students.repository';
import { ControlCenter } from '../control/ControlCenter';
import type { ControlTab } from '../control/contracts';
import { addLocalExpense } from '../finance/local-commands';
import { resolveWorkspacePresentation, updateWorkspacePresentation } from '../platform/workspace-preferences';
import { runWorkspaceSync } from '../sync/engine';
import { pendingSyncCount } from '../sync/outbox';
import {
  runAttendanceWorkflow,
  type AttendanceWorkflowAction,
} from '../tutoring/attendance-workflow';
import { collectLocalStudentPayment, configureLocalStudentBilling } from '../tutoring/local-commands';
import { updateLocalSessionDetails } from '../tutoring/session-corrections';
import { updateLocalStudent } from '../tutoring/student-corrections';
import { loadSimpleWorkspaceData, type SimpleWorkspaceData } from './data';
import { NavButton } from './v2/components';
import { ManagementScreen } from './v2/screens/ManagementScreen';
import { MoneyScreen } from './v2/screens/MoneyScreen';
import { ScheduleScreen } from './v2/screens/ScheduleScreen';
import { StudentHub } from './v2/screens/StudentHub';
import { TodayScreen } from './v2/screens/TodayScreen';
import type { MoneyMode, PageKey, ScheduleMode } from './v2/types';
import { messageFor, startOfMonth, todayIso, toPence } from './v2/utils';

const studentsService = new StudentsService(new IndexedDbStudentRepository(), crypto.randomUUID);
const sessionsService = new SessionsService(new IndexedDbSessionRepository(), crypto.randomUUID);

export function TutorWorkspace({
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
  const [selectedDay, setSelectedDay] = useState(todayIso());
  const [openedFromSchedule, setOpenedFromSchedule] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>('week');
  const [scheduleMonthCursor, setScheduleMonthCursor] = useState(() => startOfMonth(new Date()));
  const [openPendingSchedule, setOpenPendingSchedule] = useState(false);
  const [data, setData] = useState<SimpleWorkspaceData | null>(null);
  const [pendingSync, setPendingSync] = useState(0);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [moneyMode, setMoneyMode] = useState<MoneyMode>('none');
  const [showAddStudent, setShowAddStudent] = useState(false);
  const [advancedTab, setAdvancedTab] = useState<ControlTab | null>(null);
  const [studentHubId, setStudentHubId] = useState<string | null>(null);

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
    // Workspace identity is the only trigger; refresh itself is deliberately not memoized.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  const syncAfterWrite = async () => {
    if (snapshot.cloudLink && navigator.onLine) {
      try {
        await runWorkspaceSync(workspaceId);
      } catch {
        // Local writes are durable and remain queued in the outbox.
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
      await syncAfterWrite();
      setNotice(success);
      return true;
    } catch (cause) {
      await refresh();
      setError(messageFor(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const openStudent = (studentId: string) => {
    setStudentHubId(studentId);
    setNotice('');
    setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openMoney = (mode: Exclude<MoneyMode, 'none'>) => {
    setStudentHubId(null);
    setOpenedFromSchedule(false);
    setMoneyMode(mode);
    setPage('money');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const moveTo = (next: PageKey) => {
    setStudentHubId(null);
    if (next === 'today') {
      setSelectedDay(todayIso());
      setOpenedFromSchedule(false);
    } else if (next !== 'schedule') {
      setOpenedFromSchedule(false);
    }
    if (next === 'schedule') setOpenPendingSchedule(false);
    setPage(next);
    setNotice('');
    setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openDay = (date: string) => {
    setStudentHubId(null);
    setSelectedDay(date);
    setOpenedFromSchedule(true);
    setPage('today');
    setNotice('');
    setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const backToSchedule = () => {
    setStudentHubId(null);
    setPage('schedule');
    setNotice('');
    setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openPendingScheduleEdits = () => {
    setStudentHubId(null);
    setOpenPendingSchedule(true);
    setScheduleMode('edit');
    setOpenedFromSchedule(false);
    setPage('schedule');
    setNotice('');
    setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const runAttendance = (action: AttendanceWorkflowAction, success: string) =>
    runAction(() => runAttendanceWorkflow(workspaceId, action), success);

  if (!data) return <div className="simple-loading">جاري تجهيز بياناتك…</div>;

  const presentation = resolveWorkspacePresentation(snapshot, data.workspaceSettings);
  const presentedSnapshot: LocalPlatformSnapshot = {
    ...snapshot,
    user: { ...snapshot.user, displayName: presentation.displayName },
    workspace: {
      ...snapshot.workspace,
      name: presentation.workspaceName,
      currencyCode: presentation.currencyCode,
      currencyLabel: presentation.currencyLabel,
    },
  };
  const assistantLabel = `مساعد ${presentation.displayName}`;

  const platformChanged = async () => {
    await onPlatformChanged();
    await refresh();
  };

  const saveStudent = (studentId: string, form: FormData) => runAction(async () => {
    await updateLocalStudent(workspaceId, studentId, {
      name: String(form.get('name') ?? ''),
      age: form.get('age') ? Number(form.get('age')) : null,
      guardianName: String(form.get('guardianName') ?? ''),
      guardianPhone: String(form.get('guardianPhone') ?? ''),
      level: String(form.get('level') ?? ''),
      notes: String(form.get('notes') ?? ''),
    });
  }, 'تم تعديل بيانات الطالب.');

  const saveStudentSession = (sessionId: string, form: FormData) => runAction(async () => {
    const current = data.sessions.find((session) => session.id === sessionId);
    if (!current) throw new Error('SESSION_NOT_FOUND');
    const status = String(form.get('scheduleStatus') ?? current.scheduleStatus) as 'confirmed' | 'pending';
    const weekdayRaw = String(form.get('weekday') ?? '');
    const timeRaw = String(form.get('startTime') ?? '');
    const submittedStudentIds = form.getAll('studentIds').map(String).filter(Boolean);
    await updateLocalSessionDetails(workspaceId, sessionId, {
      title: String(form.get('title') ?? current.title),
      sessionType: String(form.get('sessionType') ?? current.sessionType) as typeof current.sessionType,
      scheduleStatus: status,
      weekday: weekdayRaw === '' ? null : Number(weekdayRaw),
      startTime: timeRaw || null,
      durationMinutes: Number(form.get('durationMinutes') ?? current.durationMinutes),
      travelMinutes: Number(form.get('travelMinutes') ?? current.travelMinutes),
      location: String(form.get('location') ?? current.location ?? '') || null,
      priceBasis: String(form.get('priceBasis') ?? current.priceBasis) as typeof current.priceBasis,
      defaultPricePence: form.has('price') ? toPence(form.get('price'), true) : current.defaultPricePence,
      expectedStudentCount: Number(form.get('expectedStudentCount') ?? current.expectedStudentCount),
      centerCutBps: form.has('centerCut') ? Math.round(Number(form.get('centerCut') ?? 0) * 100) : current.centerCutBps,
      studentIds: submittedStudentIds.length ? submittedStudentIds : current.studentIds,
    });
  }, 'تم تعديل بيانات الحصة القادمة.');

  const saveStudentBilling = (studentId: string, form: FormData) => runAction(async () => {
    const billingMode = String(form.get('billingMode') ?? 'per_session') as 'per_session' | 'package';
    if (billingMode === 'per_session') {
      await configureLocalStudentBilling(workspaceId, studentId, {
        billingMode: 'per_session',
        effectiveFrom: String(form.get('effectiveFrom') ?? todayIso()),
      });
      return;
    }
    await configureLocalStudentBilling(workspaceId, studentId, {
      billingMode: 'package',
      packageSize: Number(form.get('packageSize') ?? 8),
      packagePricePence: toPence(form.get('packagePrice'), true),
      openingCompletedCount: Number(form.get('openingCompletedCount') ?? 0),
      effectiveFrom: String(form.get('effectiveFrom') ?? todayIso()),
      cycleAnchorDate: null,
    });
  }, 'تم حفظ نظام حساب الطالب.');

  const collectForStudent = (studentId: string, form: FormData) => runAction(async () => {
    await collectLocalStudentPayment({
      workspaceId,
      studentId,
      amountPence: toPence(form.get('amount')),
      receivedAt: String(form.get('receivedAt') ?? todayIso()),
      paymentMethod: String(form.get('paymentMethod') ?? 'cash') as 'cash' | 'bank' | 'wallet' | 'other',
      note: String(form.get('note') ?? ''),
    });
  }, 'تم تسجيل التحصيل.');

  return (
    <>
      <main className="simple-app" dir="rtl">
        <div className="simple-content">
          {notice && <div className="simple-toast good">{notice}</div>}
          {error && <div className="simple-toast bad">{error}</div>}

          {studentHubId ? (
            <StudentHub
              key={studentHubId}
              snapshot={presentedSnapshot}
              data={data}
              studentId={studentHubId}
              busy={busy}
              onBack={() => { setStudentHubId(null); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              onOpenStudent={openStudent}
              onStudentSave={saveStudent}
              onSessionSave={saveStudentSession}
              onBillingSave={saveStudentBilling}
              onCollect={collectForStudent}
              onOpenAdvanced={setAdvancedTab}
            />
          ) : (
            <>
              {page === 'today' && (
                <TodayScreen
                  snapshot={presentedSnapshot}
                  data={data}
                  date={selectedDay}
                  busy={busy}
                  assistantLabel={assistantLabel}
                  openedFromSchedule={openedFromSchedule}
                  onOpenMoney={openMoney}
                  onOpenStudent={openStudent}
                  onAttendance={runAttendance}
                  onBackToToday={() => {
                    setSelectedDay(todayIso());
                    setOpenedFromSchedule(false);
                  }}
                  onBackToSchedule={backToSchedule}
                />
              )}

              {page === 'money' && (
                <MoneyScreen
                  snapshot={presentedSnapshot}
                  data={data}
                  mode={moneyMode}
                  busy={busy}
                  assistantLabel={assistantLabel}
                  onMode={setMoneyMode}
                  onOpenStudent={openStudent}
                  onOpenAdvanced={setAdvancedTab}
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
                <ScheduleScreen
                  data={data}
                  busy={busy}
                  mode={scheduleMode}
                  assistantLabel={assistantLabel}
                  onMode={setScheduleMode}
                  monthCursor={scheduleMonthCursor}
                  onMonthCursor={setScheduleMonthCursor}
                  openPendingOnMount={openPendingSchedule}
                  onOpenDay={openDay}
                  onOpenStudent={openStudent}
                  onAdd={async (form) => runAction(async () => {
                    const pending = String(form.get('scheduleStatus') ?? 'confirmed') === 'pending';
                    const weekdayRaw = String(form.get('weekday') ?? '');
                    const studentIds = form.getAll('studentIds').map(String);
                    const expectedCount = Math.max(1, Number(form.get('expectedStudentCount') ?? (studentIds.length || 1)));
                    await sessionsService.create(workspaceId, {
                      title: String(form.get('title') ?? ''),
                      sessionType: String(form.get('sessionType') ?? 'private_student_home'),
                      scheduleStatus: pending ? 'pending' : 'confirmed',
                      weekday: weekdayRaw === '' ? null : Number(weekdayRaw),
                      startTime: pending ? null : String(form.get('startTime') ?? ''),
                      durationMinutes: Number(form.get('durationMinutes') ?? 90),
                      travelMinutes: Number(form.get('travelMinutes') ?? 30),
                      location: String(form.get('location') ?? ''),
                      priceBasis: String(form.get('priceBasis') ?? 'total_session') as 'total_session' | 'per_student',
                      defaultPricePence: toPence(form.get('price'), true),
                      expectedStudentCount: expectedCount,
                      centerCutBps: Math.round(Number(form.get('centerCut') ?? 0) * 100),
                      studentIds,
                    });
                  }, 'تم حفظ الموعد.')}
                  onUpdate={saveStudentSession}
                />
              )}

              {page === 'manage' && (
                <ManagementScreen
                  snapshot={presentedSnapshot}
                  data={data}
                  cloudAvailable={cloudAvailable}
                  pendingSync={pendingSync}
                  busy={busy}
                  showAddStudent={showAddStudent}
                  onToggleAddStudent={() => setShowAddStudent((value) => !value)}
                  onOpenPendingSchedule={openPendingScheduleEdits}
                  onOpenStudent={openStudent}
                  onOpenAdvanced={setAdvancedTab}
                  onPlatformChanged={platformChanged}
                  onPresentationSave={async (form) => {
                    const ok = await runAction(() => updateWorkspacePresentation(snapshot, {
                      displayName: String(form.get('displayName') ?? ''),
                      workspaceName: String(form.get('workspaceName') ?? ''),
                      currencyCode: String(form.get('currencyCode') ?? ''),
                      currencyLabel: String(form.get('currencyLabel') ?? ''),
                    }), 'تم حفظ بياناتك.');
                    if (ok) await onPlatformChanged();
                    return ok;
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
            </>
          )}
        </div>

        <nav className="simple-bottom-nav" aria-label="التنقل الرئيسي">
          <NavButton active={page === 'today' && !openedFromSchedule} label="اليوم" icon="⌂" onClick={() => moveTo('today')} />
          <NavButton active={page === 'money'} label="فلوسي" icon="▣" onClick={() => moveTo('money')} />
          <NavButton active={page === 'schedule' || (page === 'today' && openedFromSchedule)} label="جدولي" icon="▦" onClick={() => moveTo('schedule')} />
          <NavButton active={page === 'manage'} label="إدارة" icon="☰" onClick={() => moveTo('manage')} />
        </nav>
      </main>

      <ControlCenter
        snapshot={presentedSnapshot}
        onChanged={refresh}
        externallyOpen={advancedTab !== null}
        requestedTab={advancedTab}
        showLauncher={false}
        onClose={() => setAdvancedTab(null)}
      />
    </>
  );
}
