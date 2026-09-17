import { useMemo, useState } from 'react';
import {
  deleteLocalExpense,
  deleteLocalReceipt,
  restoreLocalExpense,
  restoreLocalReceipt,
  updateLocalExpense,
  updateLocalReceipt,
} from '../../finance/corrections';
import {
  addLocalCashCheck,
  addLocalOtherIncome,
  deleteLocalCashCheck,
  deleteLocalOtherIncome,
  restoreLocalCashCheck,
  restoreLocalOtherIncome,
  updateLocalCashCheck,
  updateLocalOtherIncome,
} from '../../finance/extended-commands';
import type { LocalCashCheck, LocalExpense, LocalOtherIncome } from '../../simple/data';
import { ArabicDateField } from '../../simple/v2/localized-fields';
import type { LocalReceipt } from '../../tutoring/local-commands';
import { duplicateReceiptIds } from '../correction-model';
import { expectedBalance, type ControlCenterData } from '../data';
import {
  formatShortDate,
  money,
  paymentLabel,
  todayIso,
  toPence,
  toPenceSigned,
} from '../presentation';
import { EditableMoneyCard, Empty, type CommonListProps } from './shared';

export function ReceiptsView({ data, editId, setEditId, busy, currency, act, workspaceId }: CommonListProps & { data: ControlCenterData }) {
  const duplicates = useMemo(() => duplicateReceiptIds(data.receipts), [data.receipts]);

  return (
    <div className="control-list">
      {data.receipts.map((row) => {
        const editing = editId === row.id;
        const student = data.simple.students.find((item) => item.id === row.payerRefId);
        return (
          <article className={`control-card ${row.deletedAt ? 'deleted' : ''}`} key={row.id}>
            <div className="control-card-head">
              <div><strong>{student?.name ?? 'تحصيل'}</strong><small>{formatShortDate(row.receivedAt)} · {paymentLabel(row.paymentMethod)}</small></div>
              <div className="money-stack">
                <b>{money(row.amountPence, currency)}</b>
                {duplicates.has(row.id) && !row.deletedAt && <span className="duplicate-badge">محتمل مكرر</span>}
                {row.deletedAt && <span className="deleted-badge">محذوف</span>}
              </div>
            </div>
            {row.note && <p className="row-note">{row.note}</p>}
            {!row.deletedAt ? (
              <div className="row-actions">
                <button type="button" onClick={() => setEditId(editing ? null : row.id)}>تعديل</button>
                <button className="danger" type="button" disabled={busy} onClick={() => {
                  if (confirm('حذف هذا التحصيل؟ سيتم إعادة حساب المستحقات تلقائيًا.')) {
                    void act(() => deleteLocalReceipt(workspaceId, row.id), 'تم حذف التحصيل وإعادة الحساب.');
                  }
                }}>حذف</button>
              </div>
            ) : (
              <div className="row-actions"><button type="button" disabled={busy} onClick={() => void act(() => restoreLocalReceipt(workspaceId, row.id), 'تم استرجاع التحصيل وإعادة الحساب.')}>استرجاع</button></div>
            )}
            {editing && !row.deletedAt && (
              <form className="control-edit-form" onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                void act(async () => {
                  await updateLocalReceipt(workspaceId, row.id, {
                    studentId: String(form.get('studentId') ?? ''),
                    amountPence: toPence(form.get('amount')),
                    receivedAt: String(form.get('date') ?? ''),
                    paymentMethod: String(form.get('method') ?? 'cash') as LocalReceipt['paymentMethod'],
                    note: String(form.get('note') ?? ''),
                  });
                  setEditId(null);
                }, 'تم تعديل التحصيل وإعادة الحساب.');
              }}>
                <label>الطالب<select name="studentId" defaultValue={row.payerRefId}>{data.simple.students.map((studentRow) => <option key={studentRow.id} value={studentRow.id}>{studentRow.name}</option>)}</select></label>
                <label>المبلغ<input name="amount" type="number" min="0.01" step="0.01" defaultValue={row.amountPence / 100} required /></label>
                <label>التاريخ<ArabicDateField name="date" defaultValue={row.receivedAt.slice(0, 10)} ariaLabel="تاريخ التحصيل" /></label>
                <label>طريقة الدفع<select name="method" defaultValue={row.paymentMethod}><option value="cash">كاش</option><option value="bank">بنك</option><option value="wallet">محفظة</option><option value="other">أخرى</option></select></label>
                <label className="wide">ملاحظة<input name="note" defaultValue={row.note ?? ''} /></label>
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

export function ExpensesView({ rows, editId, setEditId, busy, currency, act, workspaceId }: CommonListProps & { rows: LocalExpense[] }) {
  return (
    <div className="control-list">
      {rows.map((row) => (
        <EditableMoneyCard
          key={row.id}
          title={row.category}
          subtitle={`${formatShortDate(row.expenseDate)} · ${row.scope === 'business' ? 'شغل' : 'شخصي'}`}
          amount={row.amountPence}
          currency={currency}
          deleted={Boolean(row.deletedAt)}
          editing={editId === row.id}
          busy={busy}
          onEdit={() => setEditId(editId === row.id ? null : row.id)}
          onDelete={() => act(() => deleteLocalExpense(workspaceId, row.id), 'تم حذف المصروف.')}
          onRestore={() => act(() => restoreLocalExpense(workspaceId, row.id), 'تم استرجاع المصروف.')}
          editForm={(
            <form className="control-edit-form" onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void act(async () => {
                await updateLocalExpense(workspaceId, row.id, {
                  expenseDate: String(form.get('date') ?? ''),
                  scope: String(form.get('scope') ?? 'personal') as LocalExpense['scope'],
                  category: String(form.get('category') ?? ''),
                  amountPence: toPence(form.get('amount')),
                  note: String(form.get('note') ?? ''),
                });
                setEditId(null);
              }, 'تم تعديل المصروف.');
            }}>
              <label>المبلغ<input name="amount" type="number" min="0.01" step="0.01" defaultValue={row.amountPence / 100} required /></label>
              <label>التاريخ<ArabicDateField name="date" defaultValue={row.expenseDate.slice(0, 10)} ariaLabel="تاريخ المصروف" /></label>
              <label>النوع<select name="scope" defaultValue={row.scope}><option value="personal">شخصي</option><option value="business">شغل</option></select></label>
              <label>التصنيف<input name="category" defaultValue={row.category} required /></label>
              <label className="wide">ملاحظة<input name="note" defaultValue={row.note ?? ''} /></label>
              <button className="save-action wide" type="submit" disabled={busy}>حفظ التعديل</button>
            </form>
          )}
        />
      ))}
      {!rows.length && <Empty text="لا توجد مصروفات مسجلة." />}
    </div>
  );
}

export function IncomeView({ rows, editId, setEditId, busy, currency, act, workspaceId }: CommonListProps & { rows: LocalOtherIncome[] }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="control-list">
      <button className="control-primary" type="button" onClick={() => setAdding((value) => !value)}>＋ دخل آخر</button>
      {adding && (
        <form className="control-edit-form control-create-form" onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void act(async () => {
            await addLocalOtherIncome({
              workspaceId,
              incomeDate: String(form.get('date') ?? ''),
              category: String(form.get('category') ?? ''),
              amountPence: toPence(form.get('amount')),
              note: String(form.get('note') ?? ''),
            });
            setAdding(false);
          }, 'تم تسجيل الدخل الآخر.');
        }}>
          <label>المبلغ<input name="amount" type="number" min="0.01" step="0.01" required /></label>
          <label>التاريخ<ArabicDateField name="date" defaultValue={todayIso()} ariaLabel="تاريخ الدخل الآخر" /></label>
          <label className="wide">المصدر<input name="category" placeholder="مثال: كورس، مواد، مكافأة" required /></label>
          <label className="wide">ملاحظة<input name="note" /></label>
          <button className="save-action wide" type="submit" disabled={busy}>حفظ</button>
        </form>
      )}
      {rows.map((row) => (
        <EditableMoneyCard
          key={row.id}
          title={row.category}
          subtitle={formatShortDate(row.incomeDate)}
          amount={row.amountPence}
          currency={currency}
          deleted={Boolean(row.deletedAt)}
          editing={editId === row.id}
          busy={busy}
          onEdit={() => setEditId(editId === row.id ? null : row.id)}
          onDelete={() => act(() => deleteLocalOtherIncome(workspaceId, row.id), 'تم حذف الدخل الآخر.')}
          onRestore={() => act(() => restoreLocalOtherIncome(workspaceId, row.id), 'تم استرجاع الدخل الآخر.')}
          editForm={(
            <form className="control-edit-form" onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void act(async () => {
                await updateLocalOtherIncome(workspaceId, row.id, {
                  incomeDate: String(form.get('date') ?? ''),
                  category: String(form.get('category') ?? ''),
                  amountPence: toPence(form.get('amount')),
                  note: String(form.get('note') ?? ''),
                });
                setEditId(null);
              }, 'تم تعديل الدخل الآخر.');
            }}>
              <label>المبلغ<input name="amount" type="number" min="0.01" step="0.01" defaultValue={row.amountPence / 100} required /></label>
              <label>التاريخ<ArabicDateField name="date" defaultValue={row.incomeDate.slice(0, 10)} ariaLabel="تاريخ الدخل الآخر" /></label>
              <label className="wide">المصدر<input name="category" defaultValue={row.category} required /></label>
              <label className="wide">ملاحظة<input name="note" defaultValue={row.note ?? ''} /></label>
              <button className="save-action wide" type="submit" disabled={busy}>حفظ التعديل</button>
            </form>
          )}
        />
      ))}
      {!rows.length && !adding && <Empty text="لا يوجد دخل آخر مسجل." />}
    </div>
  );
}

export function CashView({ data, editId, setEditId, busy, currency, act, workspaceId }: CommonListProps & { data: ControlCenterData }) {
  const [adding, setAdding] = useState(false);
  const expected = expectedBalance(data);
  return (
    <div className="control-list">
      <article className="control-card cash-summary">
        <small>المفروض يكون موجود حسب الرصيد الافتتاحي وكل البيانات المسجلة</small>
        <strong>{money(expected, currency)}</strong>
        <button className="control-primary" type="button" onClick={() => setAdding((value) => !value)}>مطابقة جديدة</button>
      </article>
      {adding && (
        <form className="control-edit-form control-create-form" onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void act(async () => {
            await addLocalCashCheck({
              workspaceId,
              checkDate: String(form.get('date') ?? ''),
              expectedBalancePence: expected,
              actualBalancePence: toPenceSigned(form.get('actual')),
              note: String(form.get('note') ?? ''),
            });
            setAdding(false);
          }, 'تم حفظ مطابقة الرصيد.');
        }}>
          <label>الموجود فعليًا<input name="actual" type="number" step="0.01" required /></label>
          <label>التاريخ<ArabicDateField name="date" defaultValue={todayIso()} ariaLabel="تاريخ مطابقة الرصيد" /></label>
          <label className="wide">ملاحظة<input name="note" /></label>
          <button className="save-action wide" type="submit" disabled={busy}>حفظ المطابقة</button>
        </form>
      )}
      {data.cashChecks.map((row) => (
        <CashCheckCard key={row.id} row={row} editId={editId} setEditId={setEditId} busy={busy} currency={currency} act={act} workspaceId={workspaceId} />
      ))}
      {!data.cashChecks.length && !adding && <Empty text="لم تتم مطابقة الرصيد بعد." />}
    </div>
  );
}

function CashCheckCard({ row, editId, setEditId, busy, currency, act, workspaceId }: CommonListProps & { row: LocalCashCheck }) {
  const editing = editId === row.id;
  return (
    <article className={`control-card ${row.deletedAt ? 'deleted' : ''}`}>
      <div className="control-card-head">
        <div><strong>{formatShortDate(row.checkDate)}</strong><small>المتوقع {money(row.expectedBalancePence, currency)} · الفعلي {money(row.actualBalancePence, currency)}</small></div>
        <div className="money-stack"><b className={row.differencePence === 0 ? 'cash-ok' : 'cash-diff'}>{row.differencePence > 0 ? '+' : ''}{money(row.differencePence, currency)}</b>{row.deletedAt && <span className="deleted-badge">محذوف</span>}</div>
      </div>
      {row.note && <p className="row-note">{row.note}</p>}
      {!row.deletedAt ? (
        <div className="row-actions">
          <button type="button" onClick={() => setEditId(editing ? null : row.id)}>تعديل</button>
          <button className="danger" type="button" onClick={() => void act(() => deleteLocalCashCheck(workspaceId, row.id), 'تم حذف المطابقة.')}>حذف</button>
        </div>
      ) : (
        <div className="row-actions"><button type="button" onClick={() => void act(() => restoreLocalCashCheck(workspaceId, row.id), 'تم استرجاع المطابقة.')}>استرجاع</button></div>
      )}
      {editing && !row.deletedAt && (
        <form className="control-edit-form" onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void act(async () => {
            await updateLocalCashCheck(workspaceId, row.id, {
              checkDate: String(form.get('date') ?? ''),
              expectedBalancePence: row.expectedBalancePence,
              actualBalancePence: toPenceSigned(form.get('actual')),
              note: String(form.get('note') ?? ''),
            });
            setEditId(null);
          }, 'تم تعديل المطابقة.');
        }}>
          <label>الموجود فعليًا<input name="actual" type="number" step="0.01" defaultValue={row.actualBalancePence / 100} required /></label>
          <label>التاريخ<ArabicDateField name="date" defaultValue={row.checkDate.slice(0, 10)} ariaLabel="تاريخ مطابقة الرصيد" /></label>
          <label className="wide">ملاحظة<input name="note" defaultValue={row.note ?? ''} /></label>
          <button className="save-action wide" type="submit">حفظ التعديل</button>
        </form>
      )}
    </article>
  );
}
