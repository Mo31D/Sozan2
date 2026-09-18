import { useEffect, useState } from 'react';
import type { AppointmentStatus } from '../../modules/appointments/domain';
import type { LocalPlatformSnapshot } from '../adapters/indexeddb/platform.repository';
import { addLocalOtherIncome } from '../finance/extended-commands';
import { addLocalExpense } from '../finance/local-commands';
import { updateWorkspacePresentation } from '../platform/workspace-preferences';
import { NavButton } from '../shared/SimpleComponents';
import { toPence, todayIso } from '../shared/format';
import { runWorkspaceSync } from '../sync/engine';
import { pendingSyncCount } from '../sync/outbox';
import {
  collectAppointmentPayment,
  createAppointment,
  createAppointmentClient,
  loadAppointmentWorkspaceData,
  setAppointmentStatus,
  updateAppointment,
  type AppointmentWorkspaceData,
} from './local';
import {
  AppointmentsManagementScreen,
  AppointmentsMoneyScreen,
  AppointmentsScheduleScreen,
  AppointmentsTodayScreen,
  type AppointmentMoneyMode,
} from './AppointmentsScreens';

type AppointmentPage = 'today' | 'money' | 'schedule' | 'manage';

export function AppointmentsWorkspace({
  snapshot,
  cloudAvailable,
  onPlatformChanged,
  dataRevision,
}: {
  snapshot: LocalPlatformSnapshot;
  cloudAvailable: boolean;
  onPlatformChanged: () => Promise<void>;
  dataRevision: number;
}) {
  const workspaceId = snapshot.workspace.id;
  const [page, setPage] = useState<AppointmentPage>('today');
  const [data, setData] = useState<AppointmentWorkspaceData | null>(null);
  const [pendingSync, setPendingSync] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [moneyMode, setMoneyMode] = useState<AppointmentMoneyMode>('none');
  const [openAddSchedule, setOpenAddSchedule] = useState(false);
  const [scheduleKey, setScheduleKey] = useState(0);

  const refresh = async () => {
    const [nextData, nextPending] = await Promise.all([
      loadAppointmentWorkspaceData(workspaceId),
      pendingSyncCount(workspaceId),
    ]);
    setData(nextData);
    setPendingSync(nextPending);
  };

  useEffect(() => {
    void refresh();
    // Refresh cloud-backed data in place. Do not remount the workspace because
    // remounting resets the active page to "today".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, dataRevision]);

  const syncAfterWrite = async () => {
    if (snapshot.cloudLink && navigator.onLine) {
      try {
        await runWorkspaceSync(workspaceId);
      } catch {
        // Local state is durable. The outbox retains mutations for a later retry.
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
      setError(appointmentErrorText(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const moveTo = (next: AppointmentPage) => {
    setOpenAddSchedule(false);
    setPage(next);
    setNotice('');
    setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openScheduleForAdd = () => {
    setOpenAddSchedule(true);
    setScheduleKey((value) => value + 1);
    setPage('schedule');
    setNotice('');
    setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openMoneyForReceipt = () => {
    setMoneyMode('receipt');
    setPage('money');
    setNotice('');
    setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const changeStatus = (appointmentId: string, status: AppointmentStatus, success: string) =>
    runAction(() => setAppointmentStatus(workspaceId, appointmentId, status), success);

  const collect = (form: FormData, appointmentId?: string | null) => runAction(async () => {
    await collectAppointmentPayment({
      workspaceId,
      clientId: String(form.get('clientId') ?? ''),
      amountPence: toPence(form.get('amount')),
      receivedAt: String(form.get('receivedAt') ?? todayIso()),
      paymentMethod: String(form.get('paymentMethod') ?? 'cash') as 'cash' | 'bank' | 'wallet' | 'other',
      note: String(form.get('note') ?? ''),
      appointmentId: appointmentId ?? null,
    });
  }, 'تم تسجيل التحصيل.');

  if (!data) return <div className="simple-loading">جاري تجهيز المواعيد…</div>;

  return (
    <main className="simple-app appointments-app" dir="rtl">
      <div className="simple-content">
        {notice && <div className="simple-toast good">{notice}</div>}
        {error && <div className="simple-toast bad">{error}</div>}

        {page === 'today' && (
          <AppointmentsTodayScreen
            snapshot={snapshot}
            data={data}
            busy={busy}
            onStatus={changeStatus}
            onCollect={collect}
            onOpenMoney={openMoneyForReceipt}
            onOpenSchedule={openScheduleForAdd}
          />
        )}

        {page === 'money' && (
          <AppointmentsMoneyScreen
            snapshot={snapshot}
            data={data}
            mode={moneyMode}
            busy={busy}
            onMode={setMoneyMode}
            onCollect={(form) => collect(form, null)}
            onExpense={(form) => runAction(async () => {
              await addLocalExpense({
                workspaceId,
                expenseDate: String(form.get('expenseDate') ?? todayIso()),
                scope: String(form.get('scope') ?? 'business') as 'business' | 'personal',
                category: String(form.get('category') ?? ''),
                amountPence: toPence(form.get('amount')),
                note: String(form.get('note') ?? ''),
              });
            }, 'تم تسجيل المصروف.')}
            onIncome={(form) => runAction(async () => {
              await addLocalOtherIncome({
                workspaceId,
                incomeDate: String(form.get('incomeDate') ?? todayIso()),
                category: String(form.get('category') ?? ''),
                amountPence: toPence(form.get('amount')),
                note: String(form.get('note') ?? ''),
              });
            }, 'تم تسجيل الدخل.')}
          />
        )}

        {page === 'schedule' && (
          <AppointmentsScheduleScreen
            key={`appointments-schedule-${scheduleKey}`}
            snapshot={snapshot}
            data={data}
            busy={busy}
            openAddOnMount={openAddSchedule}
            onAdd={(form) => runAction(async () => {
              const clientId = String(form.get('clientId') ?? '') || null;
              await createAppointment(workspaceId, {
                clientId,
                title: String(form.get('title') ?? ''),
                appointmentDate: String(form.get('appointmentDate') ?? todayIso()),
                startTime: String(form.get('startTime') ?? '') || null,
                durationMinutes: Number(form.get('durationMinutes') ?? 60),
                travelMinutes: Number(form.get('travelMinutes') ?? 0),
                location: String(form.get('location') ?? ''),
                pricePence: toPence(form.get('price'), true),
                note: String(form.get('note') ?? ''),
              });
              setOpenAddSchedule(false);
            }, 'تم حفظ الموعد.')}
            onUpdate={(appointmentId, form) => runAction(async () => {
              const clientId = String(form.get('clientId') ?? '') || null;
              await updateAppointment(workspaceId, appointmentId, {
                clientId,
                title: String(form.get('title') ?? ''),
                appointmentDate: String(form.get('appointmentDate') ?? todayIso()),
                startTime: String(form.get('startTime') ?? '') || null,
                durationMinutes: Number(form.get('durationMinutes') ?? 60),
                travelMinutes: Number(form.get('travelMinutes') ?? 0),
                location: String(form.get('location') ?? '') || null,
                pricePence: toPence(form.get('price'), true),
                note: String(form.get('note') ?? '') || null,
              });
            }, 'تم تعديل الموعد.')}
            onStatus={changeStatus}
          />
        )}

        {page === 'manage' && (
          <AppointmentsManagementScreen
            snapshot={snapshot}
            data={data}
            cloudAvailable={cloudAvailable}
            pendingSync={pendingSync}
            busy={busy}
            onPlatformChanged={async () => {
              await onPlatformChanged();
              await refresh();
            }}
            onPresentationSave={async (form) => {
              const ok = await runAction(async () => {
                await updateWorkspacePresentation(snapshot, {
                  displayName: String(form.get('displayName') ?? ''),
                  workspaceName: String(form.get('workspaceName') ?? ''),
                  currencyCode: String(form.get('currencyCode') ?? ''),
                  currencyLabel: String(form.get('currencyLabel') ?? ''),
                });
              }, 'تم حفظ البيانات.');
              if (ok) await onPlatformChanged();
              return ok;
            }}
            onAddClient={(form) => runAction(async () => {
              await createAppointmentClient(workspaceId, {
                name: String(form.get('name') ?? ''),
                phone: String(form.get('phone') ?? ''),
                notes: String(form.get('notes') ?? ''),
              });
            }, 'تمت إضافة العميل.')}
            onOpenSchedule={openScheduleForAdd}
          />
        )}
      </div>

      <nav className="simple-bottom-nav" aria-label="التنقل الرئيسي">
        <NavButton active={page === 'today'} label="اليوم" icon="⌂" onClick={() => moveTo('today')} />
        <NavButton active={page === 'money'} label="فلوسي" icon="▣" onClick={() => moveTo('money')} />
        <NavButton active={page === 'schedule'} label="المواعيد" icon="▦" onClick={() => moveTo('schedule')} />
        <NavButton active={page === 'manage'} label="إدارة" icon="☰" onClick={() => moveTo('manage')} />
      </nav>
    </main>
  );
}

function appointmentErrorText(cause: unknown): string {
  const code = cause instanceof Error ? cause.message : 'UNKNOWN';
  const messages: Record<string, string> = {
    AMOUNT_INVALID: 'اكتب مبلغًا صحيحًا.',
    COLLECTION_AMOUNT_INVALID: 'اكتب مبلغ التحصيل بشكل صحيح.',
    CLIENT_NAME_REQUIRED: 'اكتب اسم العميل.',
    CLIENT_NOT_FOUND: 'العميل لم يعد موجودًا أو غير متاح.',
    APPOINTMENT_TITLE_REQUIRED: 'اكتب اسم الخدمة أو سبب الموعد.',
    APPOINTMENT_DATE_REQUIRED: 'اختر تاريخًا صحيحًا للموعد.',
    APPOINTMENT_TIME_INVALID: 'اختر وقتًا صحيحًا للموعد.',
    APPOINTMENT_DURATION_INVALID: 'مدة الموعد غير صحيحة.',
    APPOINTMENT_TRAVEL_INVALID: 'وقت الانتقال غير صحيح.',
    APPOINTMENT_NOT_FOUND: 'الموعد لم يعد موجودًا.',
    APPOINTMENT_CLIENT_MISMATCH: 'التحصيل المرتبط بالموعد لازم يكون لنفس العميل المسجل على الموعد.',
    APPOINTMENT_CLIENT_LOCKED_BY_COLLECTION: 'لا يمكن تغيير عميل هذا الموعد بعد وجود تحصيل مرتبط به. عدّل التحصيل أولًا من السجل المالي.',
    FUTURE_APPOINTMENT_COMPLETION_NOT_ALLOWED: 'لا يمكن تسجيل موعد مستقبلي كمكتمل قبل يومه.',
    COMPLETED_APPOINTMENT_REQUIRES_REOPEN: 'الموعد مكتمل؛ أعد فتحه أولًا قبل تغيير العميل أو السعر أو الوقت أو مدة الخدمة.',
    EXPENSE_AMOUNT_INVALID: 'اكتب مبلغ المصروف بشكل صحيح.',
    EXPENSE_CATEGORY_REQUIRED: 'اكتب تصنيف المصروف.',
    INCOME_CATEGORY_REQUIRED: 'اكتب مصدر الدخل أو تصنيفه.',
    DISPLAY_NAME_REQUIRED: 'اكتب اسمك.',
    WORKSPACE_NAME_REQUIRED: 'اكتب اسم شغلك.',
  };
  return messages[code] ?? `تعذر إكمال العملية (${code})`;
}
