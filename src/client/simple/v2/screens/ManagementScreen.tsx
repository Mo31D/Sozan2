import { useState } from 'react';
import { buildWorkspaceReportForRange, reportRangeForPreset } from '../../../../modules/reports/insights';
import type { LocalPlatformSnapshot } from '../../../adapters/indexeddb/platform.repository';
import type { ControlTab } from '../../../control/contracts';
import { resolveWorkspacePresentation } from '../../../platform/workspace-preferences';
import type { SimpleWorkspaceData } from '../../data';
import { ScreenHeader } from '../components';
import { dueTotal, formatDurationArabic, money, todayIso } from '../utils';
import { AccountSettings } from './management/AccountSettings';
import { DataTools } from './management/DataTools';
import { ProfileSettings } from './management/ProfileSettings';
import { ReportsHub, type TutoringReportKind } from './management/ReportsHub';
import { StudentsSettings } from './management/StudentsSettings';

type ManagementView = 'home' | 'reports' | 'students' | 'account' | 'data' | 'profile';
type ReportLaunch = { kind: TutoringReportKind; preset: 'week' | 'month' };

export function ManagementScreen({
  snapshot,
  data,
  cloudAvailable,
  pendingSync,
  busy,
  showAddStudent,
  onToggleAddStudent,
  onPlatformChanged,
  onPresentationSave,
  onStudentAdd,
  onPackage: _onPackage,
  onOpenPendingSchedule,
  onOpenStudent,
  onOpenAdvanced,
}: {
  snapshot: LocalPlatformSnapshot;
  data: SimpleWorkspaceData;
  cloudAvailable: boolean;
  pendingSync: number;
  busy: boolean;
  showAddStudent: boolean;
  onToggleAddStudent: () => void;
  onPlatformChanged: () => Promise<void>;
  onPresentationSave: (form: FormData) => Promise<boolean>;
  onStudentAdd: (form: FormData) => void;
  onPackage: (studentId: string, form: FormData) => void;
  onOpenPendingSchedule: () => void;
  onOpenStudent: (studentId: string) => void;
  onOpenAdvanced: (tab: ControlTab) => void;
}) {
  const [view, setView] = useState<ManagementView>('home');
  const [reportLaunch, setReportLaunch] = useState<ReportLaunch>({ kind: 'work', preset: 'week' });
  const presentation = resolveWorkspacePresentation(snapshot, data.workspaceSettings);

  const openReport = (kind: TutoringReportKind, preset: 'week' | 'month') => {
    setReportLaunch({ kind, preset });
    setView('reports');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const back = () => {
    setView('home');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (view === 'reports') {
    return <ReportsHub key={`${reportLaunch.kind}-${reportLaunch.preset}`} data={data} currency={presentation.currencyLabel} initialKind={reportLaunch.kind} initialPreset={reportLaunch.preset} onOpenStudent={onOpenStudent} onBack={back} />;
  }
  if (view === 'students') {
    return <StudentsSettings data={data} busy={busy} showAddStudent={showAddStudent} onToggleAddStudent={onToggleAddStudent} onStudentAdd={onStudentAdd} onOpenStudent={onOpenStudent} onBack={back} />;
  }
  if (view === 'account') {
    return <AccountSettings snapshot={snapshot} cloudAvailable={cloudAvailable} pendingSync={pendingSync} onPlatformChanged={onPlatformChanged} onBack={back} />;
  }
  if (view === 'data') {
    return <DataTools snapshot={snapshot} onImported={onPlatformChanged} onBack={back} onOpenActivity={() => onOpenAdvanced('activity')} />;
  }
  if (view === 'profile') {
    return <ProfileSettings snapshot={snapshot} data={data} busy={busy} onSave={onPresentationSave} onBack={back} />;
  }

  const pendingTimes = data.sessions.filter((row) => row.scheduleStatus === 'pending').length;
  const due = dueTotal(data);
  const attentionCount = (pendingTimes ? 1 : 0) + (due ? 1 : 0) + (pendingSync ? 1 : 0);
  const week = buildWorkspaceReportForRange(data, reportRangeForPreset('week', todayIso()));

  return (
    <section className="simple-screen management-home">
      <ScreenHeader kicker={`مساعد ${presentation.displayName}`} title="إدارة" />

      <article className="management-profile-strip">
        <div className="management-avatar">{presentation.displayName.trim().charAt(0)}</div>
        <div><strong>{presentation.displayName}</strong><span>{presentation.workspaceName} · تدريس</span></div>
        <span className={`management-sync-dot ${pendingSync ? 'pending' : 'good'}`}>{pendingSync ? `${pendingSync} مزامنة` : snapshot.cloudLink ? 'متزامن' : 'محلي'}</span>
      </article>

      {attentionCount > 0 && (
        <article className="management-attention-compact">
          <div><span>يحتاج انتباهك</span><strong>{attentionCount} {attentionCount === 1 ? 'حاجة' : 'حاجات'}</strong></div>
          <div className="management-attention-actions">
            {pendingTimes > 0 && <button type="button" onClick={onOpenPendingSchedule}>{pendingTimes} مواعيد بدون وقت</button>}
            {due > 0 && <button type="button" onClick={() => openReport('finance', 'month')}>{money(due, presentation.currencyLabel)} مطلوب تحصيله</button>}
            {pendingSync > 0 && <button type="button" onClick={() => setView('account')}>{pendingSync} تغيير للمزامنة</button>}
          </div>
        </article>
      )}

      <section className="management-section">
        <div className="management-section-head"><div><small>بضغطة واحدة</small><h2>تقارير سريعة</h2></div><button type="button" onClick={() => openReport('work', 'month')}>كل التقارير</button></div>
        <div className="management-report-grid">
          <QuickReport icon="◷" title="هذا الأسبوع" detail={`${formatDurationArabic(week.workMinutes)} عمل`} onClick={() => openReport('work', 'week')} />
          <QuickReport icon="▦" title="هذا الشهر" detail="ملخص العمل والوقت" onClick={() => openReport('work', 'month')} />
          <QuickReport icon="£" title="الفلوس" detail={due > 0 ? `${money(due, presentation.currencyLabel)} مستحق` : 'المقبوض والمصروف'} onClick={() => openReport('finance', 'month')} />
          <QuickReport icon="◎" title="الطلاب" detail={`${data.students.length} طالب`} onClick={() => openReport('students', 'month')} />
        </div>
      </section>

      <SettingsGroup title="الشغل">
        <ManagementRow icon="◎" title="الطلاب" detail="كل طالب له ملف موحد للحصص والباقة والفلوس والسجل" onClick={() => setView('students')} />
        <ManagementRow icon="▦" title="الحصص والمواعيد" detail="التعديل المتقدم وربط الطلاب والأسعار" onClick={() => onOpenAdvanced('sessions')} />
      </SettingsGroup>

      <SettingsGroup title="الفلوس والسجل">
        <ManagementRow icon="↓" title="التحصيلات" detail="مراجعة وتعديل التحصيلات المسجلة" onClick={() => onOpenAdvanced('receipts')} />
        <ManagementRow icon="−" title="المصروفات والدخل" detail="تصحيح المصروفات والدخل الآخر" onClick={() => onOpenAdvanced('expenses')} />
        <ManagementRow icon="≋" title="مطابقة الفلوس" detail="قارني الموجود فعليًا بما هو مسجل" onClick={() => onOpenAdvanced('cash')} />
      </SettingsGroup>

      <SettingsGroup title="الحساب والبرنامج">
        <ManagementRow icon="◉" title="بياناتي" detail={`${presentation.displayName} · ${presentation.currencyCode}`} onClick={() => setView('profile')} />
        <ManagementRow icon="↻" title="الحساب والمزامنة" detail={snapshot.cloudLink ? 'الحساب مرتبط بالسحابة' : 'البرنامج يعمل محليًا'} onClick={() => setView('account')} />
        <ManagementRow icon="⇅" title="البيانات" detail="السجل، التصدير، والاستيراد القديم" onClick={() => setView('data')} />
      </SettingsGroup>
    </section>
  );
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
