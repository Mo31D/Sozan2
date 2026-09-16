import { useEffect, useState } from 'react';
import { SessionsService } from '../../modules/tutoring/services/sessions.service';
import { StudentsService } from '../../modules/tutoring/services/students.service';
import type { LocalPlatformSnapshot } from '../adapters/indexeddb/platform.repository';
import { IndexedDbSessionRepository } from '../adapters/indexeddb/tutoring-sessions.repository';
import { IndexedDbStudentRepository } from '../adapters/indexeddb/tutoring-students.repository';
import { addLocalExpense } from '../finance/local-commands';
import { runWorkspaceSync } from '../sync/engine';
import { pendingSyncCount } from '../sync/outbox';
import {
  runAttendanceWorkflow,
  type AttendanceWorkflowAction,
} from '../tutoring/attendance-workflow';
import { collectLocalStudentPayment, configureLocalStudentBilling } from '../tutoring/local-commands';
import { loadSimpleWorkspaceData, type SimpleWorkspaceData } from './data';
import { NavButton } from './v2/components';
import { MeScreen } from './v2/screens/MeScreen';
import { MoneyScreen } from './v2/screens/MoneyScreen';
import { ScheduleScreen } from './v2/screens/ScheduleScreen';
import { TodayScreen } from './v2/screens/TodayScreen';
import type { MoneyMode, PageKey } from './v2/types';
import { messageFor, todayIso, toPence } from './v2/utils';

const studentsService = new StudentsService(new IndexedDbStudentRepository(), crypto.randomUUID);
const sessionsService = new SessionsService(new IndexedDbSessionRepository(), crypto.randomUUID);

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
      // A cross-module workflow may have committed its first durable step before a later
      // step failed. Reload local truth before reporting the recoverable error.
      await refresh();
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

  const runAttendance = (action: AttendanceWorkflowAction, success: string) =>
    runAction(() => runAttendanceWorkflow(workspaceId, action), success);

  if (!data) return <div className="simple-loading">جاري تجهيز بياناتك…</div>;

  return (
    <main className="simple-app" dir="rtl">
      <div className="simple-content">
        {notice && <div className="simple-toast good">{notice}</div>}
        {error && <div className="simple-toast bad">{error}</div>}

        {page === 'today' && (
          <TodayScreen
            snapshot={snapshot}
            data={data}
            busy={busy}
            onOpenMoney={openMoney}
            onAttendance={runAttendance}
          />
        )}

        {page === 'money' && (
          <MoneyScreen
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
          <ScheduleScreen
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
          <MeScreen
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
