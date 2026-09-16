import { type FormEvent, useEffect, useMemo, useState } from 'react';
import type { Student } from '../../modules/tutoring/domain/student';
import type { RecurringSession } from '../../modules/tutoring/domain/session';
import { buildWorkspaceReport } from '../../modules/reports/insights';
import type { LocalPlatformSnapshot } from '../adapters/indexeddb/platform.repository';
import { openLocalDatabase, requestResult, STORES } from '../adapters/indexeddb/database';
import { listLocalActivity, markActivityUndone, type LocalActivityEvent } from '../activity/local-activity';
import { duplicateReceiptIds } from './correction-model';
import {
  deleteLocalExpense,
  deleteLocalReceipt,
  restoreLocalExpense,
  restoreLocalReceipt,
  updateLocalExpense,
  updateLocalReceipt,
} from '../finance/corrections';
import {
  addLocalCashCheck,
  addLocalOtherIncome,
  deleteLocalCashCheck,
  deleteLocalOtherIncome,
  restoreLocalCashCheck,
  restoreLocalOtherIncome,
  updateLocalCashCheck,
  updateLocalOtherIncome,
} from '../finance/extended-commands';
import {
  loadSimpleWorkspaceData,
  type LocalCashCheck,
  type LocalExpense,
  type LocalOtherIncome,
  type SimpleWorkspaceData,
} from '../simple/data';
import { runWorkspaceSync } from '../sync/engine';
import type { LocalReceipt } from '../tutoring/local-commands';
import { updateLocalStudent } from '../tutoring/student-corrections';
import { archiveLocalSession, updateLocalSessionDetails } from '../tutoring/session-corrections';

type Tab = 'activity' | 'receipts' | 'expenses' | 'income' | 'cash' | 'students' | 'sessions' | 'reports';

type FullData = {
  simple: SimpleWorkspaceData;
  receipts: LocalReceipt[];
  expenses: LocalExpense[];
  income: LocalOtherIncome[];
  cashChecks: LocalCashCheck[];
  sessions: RecurringSession[];
  activity: LocalActivityEvent[];
};

export function FinalControlCenter({
  snapshot,
  onChanged,
}: {
  snapshot: LocalPlatformSnapshot;
  onChanged: () => Promise<void> | void;
}) {
  const workspaceId = snapshot.workspace.id;
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('activity');
  const [data, setData] = useState<FullData | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);

  const load = async (syncFirst = false) => {
    if (syncFirst && snapshot.cloudLink && navigator.onLine) {
      try { await runWorkspaceSync(workspaceId); } catch { /* local state remains usable */ }
    }
    const db = await openLocalDatabase();
    const tx = db.transaction([
      STORES.financeReceipts,
      STORES.financeExpenses,
      STORES.financeOtherIncome,
      STORES.financeCashChecks,
      STORES.tutoringSessions,
    ], 'readonly');
    const [simple, receipts, expenses, income, cashChecks, sessions, activity] = await Promise.all([
      loadSimpleWorkspaceData(workspaceId),
      requestResult<LocalReceipt[]>(tx.objectStore(STORES.financeReceipts).getAll()),
      requestResult<LocalExpense[]>(tx.objectStore(STORES.financeExpenses).getAll()),
      requestResult<LocalOtherIncome[]>(tx.objectStore(STORES.financeOtherIncome).getAll()),
      requestResult<LocalCashCheck[]>(tx.objectStore(STORES.financeCashChecks).getAll()),
      requestResult<RecurringSession[]>(tx.objectStore(STORES.tutoringSessions).getAll()),
      listLocalActivity(workspaceId),
    ]);
    const mine = <T extends { workspaceId: string }>(rows: T[]) => rows.filter((row) => row.workspaceId === workspaceId);
    setData({
      simple,
      receipts: mine(receipts).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || b.id.localeCompare(a.id)),
      expenses: mine(expenses).sort((a, b) => b.expenseDate.localeCompare(a.expenseDate) || b.id.localeCompare(a.id)),
      income: mine(income).sort((a, b) => b.incomeDate.localeCompare(a.incomeDate) || b.id.localeCompare(a.id)),
      cashChecks: mine(cashChecks).sort((a, b) => b.checkDate.localeCompare(a.checkDate) || b.id.localeCompare(a.id)),
      sessions: mine(sessions).sort((a, b) => Number(!a.active) - Number(!b.active) || (a.weekday ?? 99) - (b.weekday ?? 99) || (a.startTime ?? '99:99').localeCompare(b.startTime ?? '99:99')),
      activity,
    });
  };

  useEffect(() => {
    if (open) void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workspaceId]);

  const afterWrite = async (text: string) => {
    if (snapshot.cloudLink && navigator.onLine) {
      try { await runWorkspaceSync(workspaceId); } catch { /* queued for retry */ }
    }
    await load(false);
    await onChanged();
    setMessage(text);
  };

  const act = async (action: () => Promise<void>, success: string): Promise<boolean> => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
      await afterWrite(success);
      return true;
    } catch (cause) {
      setError(errorText(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const undo = async (event: LocalActivityEvent) => {
    if (!event.entityId || event.undoneAt) return;
    const before = parseJson<Record<string, unknown>>(event.beforeJson);
    const ok = await act(async () => {
      if (event.action === 'receipt.deleted') await restoreLocalReceipt(workspaceId, event.entityId!);
      else if (event.action === 'expense.deleted') await restoreLocalExpense(workspaceId, event.entityId!);
      else if (event.action === 'income.deleted') await restoreLocalOtherIncome(workspaceId, event.entityId!);
      else if (event.action === 'cash.deleted') await restoreLocalCashCheck(workspaceId, event.entityId!);
      else if (event.action === 'receipt.updated' && before) {
        await updateLocalReceipt(workspaceId, event.entityId!, {
          studentId: String(before.payerRefId ?? ''),
          amountPence: Number(before.amountPence ?? 0),
          receivedAt: String(before.receivedAt ?? ''),
          paymentMethod: String(before.paymentMethod ?? 'cash') as LocalReceipt['paymentMethod'],
          note: before.note ? String(before.note) : null,
        });
      } else if (event.action === 'expense.updated' && before) {
        await updateLocalExpense(workspaceId, event.entityId!, {
          expenseDate: String(before.expenseDate ?? ''),
          scope: String(before.scope ?? 'personal') as LocalExpense['scope'],
          category: String(before.category ?? ''),
          amountPence: Number(before.amountPence ?? 0),
          note: before.note ? String(before.note) : null,
        });
      } else if (event.action === 'income.updated' && before) {
        await updateLocalOtherIncome(workspaceId, event.entityId!, {
          incomeDate: String(before.incomeDate ?? ''),
          category: String(before.category ?? ''),
          amountPence: Number(before.amountPence ?? 0),
          note: before.note ? String(before.note) : null,
        });
      } else if (event.action === 'cash.updated' && before) {
        await updateLocalCashCheck(workspaceId, event.entityId!, {
          checkDate: String(before.checkDate ?? ''),
          expectedBalancePence: Number(before.expectedBalancePence ?? 0),
          actualBalancePence: Number(before.actualBalancePence ?? 0),
          note: before.note ? String(before.note) : null,
        });
      } else if (event.action === 'student.updated' && before) {
        await updateLocalStudent(workspaceId, event.entityId!, {
          name: String(before.name ?? ''),
          age: typeof before.age === 'number' ? before.age : null,
          guardianName: before.guardianName ? String(before.guardianName) : '',
          guardianPhone: before.guardianPhone ? String(before.guardianPhone) : '',
          level: before.level ? String(before.level) : '',
          notes: before.notes ? String(before.notes) : '',
        });
      } else throw new Error('UNDO_NOT_SUPPORTED');
      await markActivityUndone(event.id, workspaceId);
    }, 'تم التراجع عن التغيير.');
    if (ok) setTab('activity');
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
              {([
                ['activity', 'السجل'], ['receipts', 'التحصيلات'], ['expenses', 'المصروفات'], ['income', 'دخل آخر'],
                ['cash', 'مطابقة'], ['students', 'الطلاب'], ['sessions', 'الحصص'], ['reports', 'التقرير'],
              ] as Array<[Tab, string]>).map(([key, label]) => <button key={key} type="button" className={tab === key ? 'active' : ''} onClick={() => { setTab(key); setEditId(null); setProfileId(null); }}>{label}</button>)}
            </nav>
            {message && <div className="control-message good">{message}</div>}
            {error && <div className="control-message bad">{error}</div>}
            {!data && <div className="control-loading">جاري تحميل البيانات…</div>}
            {data && tab === 'activity' && <ActivityView events={data.activity} busy={busy} onUndo={undo} />}
            {data && tab === 'receipts' && <ReceiptsView data={data} editId={editId} setEditId={setEditId} busy={busy} currency={snapshot.workspace.currencyLabel} act={act} workspaceId={workspaceId} />}
            {data && tab === 'expenses' && <ExpensesView rows={data.expenses} editId={editId} setEditId={setEditId} busy={busy} currency={snapshot.workspace.currencyLabel} act={act} workspaceId={workspaceId} />}
            {data && tab === 'income' && <IncomeView rows={data.income} editId={editId} setEditId={setEditId} busy={busy} currency={snapshot.workspace.currencyLabel} act={act} workspaceId={workspaceId} />}
            {data && tab === 'cash' && <CashView data={data} editId={editId} setEditId={setEditId} busy={busy} currency={snapshot.workspace.currencyLabel} act={act} workspaceId={workspaceId} />}
            {data && tab === 'students' && <StudentsView data={data} profileId={profileId} setProfileId={setProfileId} editId={editId} setEditId={setEditId} busy={busy} currency={snapshot.workspace.currencyLabel} act={act} workspaceId={workspaceId} />}
            {data && tab === 'sessions' && <SessionsView data={data} editId={editId} setEditId={setEditId} busy={busy} act={act} workspaceId={workspaceId} />}
            {data && tab === 'reports' && <ReportView data={data.simple} currency={snapshot.workspace.currencyLabel} />}
          </section>
        </div>
      )}
    </>
  );
}

function ActivityView({ events, busy, onUndo }: { events: LocalActivityEvent[]; busy: boolean; onUndo: (event: LocalActivityEvent) => void }) {
  return <div className="control-list">{events.map((event) => <article className={`control-row ${event.undoneAt ? 'muted' : ''}`} key={event.id}><div className="control-row-main"><strong>{event.title}</strong><small>{formatDateTime(event.createdAt)}{event.undoneAt ? ' · تم التراجع' : ''}</small>{event.detail && <p>{event.detail}</p>}</div>{event.undoable && !event.undoneAt && undoSupported(event) && <button className="mini-action" type="button" disabled={busy} onClick={() => onUndo(event)}>تراجع</button>}</article>)}{!events.length && <Empty text="أي إضافة أو تعديل أو حذف جديد سيظهر هنا." />}</div>;
}

function ReceiptsView({ data, editId, setEditId, busy, currency, act, workspaceId }: CommonListProps & { data: FullData }) {
  const duplicates = useMemo(() => duplicateReceiptIds(data.receipts), [data.receipts]);
  return <div className="control-list">{data.receipts.map((row) => {
    const editing = editId === row.id;
    const student = data.simple.students.find((item) => item.id === row.payerRefId);
    return <article className={`control-card ${row.deletedAt ? 'deleted' : ''}`} key={row.id}>
      <div className="control-card-head"><div><strong>{student?.name ?? 'تحصيل'}</strong><small>{formatShortDate(row.receivedAt)} · {paymentLabel(row.paymentMethod)}</small></div><div className="money-stack"><b>{money(row.amountPence, currency)}</b>{duplicates.has(row.id) && !row.deletedAt && <span className="duplicate-badge">محتمل مكرر</span>}{row.deletedAt && <span className="deleted-badge">محذوف</span>}</div></div>
      {row.note && <p className="row-note">{row.note}</p>}
      {!row.deletedAt ? <div className="row-actions"><button type="button" onClick={() => setEditId(editing ? null : row.id)}>تعديل</button><button className="danger" type="button" disabled={busy} onClick={() => { if (confirm('حذف هذا التحصيل؟ سيتم إعادة حساب المستحقات تلقائيًا.')) void act(() => deleteLocalReceipt(workspaceId, row.id), 'تم حذف التحصيل وإعادة الحساب.'); }}>حذف</button></div> : <div className="row-actions"><button type="button" disabled={busy} onClick={() => void act(() => restoreLocalReceipt(workspaceId, row.id), 'تم استرجاع التحصيل وإعادة الحساب.')}>استرجاع</button></div>}
      {editing && !row.deletedAt && <form className="control-edit-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void act(async () => { await updateLocalReceipt(workspaceId, row.id, { studentId: String(form.get('studentId') ?? ''), amountPence: toPence(form.get('amount')), receivedAt: String(form.get('date') ?? ''), paymentMethod: String(form.get('method') ?? 'cash') as LocalReceipt['paymentMethod'], note: String(form.get('note') ?? '') }); setEditId(null); }, 'تم تعديل التحصيل وإعادة الحساب.'); }}><label>الطالب<select name="studentId" defaultValue={row.payerRefId}>{data.simple.students.map((studentRow) => <option key={studentRow.id} value={studentRow.id}>{studentRow.name}</option>)}</select></label><label>المبلغ<input name="amount" type="number" min="0.01" step="0.01" defaultValue={row.amountPence / 100} required /></label><label>التاريخ<input name="date" type="date" defaultValue={row.receivedAt.slice(0, 10)} required /></label><label>طريقة الدفع<select name="method" defaultValue={row.paymentMethod}><option value="cash">كاش</option><option value="bank">بنك</option><option value="wallet">محفظة</option><option value="other">أخرى</option></select></label><label className="wide">ملاحظة<input name="note" defaultValue={row.note ?? ''} /></label><button className="save-action wide" type="submit" disabled={busy}>حفظ التعديل</button></form>}
    </article>;
  })}{!data.receipts.length && <Empty text="لا توجد تحصيلات مسجلة." />}</div>;
}

function ExpensesView({ rows, editId, setEditId, busy, currency, act, workspaceId }: CommonListProps & { rows: LocalExpense[] }) {
  return <div className="control-list">{rows.map((row) => <EditableMoneyCard key={row.id} title={row.category} subtitle={`${formatShortDate(row.expenseDate)} · ${row.scope === 'business' ? 'شغل' : 'شخصي'}`} amount={row.amountPence} currency={currency} deleted={Boolean(row.deletedAt)} editing={editId === row.id} busy={busy} onEdit={() => setEditId(editId === row.id ? null : row.id)} onDelete={() => act(() => deleteLocalExpense(workspaceId, row.id), 'تم حذف المصروف.')} onRestore={() => act(() => restoreLocalExpense(workspaceId, row.id), 'تم استرجاع المصروف.')} editForm={<form className="control-edit-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void act(async () => { await updateLocalExpense(workspaceId, row.id, { expenseDate: String(form.get('date') ?? ''), scope: String(form.get('scope') ?? 'personal') as LocalExpense['scope'], category: String(form.get('category') ?? ''), amountPence: toPence(form.get('amount')), note: String(form.get('note') ?? '') }); setEditId(null); }, 'تم تعديل المصروف.'); }}><label>المبلغ<input name="amount" type="number" min="0.01" step="0.01" defaultValue={row.amountPence / 100} required /></label><label>التاريخ<input name="date" type="date" defaultValue={row.expenseDate.slice(0, 10)} required /></label><label>النوع<select name="scope" defaultValue={row.scope}><option value="personal">شخصي</option><option value="business">شغل</option></select></label><label>التصنيف<input name="category" defaultValue={row.category} required /></label><label className="wide">ملاحظة<input name="note" defaultValue={row.note ?? ''} /></label><button className="save-action wide" type="submit" disabled={busy}>حفظ التعديل</button></form>} />)}{!rows.length && <Empty text="لا توجد مصروفات مسجلة." />}</div>;
}

function IncomeView({ rows, editId, setEditId, busy, currency, act, workspaceId }: CommonListProps & { rows: LocalOtherIncome[] }) {
  const [adding, setAdding] = useState(false);
  return <div className="control-list"><button className="control-primary" type="button" onClick={() => setAdding((value) => !value)}>＋ دخل آخر</button>{adding && <form className="control-edit-form control-create-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void act(async () => { await addLocalOtherIncome({ workspaceId, incomeDate: String(form.get('date') ?? ''), category: String(form.get('category') ?? ''), amountPence: toPence(form.get('amount')), note: String(form.get('note') ?? '') }); setAdding(false); }, 'تم تسجيل الدخل الآخر.'); }}><label>المبلغ<input name="amount" type="number" min="0.01" step="0.01" required /></label><label>التاريخ<input name="date" type="date" defaultValue={todayIso()} required /></label><label className="wide">المصدر<input name="category" placeholder="مثال: كورس، مواد، مكافأة" required /></label><label className="wide">ملاحظة<input name="note" /></label><button className="save-action wide" type="submit" disabled={busy}>حفظ</button></form>}{rows.map((row) => <EditableMoneyCard key={row.id} title={row.category} subtitle={formatShortDate(row.incomeDate)} amount={row.amountPence} currency={currency} deleted={Boolean(row.deletedAt)} editing={editId === row.id} busy={busy} onEdit={() => setEditId(editId === row.id ? null : row.id)} onDelete={() => act(() => deleteLocalOtherIncome(workspaceId, row.id), 'تم حذف الدخل الآخر.')} onRestore={() => act(() => restoreLocalOtherIncome(workspaceId, row.id), 'تم استرجاع الدخل الآخر.')} editForm={<form className="control-edit-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void act(async () => { await updateLocalOtherIncome(workspaceId, row.id, { incomeDate: String(form.get('date') ?? ''), category: String(form.get('category') ?? ''), amountPence: toPence(form.get('amount')), note: String(form.get('note') ?? '') }); setEditId(null); }, 'تم تعديل الدخل الآخر.'); }}><label>المبلغ<input name="amount" type="number" min="0.01" step="0.01" defaultValue={row.amountPence / 100} required /></label><label>التاريخ<input name="date" type="date" defaultValue={row.incomeDate.slice(0, 10)} required /></label><label className="wide">المصدر<input name="category" defaultValue={row.category} required /></label><label className="wide">ملاحظة<input name="note" defaultValue={row.note ?? ''} /></label><button className="save-action wide" type="submit" disabled={busy}>حفظ التعديل</button></form>} />)}{!rows.length && !adding && <Empty text="لا يوجد دخل آخر مسجل." />}</div>;
}

function CashView({ data, editId, setEditId, busy, currency, act, workspaceId }: CommonListProps & { data: FullData }) {
  const [adding, setAdding] = useState(false);
  const expected = expectedBalance(data);
  return <div className="control-list"><article className="control-card cash-summary"><small>المفروض يكون موجود حسب كل البيانات المسجلة</small><strong>{money(expected, currency)}</strong><button className="control-primary" type="button" onClick={() => setAdding((value) => !value)}>مطابقة جديدة</button></article>{adding && <form className="control-edit-form control-create-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void act(async () => { await addLocalCashCheck({ workspaceId, checkDate: String(form.get('date') ?? ''), expectedBalancePence: expected, actualBalancePence: toPenceSigned(form.get('actual')), note: String(form.get('note') ?? '') }); setAdding(false); }, 'تم حفظ مطابقة الرصيد.'); }}><label>الموجود فعليًا<input name="actual" type="number" step="0.01" required /></label><label>التاريخ<input name="date" type="date" defaultValue={todayIso()} required /></label><label className="wide">ملاحظة<input name="note" /></label><button className="save-action wide" type="submit" disabled={busy}>حفظ المطابقة</button></form>}{data.cashChecks.map((row) => { const editing = editId === row.id; return <article className={`control-card ${row.deletedAt ? 'deleted' : ''}`} key={row.id}><div className="control-card-head"><div><strong>{formatShortDate(row.checkDate)}</strong><small>المتوقع {money(row.expectedBalancePence, currency)} · الفعلي {money(row.actualBalancePence, currency)}</small></div><div className="money-stack"><b className={row.differencePence === 0 ? 'cash-ok' : 'cash-diff'}>{row.differencePence > 0 ? '+' : ''}{money(row.differencePence, currency)}</b>{row.deletedAt && <span className="deleted-badge">محذوف</span>}</div></div>{row.note && <p className="row-note">{row.note}</p>}{!row.deletedAt ? <div className="row-actions"><button type="button" onClick={() => setEditId(editing ? null : row.id)}>تعديل</button><button className="danger" type="button" onClick={() => void act(() => deleteLocalCashCheck(workspaceId, row.id), 'تم حذف المطابقة.')}>حذف</button></div> : <div className="row-actions"><button type="button" onClick={() => void act(() => restoreLocalCashCheck(workspaceId, row.id), 'تم استرجاع المطابقة.')}>استرجاع</button></div>}{editing && !row.deletedAt && <form className="control-edit-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void act(async () => { const actual = toPenceSigned(form.get('actual')); await updateLocalCashCheck(workspaceId, row.id, { checkDate: String(form.get('date') ?? ''), expectedBalancePence: row.expectedBalancePence, actualBalancePence: actual, note: String(form.get('note') ?? '') }); setEditId(null); }, 'تم تعديل المطابقة.'); }}><label>الموجود فعليًا<input name="actual" type="number" step="0.01" defaultValue={row.actualBalancePence / 100} required /></label><label>التاريخ<input name="date" type="date" defaultValue={row.checkDate.slice(0, 10)} required /></label><label className="wide">ملاحظة<input name="note" defaultValue={row.note ?? ''} /></label><button className="save-action wide" type="submit">حفظ التعديل</button></form>}</article>; })}{!data.cashChecks.length && !adding && <Empty text="لم تتم مطابقة الرصيد بعد." />}</div>;
}

function StudentsView({ data, profileId, setProfileId, editId, setEditId, busy, currency, act, workspaceId }: CommonListProps & { data: FullData; profileId: string | null; setProfileId: (id: string | null) => void }) {
  const student = data.simple.students.find((row) => row.id === profileId) ?? null;
  if (!student) return <div className="control-list">{data.simple.students.map((row) => <button className="student-control-row" type="button" key={row.id} onClick={() => setProfileId(row.id)}><span className="student-avatar-control">{row.name.trim().charAt(0)}</span><span><strong>{row.name}</strong><small>{row.guardianName || 'ولي الأمر غير مسجل'}</small></span><b>فتح</b></button>)}{!data.simple.students.length && <Empty text="لا يوجد طلاب." />}</div>;
  const sessions = data.simple.sessions.filter((row) => row.studentIds.includes(student.id));
  const receipts = data.receipts.filter((row) => row.payerRefId === student.id && !row.deletedAt);
  const cycles = data.simple.billingCycles.filter((row) => row.studentId === student.id && row.status !== 'cancelled').sort((a, b) => b.sequenceNo - a.sequenceNo);
  const cycle = cycles[0];
  return <div className="student-profile-control"><div className="profile-top"><button type="button" onClick={() => { setProfileId(null); setEditId(null); }}>رجوع</button><div><small>ملف الطالب</small><h3>{student.name}</h3></div><button type="button" onClick={() => setEditId(editId === student.id ? null : student.id)}>تعديل</button></div><div className="profile-metrics"><div><span>الباقة</span><strong>{cycle ? `${cycle.openingCompletedCount + cycle.realCompletedCount}/${cycle.sessionLimit}` : 'بالحصة'}</strong></div><div><span>المدفوع</span><strong>{money(sum(receipts.map((row) => row.amountPence)), currency)}</strong></div><div><span>المواعيد</span><strong>{sessions.length}</strong></div></div>{editId === student.id ? <StudentForm student={student} busy={busy} onSubmit={(form) => act(async () => { await updateLocalStudent(workspaceId, student.id, { name: String(form.get('name') ?? ''), age: form.get('age') ? Number(form.get('age')) : null, guardianName: String(form.get('guardian') ?? ''), guardianPhone: String(form.get('phone') ?? ''), level: String(form.get('level') ?? ''), notes: String(form.get('notes') ?? '') }); setEditId(null); }, 'تم تعديل بيانات الطالب.')} /> : <div className="profile-info"><p><span>ولي الأمر</span><b>{student.guardianName || 'غير مسجل'}</b></p><p><span>الهاتف</span><b>{student.guardianPhone || 'غير مسجل'}</b></p><p><span>المستوى</span><b>{student.level || 'غير مسجل'}</b></p>{student.notes && <p><span>ملاحظات</span><b>{student.notes}</b></p>}</div>}<h4>المواعيد</h4><div className="mini-history">{sessions.map((row) => <div key={row.id}><strong>{row.title}</strong><small>{row.scheduleStatus === 'pending' ? 'موعد غير محدد' : `${weekday(row.weekday)} · ${row.startTime ?? 'غير محدد'}`}</small></div>)}</div><h4>آخر التحصيلات</h4><div className="mini-history">{receipts.slice(0, 10).map((row) => <div key={row.id}><strong>{money(row.amountPence, currency)}</strong><small>{formatShortDate(row.receivedAt)}</small></div>)}</div></div>;
}

function SessionsView({ data, editId, setEditId, busy, act, workspaceId }: CommonListProps & { data: FullData }) {
  const session = data.sessions.find((row) => row.id === editId) ?? null;
  if (!session) return <div className="control-list">{data.sessions.filter((row) => row.active).map((row) => <button className="student-control-row" type="button" key={row.id} onClick={() => setEditId(row.id)}><span className="student-avatar-control">{row.title.trim().charAt(0)}</span><span><strong>{row.title}</strong><small>{row.scheduleStatus === 'pending' ? 'موعد غير محدد' : `${weekday(row.weekday)} · ${row.startTime ?? 'غير محدد'}`}</small></span><b>تعديل</b></button>)}{!data.sessions.filter((row) => row.active).length && <Empty text="لا توجد حصص متكررة نشطة." />}</div>;
  return <div className="student-profile-control"><div className="profile-top"><button type="button" onClick={() => setEditId(null)}>رجوع</button><div><small>تعديل الحصة</small><h3>{session.title}</h3></div><button className="danger-inline" type="button" disabled={busy} onClick={() => { if (confirm('إيقاف هذا الموعد المتكرر؟ التاريخ السابق سيظل محفوظًا.')) void act(async () => { await archiveLocalSession(workspaceId, session.id); setEditId(null); }, 'تم إيقاف الموعد مع الاحتفاظ بالتاريخ.'); }}>إيقاف</button></div><form className="control-edit-form session-full-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void act(async () => { await updateLocalSessionDetails(workspaceId, session.id, { title: String(form.get('title') ?? ''), sessionType: String(form.get('sessionType') ?? 'online') as RecurringSession['sessionType'], scheduleStatus: String(form.get('scheduleStatus') ?? 'confirmed') as RecurringSession['scheduleStatus'], weekday: form.get('weekday') === '' ? null : Number(form.get('weekday')), startTime: String(form.get('startTime') ?? '') || null, durationMinutes: Number(form.get('duration') ?? 60), travelMinutes: Number(form.get('travel') ?? 0), location: String(form.get('location') ?? '') || null, priceBasis: String(form.get('priceBasis') ?? 'total_session') as RecurringSession['priceBasis'], defaultPricePence: toPenceZero(form.get('price')), expectedStudentCount: Number(form.get('studentCount') ?? 1), centerCutBps: Math.round(Number(form.get('centerCut') ?? 0) * 100), studentIds: form.getAll('studentIds').map(String) }); setEditId(null); }, 'تم تعديل بيانات الحصة القادمة.'); }}><label className="wide">الاسم<input name="title" defaultValue={session.title} required /></label><label>النوع<select name="sessionType" defaultValue={session.sessionType}><option value="private_student_home">خاص عند الطالب</option><option value="private_tutor_home">خاص عند المدرس</option><option value="online">أونلاين</option><option value="center_group">السنتر</option><option value="own_group">مجموعة خاصة</option></select></label><label>حالة الموعد<select name="scheduleStatus" defaultValue={session.scheduleStatus}><option value="confirmed">محدد</option><option value="pending">لسه غير محدد</option></select></label><label>اليوم<select name="weekday" defaultValue={session.weekday ?? ''}><option value="">غير محدد</option>{['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'].map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label><label>الوقت<input name="startTime" type="time" defaultValue={session.startTime ?? ''} /></label><label>المدة بالدقائق<input name="duration" type="number" min="15" max="360" defaultValue={session.durationMinutes} /></label><label>وقت الانتقال<input name="travel" type="number" min="0" max="360" defaultValue={session.travelMinutes} /></label><label className="wide">المكان<input name="location" defaultValue={session.location ?? ''} /></label><label>طريقة التسعير<select name="priceBasis" defaultValue={session.priceBasis}><option value="total_session">سعر الحصة بالكامل</option><option value="per_student">سعر لكل طالب</option></select></label><label>السعر<input name="price" type="number" min="0" step="0.01" defaultValue={session.defaultPricePence / 100} /></label><label>عدد الطلاب المتوقع<input name="studentCount" type="number" min="1" max="100" defaultValue={session.expectedStudentCount} /></label><label>عمولة السنتر %<input name="centerCut" type="number" min="0" max="100" step="0.01" defaultValue={session.centerCutBps / 100} /></label><fieldset className="student-picker wide"><legend>الطلاب المرتبطون بالحصة</legend>{data.simple.students.map((student) => <label key={student.id}><input type="checkbox" name="studentIds" value={student.id} defaultChecked={session.studentIds.includes(student.id)} />{student.name}</label>)}</fieldset><p className="wide session-lock-note">لو للحصة تاريخ مكتمل، بيانات التسعير والطلاب تظل مقفولة لحماية الحسابات القديمة؛ اليوم والوقت والمدة والمكان يمكن تعديلهم.</p><button className="save-action wide" type="submit" disabled={busy}>حفظ كل التفاصيل</button></form></div>;
}

function ReportView({ data, currency }: { data: SimpleWorkspaceData; currency: string }) {
  const report = buildWorkspaceReport(data);
  return <div className="report-view"><div className="profile-metrics report-metrics"><div><span>حصص مكتملة</span><strong>{report.completedLessons}</strong></div><div><span>صافي الحركة</span><strong>{money(report.netCashPence, currency)}</strong></div><div><span>مطلوب تحصيله</span><strong>{money(report.duePence, currency)}</strong></div></div><article className="control-card"><small>آخر 28 يومًا</small><div className="report-grid"><p><span>المقبوض</span><b>{money(report.receivedPence, currency)}</b></p><p><span>دخل آخر</span><b>{money(report.otherIncomePence, currency)}</b></p><p><span>المصروفات</span><b>{money(report.expensesPence, currency)}</b></p><p><span>الإلغاءات/الفائت</span><b>{report.cancelledLessons}</b></p><p><span>وقت التدريس</span><b>{report.teachingMinutes} د</b></p><p><span>وقت الانتقال</span><b>{report.travelMinutes} د</b></p><p><span>العائد الحقيقي/ساعة</span><b>{money(report.effectiveHourlyPence, currency)}</b></p></div></article><div className="control-list">{report.insights.map((insight) => <article className={`report-insight ${insight.level}`} key={insight.key}><strong>{insight.title}</strong><p>{insight.detail}</p></article>)}</div></div>;
}

function EditableMoneyCard({ title, subtitle, amount, currency, deleted, editing, busy, onEdit, onDelete, onRestore, editForm }: { title: string; subtitle: string; amount: number; currency: string; deleted: boolean; editing: boolean; busy: boolean; onEdit: () => void; onDelete: () => Promise<boolean>; onRestore: () => Promise<boolean>; editForm: React.ReactNode }) {
  return <article className={`control-card ${deleted ? 'deleted' : ''}`}><div className="control-card-head"><div><strong>{title}</strong><small>{subtitle}</small></div><div className="money-stack"><b>{money(amount, currency)}</b>{deleted && <span className="deleted-badge">محذوف</span>}</div></div>{!deleted ? <div className="row-actions"><button type="button" onClick={onEdit}>تعديل</button><button className="danger" type="button" disabled={busy} onClick={() => { if (confirm('حذف هذا المدخل؟')) void onDelete(); }}>حذف</button></div> : <div className="row-actions"><button type="button" disabled={busy} onClick={() => void onRestore()}>استرجاع</button></div>}{editing && !deleted && editForm}</article>;
}

function StudentForm({ student, busy, onSubmit }: { student: Student; busy: boolean; onSubmit: (form: FormData) => Promise<boolean> }) {
  return <form className="control-edit-form" onSubmit={(event) => { event.preventDefault(); void onSubmit(new FormData(event.currentTarget)); }}><label>الاسم<input name="name" defaultValue={student.name} required /></label><label>العمر<input name="age" type="number" min="1" max="120" defaultValue={student.age ?? ''} /></label><label>ولي الأمر<input name="guardian" defaultValue={student.guardianName ?? ''} /></label><label>الهاتف<input name="phone" defaultValue={student.guardianPhone ?? ''} /></label><label>المستوى<input name="level" defaultValue={student.level ?? ''} /></label><label>ملاحظات<input name="notes" defaultValue={student.notes ?? ''} /></label><button className="save-action wide" type="submit" disabled={busy}>حفظ البيانات</button></form>;
}

type CommonListProps = {
  editId: string | null;
  setEditId: (id: string | null) => void;
  busy: boolean;
  currency?: string;
  workspaceId: string;
  act: (action: () => Promise<void>, success: string) => Promise<boolean>;
};

function expectedBalance(data: FullData): number {
  return sum(data.receipts.filter((row) => !row.deletedAt).map((row) => row.amountPence))
    + sum(data.income.filter((row) => !row.deletedAt).map((row) => row.amountPence))
    - sum(data.expenses.filter((row) => !row.deletedAt).map((row) => row.amountPence));
}

function undoSupported(event: LocalActivityEvent): boolean {
  return ['receipt.deleted','expense.deleted','income.deleted','cash.deleted','receipt.updated','expense.updated','income.updated','cash.updated','student.updated'].includes(event.action);
}

function paymentLabel(value: LocalReceipt['paymentMethod']): string {
  return ({ cash: 'كاش', bank: 'بنك', wallet: 'محفظة', other: 'أخرى' } as const)[value];
}

function weekday(value: number | null): string {
  return value === null ? 'اليوم غير محدد' : ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'][value] ?? 'غير محدد';
}

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try { return JSON.parse(value) as T; } catch { return null; }
}

function toPence(value: FormDataEntryValue | null): number {
  const number = Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(number) || number <= 0) throw new Error('AMOUNT_INVALID');
  return Math.round(number * 100);
}

function toPenceZero(value: FormDataEntryValue | null): number {
  const number = Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(number) || number < 0) throw new Error('AMOUNT_INVALID');
  return Math.round(number * 100);
}

function toPenceSigned(value: FormDataEntryValue | null): number {
  const number = Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(number)) throw new Error('AMOUNT_INVALID');
  return Math.round(number * 100);
}

function money(pence: number, label: string): string {
  const sign = pence < 0 ? '−' : '';
  return `${sign}${(Math.abs(pence) / 100).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ${label}`;
}

function sum(values: number[]): number { return values.reduce((total, value) => total + Number(value || 0), 0); }
function todayIso(): string { return new Date().toISOString().slice(0, 10); }
function formatShortDate(value: string): string { try { return new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${value.slice(0, 10)}T12:00:00`)); } catch { return value.slice(0, 10); } }
function formatDateTime(value: string): string { try { return new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(value)); } catch { return value; } }
function Empty({ text }: { text: string }) { return <div className="control-empty">{text}</div>; }

function errorText(cause: unknown): string {
  const code = cause instanceof Error ? cause.message : 'UNKNOWN';
  const map: Record<string, string> = {
    AMOUNT_INVALID: 'اكتبي مبلغًا صحيحًا.',
    RECEIPT_NOT_FOUND: 'التحصيل غير موجود.',
    EXPENSE_NOT_FOUND: 'المصروف غير موجود.',
    INCOME_NOT_FOUND: 'الدخل غير موجود.',
    CASH_CHECK_NOT_FOUND: 'مطابقة الرصيد غير موجودة.',
    STUDENT_NOT_FOUND: 'الطالب غير موجود.',
    SESSION_NOT_FOUND: 'الحصة غير موجودة.',
    SESSION_FINANCE_LOCKED_BY_HISTORY: 'للحصة تاريخ سابق؛ لا يمكن تغيير التسعير أو الطلاب لأنها ستغيّر الحسابات القديمة. يمكنك تعديل اليوم والوقت والمدة والمكان.',
    SCHEDULE_DAY_REQUIRED: 'اختاري يومًا للموعد المؤكد.',
    SCHEDULE_TIME_REQUIRED: 'اختاري وقتًا للموعد المؤكد.',
    UNDO_NOT_SUPPORTED: 'هذا التغيير لا يدعم التراجع التلقائي.',
  };
  return map[code] ?? `تعذر إكمال العملية (${code})`;
}
