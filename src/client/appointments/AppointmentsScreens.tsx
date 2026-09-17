import { useMemo, useState } from 'react';
import type { AppointmentItem, AppointmentStatus } from '../../modules/appointments/domain';
import { buildAppointmentReport } from '../../modules/reports/appointments';
import { reportRangeForPreset, type ReportPreset } from '../../modules/reports/insights';
import type { LocalPlatformSnapshot } from '../adapters/indexeddb/platform.repository';
import { CloudLinkPanel } from '../cloud/CloudAccess';
import { resolveWorkspacePresentation } from '../platform/workspace-preferences';
import {
  formatArabicDate,
  formatClockTime,
  formatDurationArabic,
  formatShortDate,
  greetingForHour,
  localDate,
  money,
  sum,
  todayIso,
} from '../shared/format';
import { Metric, QuickForm, ScreenHeader, SectionTitle } from '../shared/SimpleComponents';
import { ArabicDateField, ArabicTimeField } from '../simple/v2/localized-fields';
import type { AppointmentWorkspaceData } from './local';
import {
  appointmentsForDate,
  clientName,
  currentAppointmentDue,
  currentClientDue,
  recentAppointmentMoneyRows,
  upcomingAppointments,
} from './presentation';

export type AppointmentMoneyMode = 'none' | 'receipt' | 'expense' | 'income';

export function AppointmentsTodayScreen({
  snapshot,
  data,
  busy,
  onStatus,
  onCollect,
  onOpenMoney,
  onOpenSchedule,
}: {
  snapshot: LocalPlatformSnapshot;
  data: AppointmentWorkspaceData;
  busy: boolean;
  onStatus: (appointmentId: string, status: AppointmentStatus, message: string) => Promise<boolean>;
  onCollect: (form: FormData, appointmentId?: string | null) => Promise<boolean>;
  onOpenMoney: () => void;
  onOpenSchedule: () => void;
}) {
  const today = todayIso();
  const presentation = resolveWorkspacePresentation(snapshot, data.workspaceSettings);
  const monthReport = buildAppointmentReport(data, reportRangeForPreset('month', today));
  const todayRows = appointmentsForDate(data, today);
  const due = currentAppointmentDue(data);

  return (
    <section className="simple-screen appointments-today">
      <ScreenHeader kicker={`مساعد ${presentation.displayName}`} title="اليوم" />
      <article className="today-hero">
        <div className="today-hero-top">
          <div>
            <strong>{greetingForHour(new Date().getHours())} يا {presentation.displayName}</strong>
            <span>{formatArabicDate(today)}</span>
            <small>صافي الحركة هذا الشهر</small>
          </div>
          <span className="spark">✦</span>
        </div>
        <div className="hero-money">{money(monthReport.netCashPence, presentation.currencyLabel)}</div>
        <div className="hero-split">
          <div><span>قبضت</span><strong>{money(monthReport.receivedPence + monthReport.otherIncomePence, presentation.currencyLabel)}</strong></div>
          <div><span>صرفت</span><strong>{money(monthReport.expensesPence, presentation.currencyLabel)}</strong></div>
        </div>
      </article>

      <div className="quick-actions">
        <button type="button" onClick={onOpenSchedule}><b>＋</b><span><strong>موعد جديد</strong><small>عميل، وقت، سعر</small></span></button>
        <button type="button" onClick={onOpenMoney}><b>£</b><span><strong>قبضت فلوس</strong><small>سجلّي التحصيل بسرعة</small></span></button>
      </div>

      <article className="due-card">
        <div><span>مطلوب تحصيله الآن</span><strong>{money(due, presentation.currencyLabel)}</strong></div>
        <span className="due-status">{due > 0 ? 'متابعة' : 'تمام'}</span>
      </article>

      <SectionTitle eyebrow="مواعيد اليوم" title={todayRows.length ? `${todayRows.length} موعد` : 'يوم هادي'} />
      <div className="appointment-list">
        {todayRows.map((appointment) => (
          <AppointmentCard
            key={appointment.id}
            appointment={appointment}
            data={data}
            currency={presentation.currencyLabel}
            busy={busy}
            onStatus={onStatus}
            onCollect={onCollect}
          />
        ))}
        {!todayRows.length && <div className="friendly-empty">مفيش مواعيد مسجلة لليوم.</div>}
      </div>
    </section>
  );
}

export function AppointmentsMoneyScreen({
  snapshot,
  data,
  mode,
  busy,
  onMode,
  onCollect,
  onExpense,
  onIncome,
}: {
  snapshot: LocalPlatformSnapshot;
  data: AppointmentWorkspaceData;
  mode: AppointmentMoneyMode;
  busy: boolean;
  onMode: (mode: AppointmentMoneyMode) => void;
  onCollect: (form: FormData) => Promise<boolean>;
  onExpense: (form: FormData) => Promise<boolean>;
  onIncome: (form: FormData) => Promise<boolean>;
}) {
  const today = todayIso();
  const presentation = resolveWorkspacePresentation(snapshot, data.workspaceSettings);
  const report = buildAppointmentReport(data, reportRangeForPreset('month', today));
  const recent = recentAppointmentMoneyRows(data, presentation.currencyLabel);

  return (
    <section className="simple-screen">
      <ScreenHeader kicker={`مساعد ${presentation.displayName}`} title="فلوسي" />
      <div className="screen-action-row">
        <button className="primary-small" type="button" onClick={() => onMode(mode === 'receipt' ? 'none' : 'receipt')}>＋ تحصيل</button>
        <button className="secondary-small" type="button" onClick={() => onMode(mode === 'expense' ? 'none' : 'expense')}>− مصروف</button>
        <button className="secondary-small" type="button" onClick={() => onMode(mode === 'income' ? 'none' : 'income')}>＋ دخل آخر</button>
      </div>

      {mode === 'receipt' && (
        <QuickForm title="سجّل التحصيل" busy={busy} onSubmit={async (form) => { if (await onCollect(form)) onMode('none'); }}>
          <select name="clientId" defaultValue="" required>
            <option value="" disabled>اختار العميل</option>
            {data.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
          </select>
          <input name="amount" type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="المبلغ" required />
          <ArabicDateField name="receivedAt" defaultValue={today} ariaLabel="تاريخ التحصيل" />
          <select name="paymentMethod" defaultValue="cash"><option value="cash">كاش</option><option value="bank">بنك</option><option value="wallet">محفظة</option><option value="other">أخرى</option></select>
          <input name="note" placeholder="ملاحظة اختيارية" />
        </QuickForm>
      )}

      {mode === 'expense' && (
        <QuickForm title="سجّل المصروف" busy={busy} onSubmit={async (form) => { if (await onExpense(form)) onMode('none'); }}>
          <input name="amount" type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="المبلغ" required />
          <ArabicDateField name="expenseDate" defaultValue={today} ariaLabel="تاريخ المصروف" />
          <select name="scope" defaultValue="business"><option value="business">شغل</option><option value="personal">شخصي</option></select>
          <input name="category" placeholder="التصنيف: مواصلات، أدوات…" required />
          <input name="note" placeholder="ملاحظة اختيارية" />
        </QuickForm>
      )}

      {mode === 'income' && (
        <QuickForm title="سجّل دخلًا آخر" busy={busy} onSubmit={async (form) => { if (await onIncome(form)) onMode('none'); }}>
          <input name="amount" type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="المبلغ" required />
          <ArabicDateField name="incomeDate" defaultValue={today} ariaLabel="تاريخ الدخل" />
          <input name="category" placeholder="المصدر أو التصنيف" required />
          <input name="note" placeholder="ملاحظة اختيارية" />
        </QuickForm>
      )}

      <SectionTitle eyebrow="هذا الشهر" title="الصورة المالية" />
      <div className="money-grid">
        <Metric label="قبضت" value={money(report.receivedPence, presentation.currencyLabel)} />
        <Metric label="دخل آخر" value={money(report.otherIncomePence, presentation.currencyLabel)} />
        <Metric label="صرفت" value={money(report.expensesPence, presentation.currencyLabel)} />
        <Metric label="مطلوب الآن" value={money(report.duePence, presentation.currencyLabel)} accent />
      </div>

      <SectionTitle eyebrow="العملاء" title="مين عليه فلوس؟" />
      <div className="appointment-client-balances">
        {data.clients.map((client) => {
          const due = currentClientDue(data, client.id);
          const received = sum(data.receipts.filter((row) => row.payerRefType === 'appointments.client' && row.payerRefId === client.id).map((row) => row.amountPence));
          return (
            <article className="student-money-row" key={client.id}>
              <div className="avatar-circle">{client.name.trim().charAt(0)}</div>
              <div><strong>{client.name}</strong><small>{received ? `دفع ${money(received, presentation.currencyLabel)}` : 'لا يوجد تحصيل مسجل'}</small></div>
              <div className="student-money-status"><span className={due ? 'needs' : 'ok'}>{due ? money(due, presentation.currencyLabel) : 'تمام'}</span></div>
            </article>
          );
        })}
        {!data.clients.length && <div className="friendly-empty">أضيفي أول عميل من «إدارة».</div>}
      </div>

      <SectionTitle eyebrow="آخر حركة" title="المقبوض والمصروف" />
      <div className="activity-list">
        {recent.map((row) => <div className="activity-row" key={row.id}><div><strong>{row.title}</strong><small>{formatShortDate(row.date)}</small></div><b className={row.kind}>{row.value}</b></div>)}
        {!recent.length && <div className="friendly-empty">لسه مفيش حركة مالية مسجلة.</div>}
      </div>
    </section>
  );
}

export function AppointmentsScheduleScreen({
  snapshot,
  data,
  busy,
  openAddOnMount,
  onAdd,
  onUpdate,
  onStatus,
}: {
  snapshot: LocalPlatformSnapshot;
  data: AppointmentWorkspaceData;
  busy: boolean;
  openAddOnMount?: boolean;
  onAdd: (form: FormData) => Promise<boolean>;
  onUpdate: (appointmentId: string, form: FormData) => Promise<boolean>;
  onStatus: (appointmentId: string, status: AppointmentStatus, message: string) => Promise<boolean>;
}) {
  const presentation = resolveWorkspacePresentation(snapshot, data.workspaceSettings);
  const today = todayIso();
  const [showAdd, setShowAdd] = useState(Boolean(openAddOnMount));
  const [cursor, setCursor] = useState(() => new Date(`${today.slice(0, 7)}-01T12:00:00`));
  const [selectedDate, setSelectedDate] = useState(today);
  const [editingId, setEditingId] = useState<string | null>(null);
  const selectedRows = appointmentsForDate(data, selectedDate);
  const editing = data.appointments.find((row) => row.id === editingId) ?? null;

  const moveMonth = (delta: number) => {
    const next = new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1);
    setCursor(next);
    setSelectedDate(localDate(next));
    setEditingId(null);
  };

  return (
    <section className="simple-screen appointments-schedule">
      <ScreenHeader kicker={`مساعد ${presentation.displayName}`} title="المواعيد" />
      <div className="screen-action-row">
        <button className="primary-small" type="button" onClick={() => setShowAdd((value) => !value)}>{showAdd ? 'إغلاق' : '＋ موعد جديد'}</button>
      </div>

      {showAdd && (
        <AppointmentForm
          title="أضف موعدًا"
          busy={busy}
          clients={data.clients}
          defaultDate={selectedDate}
          onSubmit={async (form) => {
            if (await onAdd(form)) setShowAdd(false);
          }}
        />
      )}

      {editing && (
        <AppointmentForm
          key={editing.id}
          title={`تعديل · ${editing.title}`}
          busy={busy}
          clients={data.clients}
          appointment={editing}
          defaultDate={editing.appointmentDate}
          onCancel={() => setEditingId(null)}
          onSubmit={async (form) => {
            if (await onUpdate(editing.id, form)) setEditingId(null);
          }}
        />
      )}

      <AppointmentMonth
        cursor={cursor}
        data={data}
        selectedDate={selectedDate}
        onSelectedDate={setSelectedDate}
        onPrevious={() => moveMonth(-1)}
        onNext={() => moveMonth(1)}
      />

      <SectionTitle eyebrow={formatArabicDate(selectedDate)} title="مواعيد اليوم" />
      <div className="appointment-list">
        {selectedRows.map((appointment) => (
          <article className={`appointment-summary-card status-${appointment.status}`} key={appointment.id}>
            <div className="appointment-summary-main">
              <div><strong>{appointment.title}</strong><small>{clientName(data, appointment.clientId)} · {formatClockTime(appointment.startTime)}</small><small>{formatDurationArabic(appointment.durationMinutes)}{appointment.location ? ` · ${appointment.location}` : ''}</small></div>
              <span>{money(appointment.pricePence, presentation.currencyLabel)}</span>
            </div>
            <div className="appointment-summary-actions">
              <button type="button" onClick={() => setEditingId(appointment.id)}>تعديل</button>
              {appointment.status !== 'scheduled' && <button type="button" disabled={busy} onClick={() => void onStatus(appointment.id, 'scheduled', 'تم استرجاع الموعد.')}>استرجاع</button>}
            </div>
          </article>
        ))}
        {!selectedRows.length && <div className="friendly-empty">مفيش مواعيد في اليوم ده.</div>}
      </div>

      <SectionTitle eyebrow="القادم" title="أقرب المواعيد" />
      <div className="appointment-list compact-appointments">
        {upcomingAppointments(data, today, 8).map((appointment) => (
          <button className="appointment-upcoming-row" type="button" key={appointment.id} onClick={() => { setSelectedDate(appointment.appointmentDate); setCursor(new Date(`${appointment.appointmentDate.slice(0, 7)}-01T12:00:00`)); }}>
            <span><strong>{appointment.title}</strong><small>{clientName(data, appointment.clientId)}</small></span>
            <span><b>{formatShortDate(appointment.appointmentDate)}</b><small>{formatClockTime(appointment.startTime)}</small></span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function AppointmentsManagementScreen({
  snapshot,
  data,
  cloudAvailable,
  pendingSync,
  busy,
  onPlatformChanged,
  onPresentationSave,
  onAddClient,
  onOpenSchedule,
}: {
  snapshot: LocalPlatformSnapshot;
  data: AppointmentWorkspaceData;
  cloudAvailable: boolean;
  pendingSync: number;
  busy: boolean;
  onPlatformChanged: () => Promise<void>;
  onPresentationSave: (form: FormData) => Promise<boolean>;
  onAddClient: (form: FormData) => Promise<boolean>;
  onOpenSchedule: () => void;
}) {
  type View = 'home' | 'reports' | 'clients' | 'profile' | 'account';
  const [view, setView] = useState<View>('home');
  const [reportKind, setReportKind] = useState<AppointmentReportKind>('work');
  const presentation = resolveWorkspacePresentation(snapshot, data.workspaceSettings);
  const today = todayIso();
  const week = buildAppointmentReport(data, reportRangeForPreset('week', today));
  const due = currentAppointmentDue(data);
  const noTime = data.appointments.filter((row) => row.status === 'scheduled' && !row.startTime && row.appointmentDate >= today).length;

  const openReport = (kind: AppointmentReportKind) => { setReportKind(kind); setView('reports'); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const back = () => { setView('home'); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  if (view === 'reports') return <AppointmentReports data={data} currency={presentation.currencyLabel} initialKind={reportKind} onBack={back} />;
  if (view === 'clients') return <ClientsSettings data={data} currency={presentation.currencyLabel} busy={busy} onAddClient={onAddClient} onBack={back} />;
  if (view === 'profile') return <AppointmentsProfile snapshot={snapshot} data={data} busy={busy} onSave={onPresentationSave} onBack={back} />;
  if (view === 'account') return (
    <section className="management-subview">
      <ManagementSubHeader title="الحساب والمزامنة" subtitle={pendingSync ? `${pendingSync} تغيير مستني المزامنة` : 'البيانات المحلية محدثة'} onBack={back} />
      <article className={`management-sync-state ${pendingSync ? 'attention' : 'good'}`}><strong>{pendingSync ? 'فيه تغييرات لم تصل للسحابة بعد' : snapshot.cloudLink ? 'المزامنة مستقرة' : 'النسخة تعمل محليًا'}</strong><span>{snapshot.cloudLink ? `الحساب: ${snapshot.cloudLink.loginName}` : 'يمكنك العمل محليًا أو ربط الحساب للوصول من أجهزة أخرى.'}</span></article>
      <div className="management-form-card"><CloudLinkPanel snapshot={snapshot} available={cloudAvailable} onLinked={onPlatformChanged} /></div>
    </section>
  );

  const attention = Number(due > 0) + Number(noTime > 0) + Number(pendingSync > 0);
  return (
    <section className="simple-screen management-home">
      <ScreenHeader kicker={`مساعد ${presentation.displayName}`} title="إدارة" />
      <article className="management-profile-strip">
        <div className="management-avatar">{presentation.displayName.trim().charAt(0)}</div>
        <div><strong>{presentation.displayName}</strong><span>{presentation.workspaceName} · مواعيد وخدمات</span></div>
        <span className={`management-sync-dot ${pendingSync ? 'pending' : 'good'}`}>{pendingSync ? `${pendingSync} مزامنة` : snapshot.cloudLink ? 'متزامن' : 'محلي'}</span>
      </article>

      {attention > 0 && (
        <article className="management-attention-compact">
          <div><span>يحتاج انتباهك</span><strong>{attention} {attention === 1 ? 'حاجة' : 'حاجات'}</strong></div>
          <div className="management-attention-actions">
            {due > 0 && <button type="button" onClick={() => openReport('finance')}>{money(due, presentation.currencyLabel)} مطلوب تحصيله</button>}
            {noTime > 0 && <button type="button" onClick={onOpenSchedule}>{noTime} مواعيد بدون وقت</button>}
            {pendingSync > 0 && <button type="button" onClick={() => setView('account')}>{pendingSync} تغيير للمزامنة</button>}
          </div>
        </article>
      )}

      <section className="management-section">
        <div className="management-section-head"><div><small>بضغطة واحدة</small><h2>تقارير سريعة</h2></div><button type="button" onClick={() => openReport('work')}>كل التقارير</button></div>
        <div className="management-report-grid">
          <QuickReport icon="◷" title="هذا الأسبوع" detail={`${formatDurationArabic(week.workMinutes)} عمل`} onClick={() => openReport('work')} />
          <QuickReport icon="£" title="الفلوس" detail={due ? `${money(due, presentation.currencyLabel)} مستحق` : 'المقبوض والمصروف'} onClick={() => openReport('finance')} />
          <QuickReport icon="◎" title="العملاء" detail={`${data.clients.length} عميل`} onClick={() => openReport('clients')} />
          <QuickReport icon="✓" title="حالة المواعيد" detail={`${week.completed} تمت هذا الأسبوع`} onClick={() => openReport('status')} />
        </div>
      </section>

      <SettingsGroup title="الشغل">
        <ManagementRow icon="◎" title="العملاء" detail="إضافة العملاء ومراجعة الرصيد" onClick={() => setView('clients')} />
        <ManagementRow icon="▦" title="المواعيد" detail="إضافة وتعديل مواعيد الخدمات" onClick={onOpenSchedule} />
      </SettingsGroup>
      <SettingsGroup title="الحساب والبرنامج">
        <ManagementRow icon="◉" title="بياناتي" detail={`${presentation.displayName} · ${presentation.currencyCode}`} onClick={() => setView('profile')} />
        <ManagementRow icon="↻" title="الحساب والمزامنة" detail={snapshot.cloudLink ? 'الحساب مرتبط بالسحابة' : 'البرنامج يعمل محليًا'} onClick={() => setView('account')} />
      </SettingsGroup>
    </section>
  );
}

function AppointmentCard({
  appointment,
  data,
  currency,
  busy,
  onStatus,
  onCollect,
}: {
  appointment: AppointmentItem;
  data: AppointmentWorkspaceData;
  currency: string;
  busy: boolean;
  onStatus: (appointmentId: string, status: AppointmentStatus, message: string) => Promise<boolean>;
  onCollect: (form: FormData, appointmentId?: string | null) => Promise<boolean>;
}) {
  const [collecting, setCollecting] = useState(false);
  const today = todayIso();
  const future = appointment.appointmentDate > today;
  const due = appointment.clientId ? currentClientDue(data, appointment.clientId) : appointment.pricePence;
  const statusText = ({ scheduled: 'مجدول', completed: 'تم', cancelled: 'ملغي', missed: 'فات' } as const)[appointment.status];

  return (
    <article className={`appointment-card status-${appointment.status}`}>
      <div className="appointment-card-top">
        <div><strong>{appointment.title}</strong><small>{clientName(data, appointment.clientId)} · {formatClockTime(appointment.startTime)}</small><small>{formatDurationArabic(appointment.durationMinutes)}{appointment.location ? ` · ${appointment.location}` : ''}</small></div>
        <span><b>{money(appointment.pricePence, currency)}</b><small>{statusText}</small></span>
      </div>

      {appointment.status === 'scheduled' && (
        <div className="appointment-card-actions">
          <button className="appointment-complete" type="button" disabled={busy || future} onClick={() => void onStatus(appointment.id, 'completed', 'تم تسجيل الموعد كمكتمل.')}>تم ✓</button>
          <button type="button" disabled={busy} onClick={() => void onStatus(appointment.id, 'cancelled', 'تم إلغاء الموعد.')}>إلغاء</button>
          {!future && <button type="button" disabled={busy} onClick={() => void onStatus(appointment.id, 'missed', 'تم تسجيل الموعد كفائت.')}>فات</button>}
        </div>
      )}

      {appointment.status === 'completed' && (
        <div className="appointment-card-actions">
          <button className="appointment-complete" type="button" disabled>تم ✓</button>
          {appointment.clientId && <button type="button" disabled={busy} onClick={() => setCollecting((value) => !value)}>سجل تحصيل</button>}
          <button type="button" disabled={busy} onClick={() => void onStatus(appointment.id, 'scheduled', 'تم إعادة فتح الموعد.')}>إعادة فتح</button>
        </div>
      )}

      {(appointment.status === 'cancelled' || appointment.status === 'missed') && (
        <div className="appointment-card-actions"><button type="button" disabled={busy} onClick={() => void onStatus(appointment.id, 'scheduled', 'تم استرجاع الموعد.')}>استرجاع</button></div>
      )}

      {collecting && appointment.clientId && (
        <form className="lesson-inline-form" onSubmit={(event) => {
          event.preventDefault();
          void onCollect(new FormData(event.currentTarget), appointment.id).then((ok) => { if (ok) setCollecting(false); });
        }}>
          <strong>تحصيل من {clientName(data, appointment.clientId)}</strong>
          <input type="hidden" name="clientId" value={appointment.clientId} />
          <input name="amount" type="number" min="0.01" step="0.01" inputMode="decimal" defaultValue={(due || appointment.pricePence) / 100 || undefined} placeholder={`المبلغ ${currency}`} required />
          <input type="hidden" name="receivedAt" value={today} />
          <select name="paymentMethod" defaultValue="cash"><option value="cash">كاش</option><option value="bank">بنك</option><option value="wallet">محفظة</option><option value="other">أخرى</option></select>
          <input name="note" placeholder="ملاحظة اختيارية" />
          <div className="inline-form-actions"><button type="button" onClick={() => setCollecting(false)}>إلغاء</button><button type="submit" disabled={busy}>حفظ</button></div>
        </form>
      )}
    </article>
  );
}

function AppointmentForm({
  title,
  busy,
  clients,
  appointment,
  defaultDate,
  onSubmit,
  onCancel,
}: {
  title: string;
  busy: boolean;
  clients: AppointmentWorkspaceData['clients'];
  appointment?: AppointmentItem;
  defaultDate: string;
  onSubmit: (form: FormData) => Promise<void> | void;
  onCancel?: () => void;
}) {
  return (
    <div className="appointment-form-wrap">
      <QuickForm title={title} busy={busy} onSubmit={onSubmit}>
        <select name="clientId" defaultValue={appointment?.clientId ?? ''}><option value="">بدون عميل</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select>
        <input name="title" defaultValue={appointment?.title ?? ''} placeholder="الخدمة أو سبب الموعد" required />
        <label className="appointment-field-label">التاريخ<ArabicDateField name="appointmentDate" defaultValue={appointment?.appointmentDate ?? defaultDate} ariaLabel="تاريخ الموعد" /></label>
        <label className="appointment-field-label">الوقت<ArabicTimeField name="startTime" defaultValue={appointment?.startTime ?? '10:00'} ariaLabel="وقت الموعد" /></label>
        <input name="durationMinutes" type="number" min="5" max="1440" defaultValue={appointment?.durationMinutes ?? 60} placeholder="مدة الخدمة بالدقائق" required />
        <input name="travelMinutes" type="number" min="0" max="1440" defaultValue={appointment?.travelMinutes ?? 0} placeholder="وقت الانتقال بالدقائق" />
        <input name="price" type="number" min="0" step="0.01" defaultValue={appointment ? appointment.pricePence / 100 : undefined} placeholder="السعر" />
        <input name="location" defaultValue={appointment?.location ?? ''} placeholder="المكان" />
        <input name="note" defaultValue={appointment?.note ?? ''} placeholder="ملاحظة اختيارية" />
      </QuickForm>
      {onCancel && <button className="secondary-small appointment-form-cancel" type="button" onClick={onCancel}>إلغاء التعديل</button>}
    </div>
  );
}

function AppointmentMonth({
  cursor,
  data,
  selectedDate,
  onSelectedDate,
  onPrevious,
  onNext,
}: {
  cursor: Date;
  data: AppointmentWorkspaceData;
  selectedDate: string;
  onSelectedDate: (date: string) => void;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const cells = useMemo(() => monthCells(cursor), [cursor]);
  const monthKey = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
  const title = new Intl.DateTimeFormat('ar-EG-u-nu-arab', { month: 'long', year: 'numeric' }).format(cursor);
  const today = todayIso();
  return (
    <div className="appointment-month">
      <div className="month-head"><strong>{title}</strong><div><button type="button" onClick={onPrevious}>‹</button><button type="button" onClick={onNext}>›</button></div></div>
      <div className="month-weekdays">{['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'].map((day) => <span key={day}>{day.slice(0, 2)}</span>)}</div>
      <div className="month-grid">
        {cells.map((date) => {
          const count = data.appointments.filter((row) => row.appointmentDate === date).length;
          const classes = ['month-cell'];
          if (!date.startsWith(monthKey)) classes.push('outside');
          if (date === today) classes.push('today');
          if (date === selectedDate) classes.push('selected');
          return <button className={classes.join(' ')} type="button" key={date} onClick={() => onSelectedDate(date)}><b>{Number(date.slice(-2)).toLocaleString('ar-EG')}</b><small>{count ? `${count} موعد` : ''}</small></button>;
        })}
      </div>
    </div>
  );
}

function monthCells(cursor: Date): string[] {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1, 12);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const value = new Date(start);
    value.setDate(start.getDate() + index);
    return localDate(value);
  });
}

type AppointmentReportKind = 'work' | 'finance' | 'clients' | 'status';

function AppointmentReports({ data, currency, initialKind, onBack }: { data: AppointmentWorkspaceData; currency: string; initialKind: AppointmentReportKind; onBack: () => void }) {
  const today = todayIso();
  const [kind, setKind] = useState<AppointmentReportKind>(initialKind);
  const [preset, setPreset] = useState<Exclude<ReportPreset, 'last28'>>('month');
  const [fromDate, setFromDate] = useState(`${today.slice(0, 7)}-01`);
  const [toDate, setToDate] = useState(today);
  const range = reportRangeForPreset(preset, today, preset === 'custom' ? { fromDate, toDate } : undefined);
  const report = buildAppointmentReport(data, range);

  return (
    <section className="management-subview reports-hub">
      <ManagementSubHeader title="التقارير" subtitle={`${formatArabicDate(range.fromDate)} — ${formatArabicDate(range.toDate)}`} onBack={onBack} />
      <div className="report-kind-scroll" role="tablist">
        <ReportButton active={kind === 'work'} onClick={() => setKind('work')}>العمل</ReportButton>
        <ReportButton active={kind === 'finance'} onClick={() => setKind('finance')}>الفلوس</ReportButton>
        <ReportButton active={kind === 'clients'} onClick={() => setKind('clients')}>العملاء</ReportButton>
        <ReportButton active={kind === 'status'} onClick={() => setKind('status')}>المواعيد</ReportButton>
      </div>
      <div className="report-range-tabs">
        <button type="button" className={preset === 'week' ? 'active' : ''} onClick={() => setPreset('week')}>أسبوع</button>
        <button type="button" className={preset === 'month' ? 'active' : ''} onClick={() => setPreset('month')}>شهر</button>
        <button type="button" className={preset === 'custom' ? 'active' : ''} onClick={() => setPreset('custom')}>مخصص</button>
      </div>
      {preset === 'custom' && <div className="report-custom-range"><label>من<ArabicDateField value={fromDate} onValueChange={setFromDate} /></label><label>إلى<ArabicDateField value={toDate} onValueChange={setToDate} /></label></div>}

      {kind === 'work' && <><article className="report-answer-card"><span>اشتغلت خلال الفترة</span><strong>{formatDurationArabic(report.workMinutes)}</strong><small>{report.completed} موعد مكتمل · قيمة العمل {money(report.earnedPence, currency)}</small></article><ManagementMetricGrid items={[["وقت الخدمة",formatDurationArabic(report.serviceMinutes)],["وقت الانتقال",formatDurationArabic(report.travelMinutes)],["العائد الحقيقي/ساعة",money(report.effectiveHourlyPence,currency)],["إلغاء أو فوات",String(report.cancelled)]]} /></>}
      {kind === 'finance' && <><article className="report-answer-card"><span>صافي الحركة خلال الفترة</span><strong>{money(report.netCashPence, currency)}</strong><small>المقبوض + الدخل الآخر − المصروفات</small></article><ManagementMetricGrid items={[["قبضت",money(report.receivedPence,currency)],["دخل آخر",money(report.otherIncomePence,currency)],["صرفت",money(report.expensesPence,currency)],["مطلوب الآن",money(report.duePence,currency)]]} />{report.unassignedDuePence > 0 && <div className="report-insight-card attention"><strong>فيه عمل مكتمل بدون عميل</strong><span>{money(report.unassignedDuePence, currency)} لا يمكن ربط تحصيله بعميل قبل تحديد العميل.</span></div>}</>}
      {kind === 'clients' && <div className="report-row-list">{report.clientRows.map((row) => <article className="report-person-row" key={row.clientId}><div className="avatar-circle">{row.name.charAt(0)}</div><div><strong>{row.name}</strong><small>{row.completed} موعد · {formatDurationArabic(row.minutes)}</small></div><div><b>{money(row.receivedPence,currency)}</b><small>{row.duePence ? `مستحق ${money(row.duePence,currency)}` : 'لا مستحقات'}</small></div></article>)}{!report.clientRows.length && <div className="friendly-empty">لا توجد حركة للعملاء في الفترة.</div>}</div>}
      {kind === 'status' && <><article className="report-answer-card"><span>المواعيد التي تمت</span><strong>{report.completed}</strong><small>خلال الفترة المختارة</small></article><ManagementMetricGrid items={[["تمت",String(report.completed)],["مجدولة",String(report.scheduled)],["إلغاء/فوات",String(report.cancelled)],["قيمة العمل",money(report.earnedPence,currency)]]} /></>}
    </section>
  );
}

function ClientsSettings({ data, currency, busy, onAddClient, onBack }: { data: AppointmentWorkspaceData; currency: string; busy: boolean; onAddClient: (form: FormData) => Promise<boolean>; onBack: () => void }) {
  const [showAdd, setShowAdd] = useState(false);
  return (
    <section className="management-subview">
      <ManagementSubHeader title="العملاء" subtitle={`${data.clients.length} عميل`} onBack={onBack} />
      <button className="primary-small" type="button" onClick={() => setShowAdd((value) => !value)}>{showAdd ? 'إغلاق' : '＋ عميل جديد'}</button>
      {showAdd && <QuickForm title="أضف عميلًا" busy={busy} onSubmit={async (form) => { if (await onAddClient(form)) setShowAdd(false); }}><input name="name" placeholder="اسم العميل" required /><input name="phone" type="tel" placeholder="الهاتف اختياري" /><input name="notes" placeholder="ملاحظة اختيارية" /></QuickForm>}
      <div className="appointment-client-list">
        {data.clients.map((client) => { const due = currentClientDue(data, client.id); return <article className="appointment-client-card" key={client.id}><div className="avatar-circle">{client.name.charAt(0)}</div><div><strong>{client.name}</strong><small>{client.phone || 'بدون رقم هاتف'}{client.notes ? ` · ${client.notes}` : ''}</small></div><span className={due ? 'needs' : 'ok'}>{due ? money(due,currency) : 'تمام'}</span></article>; })}
        {!data.clients.length && <div className="friendly-empty">لسه مفيش عملاء. أضيفي أول عميل من الزر بالأعلى.</div>}
      </div>
    </section>
  );
}

function AppointmentsProfile({ snapshot, data, busy, onSave, onBack }: { snapshot: LocalPlatformSnapshot; data: AppointmentWorkspaceData; busy: boolean; onSave: (form: FormData) => Promise<boolean>; onBack: () => void }) {
  const presentation = resolveWorkspacePresentation(snapshot, data.workspaceSettings);
  return (
    <section className="management-subview">
      <ManagementSubHeader title="بياناتي" subtitle="الاسم وطريقة عرض مساحة العمل" onBack={onBack} />
      <form className="management-settings-form" onSubmit={(event) => { event.preventDefault(); void onSave(new FormData(event.currentTarget)); }}>
        <label>اسمك<input name="displayName" defaultValue={presentation.displayName} required /></label>
        <label>اسم شغلك<input name="workspaceName" defaultValue={presentation.workspaceName} required /></label>
        <div className="management-settings-row-static"><span><strong>طريقة الاستخدام</strong><small>مواعيد وخدمات</small></span><b>خدمات</b></div>
        <div className="management-settings-two"><label>رمز العملة<input name="currencyCode" defaultValue={presentation.currencyCode} maxLength={8} required /></label><label>علامة العملة<input name="currencyLabel" defaultValue={presentation.currencyLabel} maxLength={12} required /></label></div>
        <p className="management-helper">تغيير الاسم أو العملة يغيّر طريقة العرض فقط ولا يمس المواعيد أو التحصيلات القديمة.</p>
        <button className="form-submit" type="submit" disabled={busy}>{busy ? 'جاري الحفظ…' : 'حفظ البيانات'}</button>
      </form>
    </section>
  );
}

function ManagementSubHeader({ title, subtitle, onBack }: { title: string; subtitle?: string; onBack: () => void }) {
  return <header className="management-subheader"><div>{subtitle && <small>{subtitle}</small>}<h2>{title}</h2></div><button type="button" onClick={onBack}>رجوع</button></header>;
}

function QuickReport({ icon, title, detail, onClick }: { icon: string; title: string; detail: string; onClick: () => void }) {
  return <button className="management-report-shortcut" type="button" onClick={onClick}><b>{icon}</b><span><strong>{title}</strong><small>{detail}</small></span></button>;
}

function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="management-settings-group"><h3>{title}</h3><div className="management-group">{children}</div></section>;
}

function ManagementRow({ icon, title, detail, onClick }: { icon: string; title: string; detail: string; onClick: () => void }) {
  return <button className="management-row" type="button" onClick={onClick}><span className="management-row-icon">{icon}</span><span><strong>{title}</strong><small>{detail}</small></span><b>‹</b></button>;
}

function ReportButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return <button type="button" className={active ? 'active' : ''} onClick={onClick}>{children}</button>;
}

function ManagementMetricGrid({ items }: { items: Array<[string, string]> }) {
  return <div className="management-metric-grid">{items.map(([label,value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>;
}
