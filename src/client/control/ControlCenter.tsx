import { type FormEvent, useEffect, useMemo, useState } from 'react';
import type { Student } from '../../modules/tutoring/domain/student';
import type { RecurringSession } from '../../modules/tutoring/domain/session';
import type { LocalPlatformSnapshot } from '../adapters/indexeddb/platform.repository';
import { openLocalDatabase, requestResult, STORES } from '../adapters/indexeddb/database';
import {
  listLocalActivity,
  markActivityUndone,
  type LocalActivityEvent,
} from '../activity/local-activity';
import {
  deleteLocalExpense,
  deleteLocalReceipt,
  restoreLocalExpense,
  restoreLocalReceipt,
  updateLocalExpense,
  updateLocalReceipt,
} from '../finance/corrections';
import { loadSimpleWorkspaceData, type LocalExpense, type LocalOccurrence, type SimpleWorkspaceData } from '../simple/data';
import { runWorkspaceSync } from '../sync/engine';
import {
  cancelLocalOccurrence,
  reopenLocalOccurrence,
  rescheduleLocalOccurrence,
  restoreLocalOccurrence,
} from '../tutoring/attendance-corrections';
import type { LocalReceipt } from '../tutoring/local-commands';
import { updateLocalStudent } from '../tutoring/student-corrections';
import { duplicateReceiptIds } from './correction-model';

type Tab = 'activity' | 'receipts' | 'expenses' | 'students' | 'sessions';

type ControlData = {
  simple: SimpleWorkspaceData;
  receipts: LocalReceipt[];
  expenses: LocalExpense[];
  activity: LocalActivityEvent[];
};

export function ControlCenter({
  snapshot,
  onChanged,
}: {
  snapshot: LocalPlatformSnapshot;
  onChanged: () => Promise<void> | void;
}) {
  const workspaceId = snapshot.workspace.id;
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('activity');
  const [data, setData] = useState<ControlData | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [receiptEdit, setReceiptEdit] = useState<string | null>(null);
  const [expenseEdit, setExpenseEdit] = useState<string | null>(null);
  const [studentEdit, setStudentEdit] = useState<string | null>(null);
  const [studentProfile, setStudentProfile] = useState<string | null>(null);
  const [moveOccurrence, setMoveOccurrence] = useState<string | null>(null);

  const load = async (syncFirst = false) => {
    if (syncFirst && snapshot.cloudLink && navigator.onLine) {
      try { await runWorkspaceSync(workspaceId); } catch { /* local data remains usable */ }
    }
    const db = await openLocalDatabase();
    const read = db.transaction([STORES.financeReceipts, STORES.financeExpenses], 'readonly');
    const [simple, receipts, expenses, activity] = await Promise.all([
      loadSimpleWorkspaceData(workspaceId),
      requestResult<LocalReceipt[]>(read.objectStore(STORES.financeReceipts).getAll()),
      requestResult<LocalExpense[]>(read.objectStore(STORES.financeExpenses).getAll()),
      listLocalActivity(workspaceId),
    ]);
    setData({
      simple,
      receipts: receipts.filter((row) => row.workspaceId === workspaceId).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || b.id.localeCompare(a.id)),
      expenses: expenses.filter((row) => row.workspaceId === workspaceId).sort((a, b) => b.expenseDate.localeCompare(a.expenseDate) || b.id.localeCompare(a.id)),
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

  const act = async (action: () => Promise<void>, success: string) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
      await afterWrite(success);
      return true;
    } catch (cause) {
      setError(controlError(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const undo = async (event: LocalActivityEvent) => {
    if (!event.entityId || event.undoneAt) return;
    const before = parseJson<Record<string, unknown>>(event.beforeJson);
    const simple = data?.simple;
    if (!simple) return;
    const ok = await act(async () => {
      if (event.action === 'receipt.deleted') {
        await restoreLocalReceipt(workspaceId, event.entityId as string);
      } else if (event.action === 'expense.deleted') {
        await restoreLocalExpense(workspaceId, event.entityId as string);
      } else if (event.action === 'receipt.updated' && before) {
        await updateLocalReceipt(workspaceId, event.entityId as string, {
          studentId: String(before.payerRefId ?? ''),
          amountPence: Number(before.amountPence ?? 0),
          receivedAt: String(before.receivedAt ?? ''),
          paymentMethod: String(before.paymentMethod ?? 'cash') as LocalReceipt['paymentMethod'],
          note: before.note ? String(before.note) : null,
        });
      } else if (event.action === 'expense.updated' && before) {
        await updateLocalExpense(workspaceId, event.entityId as string, {
          expenseDate: String(before.expenseDate ?? ''),
          scope: String(before.scope ?? 'personal') as LocalExpense['scope'],
          category: String(before.category ?? ''),
          amountPence: Number(before.amountPence ?? 0),
          note: before.note ? String(before.note) : null,
        });
      } else if (event.action === 'student.updated' && before) {
        await updateLocalStudent(workspaceId, event.entityId as string, {
          name: String(before.name ?? ''),
          age: typeof before.age === 'number' ? before.age : null,
          guardianName: before.guardianName ? String(before.guardianName) : '',
          guardianPhone: before.guardianPhone ? String(before.guardianPhone) : '',
          level: before.level ? String(before.level) : '',
          notes: before.notes ? String(before.notes) : '',
        });
      } else {
        throw new Error('UNDO_NOT_SUPPORTED');
      }
      await markActivityUndone(event.id, workspaceId);
    }, 'تم التراجع عن التغيير.');
    if (ok) setTab('activity');
  };

  return (
    <>
      <button className="control-launcher" type="button" onClick={() => setOpen(true)} aria-label="السجل والتعديل">
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
              <TabButton active={tab === 'activity'} onClick={() => setTab('activity')}>السجل</TabButton>
              <TabButton active={tab === 'receipts'} onClick={() => setTab('receipts')}>التحصيلات</TabButton>
              <TabButton active={tab === 'expenses'} onClick={() => setTab('expenses')}>المصروفات</TabButton>
              <TabButton active={tab === 'students'} onClick={() => setTab('students')}>الطلاب</TabButton>
              <TabButton active={tab === 'sessions'} onClick={() => setTab('sessions')}>الحصص</TabButton>
            </nav>

            {message && <div className="control-message good">{message}</div>}
            {error && <div className="control-message bad">{error}</div>}
            {!data && <div className="control-loading">جاري تحميل السجل…</div>}

            {data && tab === 'activity' && <ActivityTab events={data.activity} busy={busy} onUndo={undo} />}
            {data && tab === 'receipts' && (
              <ReceiptsTab
                data={data}
                currency={snapshot.workspace.currencyLabel}
                editingId={receiptEdit}
                busy={busy}
                onEdit={setReceiptEdit}
                onSave={(id, form) => act(async () => {
                  await updateLocalReceipt(workspaceId, id, {
                    studentId: String(form.get('studentId') ?? ''),
                    amountPence: toPence(form.get('amount')),
                    receivedAt: String(form.get('receivedAt') ?? ''),
                    paymentMethod: String(form.get('paymentMethod') ?? 'cash') as LocalReceipt['paymentMethod'],
                    note: String(form.get('note') ?? ''),
                  });
                  setReceiptEdit(null);
                }, 'تم تعديل التحصيل وإعادة حساب المستحقات.')}
                onDelete={(id) => act(() => deleteLocalReceipt(workspaceId, id), 'تم حذف التحصيل. يمكنك استرجاعه من السجل.')}
                onRestore={(id) => act(() => restoreLocalReceipt(workspaceId, id), 'تم استرجاع التحصيل وإعادة الحساب.')}
              />
            )}
            {data && tab === 'expenses' && (
              <ExpensesTab
                expenses={data.expenses}
                currency={snapshot.workspace.currencyLabel}
                editingId={expenseEdit}
                busy={busy}
                onEdit={setExpenseEdit}
                onSave={(id, form) => act(async () => {
                  await updateLocalExpense(workspaceId, id, {
                    expenseDate: String(form.get('expenseDate') ?? ''),
                    scope: String(form.get('scope') ?? 'personal') as LocalExpense['scope'],
                    category: String(form.get('category') ?? ''),
                    amountPence: toPence(form.get('amount')),
                    note: String(form.get('note') ?? ''),
                  });
                  setExpenseEdit(null);
                }, 'تم تعديل المصروف.')}
                onDelete={(id) => act(() => deleteLocalExpense(workspaceId, id), 'تم حذف المصروف. يمكنك استرجاعه من السجل.')}
                onRestore={(id) => act(() => restoreLocalExpense(workspaceId, id), 'تم استرجاع المصروف.')}
              />
            )}
            {data && tab === 'students' && (
              <StudentsTab
                data={data}
                currency={snapshot.workspace.currencyLabel}
                profileId={studentProfile}
                editingId={studentEdit}
                busy={busy}
                onProfile={setStudentProfile}
                onEdit={setStudentEdit}
                onSave={(id, form) => act(async () => {
                  await updateLocalStudent(workspaceId, id, {
                    name: String(form.get('name') ?? ''),
                    age: form.get('age') ? Number(form.get('age')) : null,
                    guardianName: String(form.get('guardianName') ?? ''),
                    guardianPhone: String(form.get('guardianPhone') ?? ''),
                    level: String(form.get('level') ?? ''),
                    notes: String(form.get('notes') ?? ''),
                  });
                  setStudentEdit(null);
                }, 'تم تعديل بيانات الطالب.')}
              />
            )}
            {data && tab === 'sessions' && (
              <SessionsTab
                data={data.simple}
                movingId={moveOccurrence}
                busy={busy}
                onMove={setMoveOccurrence}
                onCancel={(session, occurrence, date) => act(
                  () => cancelLocalOccurrence(workspaceId, session, date, occurrence?.id),
                  'تم إلغاء الحصة.',
                )}
                onRestore={(session, occurrence, date) => act(
                  () => restoreLocalOccurrence(workspaceId, session, date, occurrence?.id),
                  'تم استرجاع الحصة.',
                )}
                onReopen={(occurrence) => act(
                  () => reopenLocalOccurrence(workspaceId, occurrence.id),
                  'رجعت الحصة لمجدولة وتمت إعادة حساب الباقة والمستحقات.',
                )}
                onReschedule={(session, occurrence, form) => act(async () => {
                  await rescheduleLocalOccurrence(
                    workspaceId,
                    session,
                    occurrence.rescheduledToDate ?? occurrence.sessionDate,
                    String(form.get('date') ?? ''),
                    String(form.get('startTime') ?? '') || null,
                    String(form.get('note') ?? ''),
                    occurrence.id,
                  );
                  setMoveOccurrence(null);
                }, 'تم نقل الحصة فقط بدون تغيير الجدول الأسبوعي.')}
              />
            )}
          </section>
        </div>
      )}
    </>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return <button type="button" className={active ? 'active' : ''} onClick={onClick}>{children}</button>;
}

function ActivityTab({ events, busy, onUndo }: { events: LocalActivityEvent[]; busy: boolean; onUndo: (event: LocalActivityEvent) => void }) {
  return (
    <div className="control-list">
      {events.map((event) => (
        <article className={`control-row ${event.undoneAt ? 'muted' : ''}`} key={event.id}>
          <div className="control-row-main"><strong>{event.title}</strong><small>{formatDateTime(event.createdAt)}{event.undoneAt ? ' · تم التراجع' : ''}</small>{event.detail && <p>{event.detail}</p>}</div>
          {event.undoable && !event.undoneAt && canUndo(event) && <button type="button" className="mini-action" disabled={busy} onClick={() => onUndo(event)}>تراجع</button>}
        </article>
      ))}
      {!events.length && <Empty text="أي تعديل أو حذف جديد هيظهر هنا مع وقته." />}
    </div>
  );
}

function ReceiptsTab({
  data, currency, editingId, busy, onEdit, onSave, onDelete, onRestore,
}: {
  data: ControlData;
  currency: string;
  editingId: string | null;
  busy: boolean;
  onEdit: (id: string | null) => void;
  onSave: (id: string, form: FormData) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onRestore: (id: string) => Promise<boolean>;
}) {
  const duplicates = useMemo(() => duplicateReceiptIds(data.receipts), [data.receipts]);
  return (
    <div className="control-list">
      {data.receipts.map((receipt) => {
        const student = data.simple.students.find((row) => row.id === receipt.payerRefId);
        const editing = editingId === receipt.id;
        return (
          <article className={`control-card ${receipt.deletedAt ? 'deleted' : ''}`} key={receipt.id}>
            <div className="control-card-head">
              <div><strong>{student?.name ?? 'تحصيل'}</strong><small>{formatShortDate(receipt.receivedAt)} · {paymentLabel(receipt.paymentMethod)}</small></div>
              <div className="money-stack"><b>{money(receipt.amountPence, currency)}</b>{duplicates.has(receipt.id) && !receipt.deletedAt && <span className="duplicate-badge">محتمل مكرر</span>}{receipt.deletedAt && <span className="deleted-badge">محذوف</span>}</div>
            </div>
            {receipt.note && <p className="row-note">{receipt.note}</p>}
            {!receipt.deletedAt && <div className="row-actions"><button type="button" onClick={() => onEdit(editing ? null : receipt.id)}>تعديل</button><button type="button" className="danger" disabled={busy} onClick={() => { if (confirm('حذف هذا التحصيل؟ سيتم إعادة حساب المستحقات تلقائيًا.')) void onDelete(receipt.id); }}>حذف</button></div>}
            {receipt.deletedAt && <div className="row-actions"><button type="button" disabled={busy} onClick={() => void onRestore(receipt.id)}>استرجاع</button></div>}
            {editing && !receipt.deletedAt && (
              <form className="control-edit-form" onSubmit={(event) => { event.preventDefault(); void onSave(receipt.id, new FormData(event.currentTarget)); }}>
                <label>الطالب<select name="studentId" defaultValue={receipt.payerRefId}>{data.simple.students.map((student) => <option key={student.id} value={student.id}>{student.name}</option>)}</select></label>
                <label>المبلغ<input name="amount" type="number" min="0.01" step="0.01" defaultValue={(receipt.amountPence / 100).toString()} required /></label>
                <label>التاريخ<input name="receivedAt" type="date" defaultValue={receipt.receivedAt.slice(0, 10)} required /></label>
                <label>طريقة الدفع<select name="paymentMethod" defaultValue={receipt.paymentMethod}><option value="cash">كاش</option><option value="bank">بنك</option><option value="wallet">محفظة</option><option value="other">أخرى</option></select></label>
                <label className="wide">ملاحظة<input name="note" defaultValue={receipt.note ?? ''} /></label>
                <button className="save-action wide" type="submit" disabled={busy}>حفظ التعديل</button>
              </form>
            )}
          </article>
        );
      })}
      {!data.receipts.length && <Empty text="لا توجد تحصيلات مسجلة." />}
    </div>
  );
}

function ExpensesTab({ expenses, currency, editingId, busy, onEdit, onSave, onDelete, onRestore }: {
  expenses: LocalExpense[];
  currency: string;
  editingId: string | null;
  busy: boolean;
  onEdit: (id: string | null) => void;
  onSave: (id: string, form: FormData) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onRestore: (id: string) => Promise<boolean>;
}) {
  return (
    <div className="control-list">
      {expenses.map((expense) => {
        const editing = editingId === expense.id;
        return (
          <article className={`control-card ${expense.deletedAt ? 'deleted' : ''}`} key={expense.id}>
            <div className="control-card-head"><div><strong>{expense.category}</strong><small>{formatShortDate(expense.expenseDate)} · {expense.scope === 'business' ? 'شغل' : 'شخصي'}</small></div><div className="money-stack"><b>{money(expense.amountPence, currency)}</b>{expense.deletedAt && <span className="deleted-badge">محذوف</span>}</div></div>
            {expense.note && <p className="row-note">{expense.note}</p>}
            {!expense.deletedAt && <div className="row-actions"><button type="button" onClick={() => onEdit(editing ? null : expense.id)}>تعديل</button><button type="button" className="danger" disabled={busy} onClick={() => { if (confirm('حذف هذا المصروف؟')) void onDelete(expense.id); }}>حذف</button></div>}
            {expense.deletedAt && <div className="row-actions"><button type="button" disabled={busy} onClick={() => void onRestore(expense.id)}>استرجاع</button></div>}
            {editing && !expense.deletedAt && (
              <form className="control-edit-form" onSubmit={(event) => { event.preventDefault(); void onSave(expense.id, new FormData(event.currentTarget)); }}>
                <label>المبلغ<input name="amount" type="number" min="0.01" step="0.01" defaultValue={(expense.amountPence / 100).toString()} required /></label>
                <label>التاريخ<input name="expenseDate" type="date" defaultValue={expense.expenseDate.slice(0, 10)} required /></label>
                <label>النوع<select name="scope" defaultValue={expense.scope}><option value="personal">شخصي</option><option value="business">شغل</option></select></label>
                <label>التصنيف<input name="category" defaultValue={expense.category} required /></label>
                <label className="wide">ملاحظة<input name="note" defaultValue={expense.note ?? ''} /></label>
                <button className="save-action wide" type="submit" disabled={busy}>حفظ التعديل</button>
              </form>
            )}
          </article>
        );
      })}
      {!expenses.length && <Empty text="لا توجد مصروفات مسجلة." />}
    </div>
  );
}

function StudentsTab({ data, currency, profileId, editingId, busy, onProfile, onEdit, onSave }: {
  data: ControlData;
  currency: string;
  profileId: string | null;
  editingId: string | null;
  busy: boolean;
  onProfile: (id: string | null) => void;
  onEdit: (id: string | null) => void;
  onSave: (id: string, form: FormData) => Promise<boolean>;
}) {
  const student = data.simple.students.find((row) => row.id === profileId) ?? null;
  if (student) {
    const sessions = data.simple.sessions.filter((row) => row.studentIds.includes(student.id));
    const sessionIds = new Set(sessions.map((row) => row.id));
    const occurrences = data.simple.occurrences.filter((row) => sessionIds.has(row.recurringSessionId)).sort((a, b) => b.sessionDate.localeCompare(a.sessionDate));
    const receipts = data.receipts.filter((row) => row.payerRefId === student.id);
    const plan = data.simple.billingPlans.find((row) => row.studentId === student.id);
    const cycle = data.simple.billingCycles.filter((row) => row.studentId === student.id && row.status !== 'cancelled').sort((a, b) => b.sequenceNo - a.sequenceNo)[0];
    const progress = plan?.billingMode === 'package' ? `${(cycle?.openingCompletedCount ?? 0) + (cycle?.realCompletedCount ?? 0)}/${cycle?.sessionLimit ?? plan.packageSize ?? 8}` : 'بالحصة';
    return (
      <div className="student-profile-control">
        <div className="profile-top"><button type="button" onClick={() => { onProfile(null); onEdit(null); }}>رجوع</button><div><small>ملف الطالب</small><h3>{student.name}</h3></div><button type="button" onClick={() => onEdit(editingId === student.id ? null : student.id)}>تعديل</button></div>
        <div className="profile-metrics"><div><span>النظام</span><strong>{progress}</strong></div><div><span>المدفوع</span><strong>{money(receipts.filter((row) => !row.deletedAt).reduce((sum, row) => sum + row.amountPence, 0), currency)}</strong></div><div><span>المواعيد</span><strong>{sessions.length}</strong></div></div>
        {editingId === student.id ? (
          <StudentEditForm student={student} busy={busy} onSave={(form) => onSave(student.id, form)} />
        ) : (
          <div className="profile-info"><p><span>ولي الأمر</span><b>{student.guardianName || 'غير مسجل'}</b></p><p><span>الهاتف</span><b>{student.guardianPhone || 'غير مسجل'}</b></p><p><span>المستوى</span><b>{student.level || 'غير مسجل'}</b></p>{student.notes && <p><span>ملاحظات</span><b>{student.notes}</b></p>}</div>
        )}
        <h4>المواعيد</h4>
        <div className="mini-history">{sessions.map((session) => <div key={session.id}><strong>{session.title}</strong><small>{session.scheduleStatus === 'pending' ? 'موعد غير محدد' : `${weekdayLabel(session.weekday)} · ${session.startTime ?? 'غير محدد'}`}</small></div>)}{!sessions.length && <Empty text="لا توجد مواعيد نشطة." />}</div>
        <h4>التحصيلات</h4>
        <div className="mini-history">{receipts.slice(0, 12).map((receipt) => <div className={receipt.deletedAt ? 'muted' : ''} key={receipt.id}><strong>{money(receipt.amountPence, currency)}</strong><small>{formatShortDate(receipt.receivedAt)}{receipt.deletedAt ? ' · محذوف' : ''}</small></div>)}{!receipts.length && <Empty text="لا توجد تحصيلات." />}</div>
        <h4>آخر الحصص</h4>
        <div className="mini-history">{occurrences.slice(0, 12).map((occurrence) => <div key={occurrence.id}><strong>{occurrenceStatus(occurrence.status)}</strong><small>{formatShortDate(occurrence.rescheduledToDate ?? occurrence.sessionDate)}</small></div>)}{!occurrences.length && <Empty text="لا يوجد تاريخ حصص بعد." />}</div>
      </div>
    );
  }

  return (
    <div className="control-list">
      {data.simple.students.map((row) => (
        <button type="button" className="student-control-row" key={row.id} onClick={() => onProfile(row.id)}>
          <span className="student-avatar-control">{row.name.trim().charAt(0)}</span><span><strong>{row.name}</strong><small>{row.guardianName || 'ولي الأمر غير مسجل'}</small></span><b>فتح</b>
        </button>
      ))}
      {!data.simple.students.length && <Empty text="لا يوجد طلاب." />}
    </div>
  );
}

function StudentEditForm({ student, busy, onSave }: { student: Student; busy: boolean; onSave: (form: FormData) => Promise<boolean> }) {
  return (
    <form className="control-edit-form" onSubmit={(event) => { event.preventDefault(); void onSave(new FormData(event.currentTarget)); }}>
      <label>اسم الطالب<input name="name" defaultValue={student.name} required /></label>
      <label>العمر<input name="age" type="number" min="1" max="120" defaultValue={student.age ?? ''} /></label>
      <label>ولي الأمر<input name="guardianName" defaultValue={student.guardianName ?? ''} /></label>
      <label>الهاتف<input name="guardianPhone" inputMode="tel" defaultValue={student.guardianPhone ?? ''} /></label>
      <label>المستوى<input name="level" defaultValue={student.level ?? ''} /></label>
      <label>ملاحظات<input name="notes" defaultValue={student.notes ?? ''} /></label>
      <button className="save-action wide" type="submit" disabled={busy}>حفظ البيانات</button>
    </form>
  );
}

function SessionsTab({ data, movingId, busy, onMove, onCancel, onRestore, onReopen, onReschedule }: {
  data: SimpleWorkspaceData;
  movingId: string | null;
  busy: boolean;
  onMove: (id: string | null) => void;
  onCancel: (session: RecurringSession, occurrence: LocalOccurrence | null, date: string) => Promise<boolean>;
  onRestore: (session: RecurringSession, occurrence: LocalOccurrence | null, date: string) => Promise<boolean>;
  onReopen: (occurrence: LocalOccurrence) => Promise<boolean>;
  onReschedule: (session: RecurringSession, occurrence: LocalOccurrence, form: FormData) => Promise<boolean>;
}) {
  const occurrences = [...data.occurrences].sort((a, b) => (b.rescheduledToDate ?? b.sessionDate).localeCompare(a.rescheduledToDate ?? a.sessionDate)).slice(0, 60);
  return (
    <div className="control-list">
      {occurrences.map((occurrence) => {
        const session = data.sessions.find((row) => row.id === occurrence.recurringSessionId);
        if (!session) return null;
        const date = occurrence.rescheduledToDate ?? occurrence.sessionDate;
        return (
          <article className="control-card" key={occurrence.id}>
            <div className="control-card-head"><div><strong>{session.title}</strong><small>{formatShortDate(date)} · {occurrence.rescheduledToStart ?? occurrence.scheduledStart ?? session.startTime ?? 'وقت غير محدد'}</small></div><span className={`state-badge state-${occurrence.status}`}>{occurrenceStatus(occurrence.status)}</span></div>
            <div className="row-actions">
              {occurrence.status === 'completed' && <button type="button" disabled={busy} onClick={() => { if (confirm('إرجاع الحصة لمجدولة؟ سيتم خفض تقدم الباقة وإعادة حساب المستحقات.')) void onReopen(occurrence); }}>رجوع لمجدولة</button>}
              {occurrence.status === 'scheduled' && <><button type="button" onClick={() => onMove(movingId === occurrence.id ? null : occurrence.id)}>نقل</button><button type="button" className="danger" disabled={busy} onClick={() => void onCancel(session, occurrence, date)}>إلغاء</button></>}
              {(occurrence.status === 'cancelled' || occurrence.status === 'missed') && <button type="button" disabled={busy} onClick={() => void onRestore(session, occurrence, date)}>استرجاع</button>}
            </div>
            {movingId === occurrence.id && occurrence.status !== 'completed' && (
              <form className="control-edit-form" onSubmit={(event) => { event.preventDefault(); void onReschedule(session, occurrence, new FormData(event.currentTarget)); }}>
                <label>اليوم الجديد<input name="date" type="date" defaultValue={date} required /></label>
                <label>الوقت<input name="startTime" type="time" defaultValue={occurrence.rescheduledToStart ?? occurrence.scheduledStart ?? session.startTime ?? ''} /></label>
                <label className="wide">ملاحظة<input name="note" defaultValue={occurrence.note ?? ''} /></label>
                <button className="save-action wide" type="submit" disabled={busy}>حفظ النقل</button>
              </form>
            )}
          </article>
        );
      })}
      {!occurrences.length && <Empty text="لا يوجد تاريخ حصص بعد." />}
    </div>
  );
}

function Empty({ text }: { text: string }) { return <div className="control-empty">{text}</div>; }
function parseJson<T>(value: string | null): T | null { if (!value) return null; try { return JSON.parse(value) as T; } catch { return null; } }
function canUndo(event: LocalActivityEvent): boolean { return ['receipt.deleted', 'expense.deleted', 'receipt.updated', 'expense.updated', 'student.updated'].includes(event.action); }
function paymentLabel(value: LocalReceipt['paymentMethod']): string { return ({ cash: 'كاش', bank: 'بنك', wallet: 'محفظة', other: 'أخرى' } as const)[value]; }
function money(pence: number, label: string): string { return `${(pence / 100).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ${label}`; }
function toPence(value: FormDataEntryValue | null): number { const amount = Number(String(value ?? '').replace(',', '.')); if (!Number.isFinite(amount) || amount <= 0) throw new Error('AMOUNT_INVALID'); return Math.round(amount * 100); }
function formatShortDate(value: string): string { const iso = value.slice(0, 10); try { return new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${iso}T12:00:00`)); } catch { return iso; } }
function formatDateTime(value: string): string { try { return new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(value)); } catch { return value; } }
function weekdayLabel(value: number | null): string { return value === null ? 'اليوم غير محدد' : ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'][value] ?? 'غير محدد'; }
function occurrenceStatus(value: LocalOccurrence['status']): string { return ({ scheduled: 'مجدولة', completed: 'تمت', cancelled: 'ملغاة', missed: 'فائتة' } as const)[value]; }
function controlError(cause: unknown): string {
  const code = cause instanceof Error ? cause.message : 'UNKNOWN';
  const map: Record<string, string> = {
    AMOUNT_INVALID: 'اكتبي مبلغًا صحيحًا.', RECEIPT_NOT_FOUND: 'التحصيل لم يعد موجودًا.', RECEIPT_DELETED: 'التحصيل محذوف؛ استرجعيه أولًا.',
    EXPENSE_NOT_FOUND: 'المصروف لم يعد موجودًا.', EXPENSE_DELETED: 'المصروف محذوف؛ استرجعيه أولًا.', STUDENT_NOT_FOUND: 'الطالب لم يعد موجودًا.',
    OCCURRENCE_NOT_FOUND: 'الحصة لم تعد موجودة.', COMPLETED_REQUIRES_CORRECTION_FLOW: 'الحصة المكتملة تحتاج «رجوع لمجدولة» أولًا.',
    CORRECTION_REQUIRES_SYNC: 'يلزم مزامنة الحساب مرة واحدة قبل تصحيح هذه الحصة القديمة.', UNDO_NOT_SUPPORTED: 'هذا التغيير لا يدعم التراجع المباشر؛ افتحي المدخل وعدليه يدويًا.',
  };
  return map[code] ?? `تعذر إكمال العملية (${code})`;
}
