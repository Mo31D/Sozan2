import { lazy, Suspense, useEffect, useState } from 'react';
import type { LocalActivityEvent } from '../activity/local-activity';
import type { LocalPlatformSnapshot } from '../adapters/indexeddb/platform.repository';
import { runWorkspaceSync } from '../sync/engine';
import type { ControlAction, ControlTab } from './contracts';
import { loadControlCenterData, type ControlCenterData } from './data';
import { controlErrorText } from './presentation';
import { undoActivityEvent } from './undo';

const ActivityView = lazy(() => import('./views/ActivityView').then((module) => ({ default: module.ActivityView })));
const ReceiptsView = lazy(() => import('./views/FinanceViews').then((module) => ({ default: module.ReceiptsView })));
const ExpensesView = lazy(() => import('./views/FinanceViews').then((module) => ({ default: module.ExpensesView })));
const IncomeView = lazy(() => import('./views/FinanceViews').then((module) => ({ default: module.IncomeView })));
const CashView = lazy(() => import('./views/FinanceViews').then((module) => ({ default: module.CashView })));
const StudentsView = lazy(() => import('./views/TutoringViews').then((module) => ({ default: module.StudentsView })));
const SessionsView = lazy(() => import('./views/TutoringViews').then((module) => ({ default: module.SessionsView })));
const ReportView = lazy(() => import('./views/ReportView').then((module) => ({ default: module.ReportView })));

const TABS: Array<[ControlTab, string]> = [
  ['activity', 'السجل'],
  ['receipts', 'التحصيلات'],
  ['expenses', 'المصروفات'],
  ['income', 'دخل آخر'],
  ['cash', 'مطابقة'],
  ['students', 'الطلاب'],
  ['sessions', 'الحصص'],
  ['reports', 'التقرير'],
];

export function ControlCenter({
  snapshot,
  onChanged,
}: {
  snapshot: LocalPlatformSnapshot;
  onChanged: () => Promise<void> | void;
}) {
  const workspaceId = snapshot.workspace.id;
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<ControlTab>('activity');
  const [data, setData] = useState<ControlCenterData | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);

  const load = async (syncFirst = false) => {
    if (syncFirst && snapshot.cloudLink && navigator.onLine) {
      try {
        await runWorkspaceSync(workspaceId);
      } catch {
        // Local state remains authoritative and pending writes stay queued.
      }
    }
    setData(await loadControlCenterData(workspaceId));
  };

  useEffect(() => {
    if (open) void load(true);
    // Loading is intentionally tied to opening the control center/workspace changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workspaceId]);

  const afterWrite = async (text: string) => {
    if (snapshot.cloudLink && navigator.onLine) {
      try {
        await runWorkspaceSync(workspaceId);
      } catch {
        // The local mutation is durable and the outbox will retry later.
      }
    }
    await load(false);
    await onChanged();
    setMessage(text);
  };

  const act: ControlAction = async (action, successMessage) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
      await afterWrite(successMessage);
      return true;
    } catch (cause) {
      setError(controlErrorText(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const undo = async (event: LocalActivityEvent) => {
    const ok = await act(() => undoActivityEvent(workspaceId, event), 'تم التراجع عن التغيير.');
    if (ok) setTab('activity');
  };

  const changeTab = (next: ControlTab) => {
    setTab(next);
    setEditId(null);
    setProfileId(null);
  };

  return (
    <>
      <button className="control-launcher" type="button" onClick={() => setOpen(true)} aria-label="الإدارة والسجل">
        <b>☰</b><span>إدارة</span>
      </button>
      {open && (
        <div className="control-overlay" role="dialog" aria-modal="true" aria-label="الإدارة والسجل">
          <section className="control-sheet">
            <header className="control-header">
              <div><small>كل بياناتك تحت سيطرتك</small><h2>الإدارة والسجل</h2></div>
              <button type="button" onClick={() => setOpen(false)} aria-label="إغلاق">×</button>
            </header>
            <nav className="control-tabs">
              {TABS.map(([key, label]) => (
                <button key={key} type="button" className={tab === key ? 'active' : ''} onClick={() => changeTab(key)}>{label}</button>
              ))}
            </nav>
            {message && <div className="control-message good">{message}</div>}
            {error && <div className="control-message bad">{error}</div>}
            {!data && <div className="control-loading">جاري تحميل البيانات…</div>}
            {data && (
              <Suspense fallback={<div className="control-loading">جاري فتح القسم…</div>}>
                <ControlContent
                  tab={tab}
                  data={data}
                  workspaceId={workspaceId}
                  currency={snapshot.workspace.currencyLabel}
                  busy={busy}
                  editId={editId}
                  setEditId={setEditId}
                  profileId={profileId}
                  setProfileId={setProfileId}
                  act={act}
                  onUndo={undo}
                />
              </Suspense>
            )}
          </section>
        </div>
      )}
    </>
  );
}

function ControlContent({
  tab,
  data,
  workspaceId,
  currency,
  busy,
  editId,
  setEditId,
  profileId,
  setProfileId,
  act,
  onUndo,
}: {
  tab: ControlTab;
  data: ControlCenterData;
  workspaceId: string;
  currency: string;
  busy: boolean;
  editId: string | null;
  setEditId: (id: string | null) => void;
  profileId: string | null;
  setProfileId: (id: string | null) => void;
  act: ControlAction;
  onUndo: (event: LocalActivityEvent) => void;
}) {
  const common = { editId, setEditId, busy, currency, workspaceId, act };
  switch (tab) {
    case 'activity': return <ActivityView events={data.activity} busy={busy} onUndo={onUndo} />;
    case 'receipts': return <ReceiptsView {...common} data={data} />;
    case 'expenses': return <ExpensesView {...common} rows={data.expenses} />;
    case 'income': return <IncomeView {...common} rows={data.income} />;
    case 'cash': return <CashView {...common} data={data} />;
    case 'students': return <StudentsView {...common} data={data} profileId={profileId} setProfileId={setProfileId} />;
    case 'sessions': return <SessionsView {...common} data={data} />;
    case 'reports': return <ReportView data={data.simple} currency={currency} />;
  }
}
