import { useState } from 'react';
import { buildStudentFinancialSummary } from '../../../../modules/reports/student-finance';
import type { LocalPlatformSnapshot } from '../../../adapters/indexeddb/platform.repository';
import type { ControlTab } from '../../../control/contracts';
import { planFor, type SimpleWorkspaceData } from '../../data';
import { QuickForm, ScreenHeader, SectionTitle } from '../components';
import { ArabicDateField } from '../localized-fields';
import type { MoneyMode } from '../types';
import {
  dueTotal,
  formatShortDate,
  money,
  packageProgress,
  sum,
  todayIso,
} from '../utils';

export type MoneyList = 'receipts' | 'expenses' | 'other' | 'due';

type MoneyView =
  | { kind: 'overview' }
  | { kind: 'list'; list: MoneyList }
  | { kind: 'movement'; movement: 'receipt' | 'expense' | 'other'; id: string };

export function MoneyScreen({
  snapshot,
  data,
  mode,
  initialList = null,
  busy,
  assistantLabel,
  onMode,
  onCollect,
  onExpense,
  onOpenStudent,
  onOpenAdvanced,
}: {
  snapshot: LocalPlatformSnapshot;
  data: SimpleWorkspaceData;
  mode: MoneyMode;
  initialList?: MoneyList | null;
  busy: boolean;
  assistantLabel: string;
  onMode: (mode: MoneyMode) => void;
  onCollect: (form: FormData) => void;
  onExpense: (form: FormData) => void;
  onOpenStudent: (studentId: string) => void;
  onOpenAdvanced: (tab: ControlTab) => void;
}) {
  const [view, setView] = useState<MoneyView>(() => initialList ? { kind: 'list', list: initialList } : { kind: 'overview' });
  const [receiptStudentId, setReceiptStudentId] = useState('');
  const currency = snapshot.workspace.currencyLabel;
  const month = todayIso().slice(0, 7);
  const receipts = data.receipts.filter((row) => row.receivedAt.startsWith(month));
  const expenses = data.expenses.filter((row) => row.expenseDate.startsWith(month));
  const income = data.otherIncome.filter((row) => row.incomeDate.startsWith(month));
  const received = sum(receipts.map((row) => row.amountPence));
  const spent = sum(expenses.map((row) => row.amountPence));
  const other = sum(income.map((row) => row.amountPence));
  const due = dueTotal(data);

  const backToOverview = () => {
    setView({ kind: 'overview' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const openList = (list: MoneyList) => {
    setView({ kind: 'list', list });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const openMovement = (movement: Extract<MoneyView, { kind: 'movement' }>['movement'], id: string) => {
    setView({ kind: 'movement', movement, id });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (view.kind === 'list') {
    if (view.list === 'due') {
      const dueStudents = data.students
        .map((student) => ({ student, summary: buildStudentFinancialSummary(data, student.id) }))
        .filter((row) => row.summary.duePence > 0)
        .sort((a, b) => b.summary.duePence - a.summary.duePence);
      return (
        <MoneySubView title="مطلوب تحصيله الآن" subtitle={`الإجمالي ${money(due, currency)}`} onBack={backToOverview}>
          <div className="money-ledger-list">
            {dueStudents.map(({ student, summary }) => (
              <button type="button" className="money-person-row" key={student.id} onClick={() => onOpenStudent(student.id)}>
                <div className="avatar-circle">{student.name.trim().charAt(0)}</div>
                <span><strong>{student.name}</strong><small>{planFor(data, student.id)?.billingMode === 'package' ? `باقة · ${packageProgress(data, student.id)}` : 'الحساب بالحصة'}</small></span>
                <b>{money(summary.duePence, currency)}</b>
              </button>
            ))}
            {!dueStudents.length && <div className="friendly-empty">مفيش مستحقات جاهزة للتحصيل حاليًا.</div>}
          </div>
        </MoneySubView>
      );
    }

    const title = view.list === 'receipts' ? 'المقبوض هذا الشهر' : view.list === 'expenses' ? 'المصروف هذا الشهر' : 'الدخل الآخر هذا الشهر';
    const total = view.list === 'receipts' ? received : view.list === 'expenses' ? spent : other;
    return (
      <MoneySubView title={title} subtitle={`الإجمالي ${money(total, currency)}`} onBack={backToOverview}>
        <div className="money-ledger-list">
          {view.list === 'receipts' && receipts.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).map((row) => {
            const student = data.students.find((item) => item.id === row.payerRefId);
            return (
              <div className="money-ledger-row-wrap" key={row.id}>
                <button type="button" className="money-ledger-row" onClick={() => openMovement('receipt', row.id)}>
                  <span><strong>{student ? `تحصيل من ${student.name}` : 'تحصيل'}</strong><small>{formatShortDate(row.receivedAt)} · {paymentMethodLabel(row.paymentMethod)}</small></span>
                  <b className="in">+ {money(row.amountPence, currency)}</b>
                </button>
                {student && <button type="button" className="money-inline-student" onClick={() => onOpenStudent(student.id)}>ملف {student.name}</button>}
              </div>
            );
          })}
          {view.list === 'expenses' && expenses.sort((a, b) => b.expenseDate.localeCompare(a.expenseDate)).map((row) => <button type="button" className="money-ledger-row" key={row.id} onClick={() => openMovement('expense', row.id)}><span><strong>{row.category}</strong><small>{formatShortDate(row.expenseDate)} · {row.scope === 'business' ? 'شغل' : 'شخصي'}</small></span><b className="out">− {money(row.amountPence, currency)}</b></button>)}
          {view.list === 'other' && income.sort((a, b) => b.incomeDate.localeCompare(a.incomeDate)).map((row) => <button type="button" className="money-ledger-row" key={row.id} onClick={() => openMovement('other', row.id)}><span><strong>{row.category}</strong><small>{formatShortDate(row.incomeDate)}</small></span><b className="in">+ {money(row.amountPence, currency)}</b></button>)}
          {((view.list === 'receipts' && !receipts.length) || (view.list === 'expenses' && !expenses.length) || (view.list === 'other' && !income.length)) && <div className="friendly-empty">مفيش حركات من النوع ده خلال الشهر الحالي.</div>}
        </div>
      </MoneySubView>
    );
  }

  if (view.kind === 'movement') {
    const receipt = view.movement === 'receipt' ? data.receipts.find((row) => row.id === view.id) : null;
    const expense = view.movement === 'expense' ? data.expenses.find((row) => row.id === view.id) : null;
    const otherIncome = view.movement === 'other' ? data.otherIncome.find((row) => row.id === view.id) : null;
    if (receipt) {
      const student = data.students.find((row) => row.id === receipt.payerRefId);
      return <MoneySubView title="تفاصيل التحصيل" onBack={backToOverview}><MovementCard amount={`+ ${money(receipt.amountPence, currency)}`} tone="in" rows={[['التاريخ', formatShortDate(receipt.receivedAt)], ['طريقة الدفع', paymentMethodLabel(receipt.paymentMethod)], ['الطالب', student?.name ?? 'غير مرتبط'], ['ملاحظة', receipt.note || '—']]} /><div className="money-detail-actions">{student && <button type="button" onClick={() => onOpenStudent(student.id)}>ملف {student.name}</button>}<button type="button" onClick={() => onOpenAdvanced('receipts')}>تعديل من الإدارة</button></div></MoneySubView>;
    }
    if (expense) {
      return <MoneySubView title="تفاصيل المصروف" onBack={backToOverview}><MovementCard amount={`− ${money(expense.amountPence, currency)}`} tone="out" rows={[['التاريخ', formatShortDate(expense.expenseDate)], ['التصنيف', expense.category], ['النوع', expense.scope === 'business' ? 'شغل' : 'شخصي'], ['ملاحظة', expense.note || '—']]} /><div className="money-detail-actions"><button type="button" onClick={() => onOpenAdvanced('expenses')}>تعديل من الإدارة</button></div></MoneySubView>;
    }
    if (otherIncome) {
      return <MoneySubView title="تفاصيل الدخل الآخر" onBack={backToOverview}><MovementCard amount={`+ ${money(otherIncome.amountPence, currency)}`} tone="in" rows={[['التاريخ', formatShortDate(otherIncome.incomeDate)], ['التصنيف', otherIncome.category], ['ملاحظة', otherIncome.note || '—']]} /><div className="money-detail-actions"><button type="button" onClick={() => onOpenAdvanced('expenses')}>تعديل من الإدارة</button></div></MoneySubView>;
    }
    return <MoneySubView title="الحركة غير موجودة" onBack={backToOverview}><div className="friendly-empty">تعذر العثور على هذه الحركة المالية.</div></MoneySubView>;
  }

  const recentRows = [
    ...data.receipts.map((row) => ({ id: row.id, kind: 'receipt' as const, date: row.receivedAt, title: data.students.find((student) => student.id === row.payerRefId)?.name ? `تحصيل من ${data.students.find((student) => student.id === row.payerRefId)?.name}` : 'تحصيل', value: `+ ${money(row.amountPence, currency)}`, tone: 'in' as const })),
    ...data.expenses.map((row) => ({ id: row.id, kind: 'expense' as const, date: row.expenseDate, title: `مصروف · ${row.category}`, value: `− ${money(row.amountPence, currency)}`, tone: 'out' as const })),
    ...data.otherIncome.map((row) => ({ id: row.id, kind: 'other' as const, date: row.incomeDate, title: `دخل آخر · ${row.category}`, value: `+ ${money(row.amountPence, currency)}`, tone: 'in' as const })),
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);

  return (
    <section className="simple-screen">
      <ScreenHeader kicker={assistantLabel} title="فلوسي" />
      <div className="screen-action-row">
        <button className="primary-small" type="button" onClick={() => onMode(mode === 'receipt' ? 'none' : 'receipt')}>＋ قبضت فلوس</button>
        <button className="secondary-small" type="button" onClick={() => onMode(mode === 'expense' ? 'none' : 'expense')}>− مصروف</button>
      </div>

      {mode === 'receipt' && (
        <QuickForm title="سجلّي التحصيل" onSubmit={onCollect} busy={busy}>
          <select name="studentId" required value={receiptStudentId} onChange={(event) => setReceiptStudentId(event.currentTarget.value)}><option value="" disabled>اختاري الطالب</option>{data.students.map((student) => <option key={student.id} value={student.id}>{student.name}</option>)}</select>
          <input name="amount" type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="المبلغ" required />
          <ArabicDateField name="receivedAt" defaultValue={todayIso()} ariaLabel="تاريخ التحصيل" />
          <select name="paymentMethod" defaultValue="cash"><option value="cash">كاش</option><option value="bank">بنك</option><option value="wallet">محفظة</option><option value="other">أخرى</option></select>
          <input name="note" placeholder="ملاحظة اختيارية" />
        </QuickForm>
      )}

      {mode === 'expense' && (
        <QuickForm title="سجلّي المصروف" onSubmit={onExpense} busy={busy}>
          <input name="amount" type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="المبلغ" required />
          <ArabicDateField name="expenseDate" defaultValue={todayIso()} ariaLabel="تاريخ المصروف" />
          <select name="scope" defaultValue="personal"><option value="personal">شخصي</option><option value="business">شغل</option></select>
          <input name="category" placeholder="التصنيف: بيت، مواصلات، أدوات…" required />
          <input name="note" placeholder="ملاحظة اختيارية" />
        </QuickForm>
      )}

      <SectionTitle eyebrow="صورة الشهر" title="فلوسي" />
      <div className="money-grid">
        <MoneyMetric label="قبضت" value={money(received, currency)} onClick={() => openList('receipts')} />
        <MoneyMetric label="دخل آخر" value={money(other, currency)} onClick={() => openList('other')} />
        <MoneyMetric label="صرفت" value={money(spent, currency)} onClick={() => openList('expenses')} />
        <MoneyMetric label="مطلوب تحصيله الآن" value={money(due, currency)} accent onClick={() => openList('due')} />
      </div>
      <p className="money-note">{due > 0 ? 'فيه مستحقات جاهزة للتحصيل.' : 'مفيش باقات أو حصص مكتملة ومستحقة حاليًا.'}</p>

      <SectionTitle eyebrow="التحصيل" title="مين دفع ومين لسه؟" />
      <div className="student-money-list">
        {data.students.map((student) => {
          const plan = planFor(data, student.id);
          const financial = buildStudentFinancialSummary(data, student.id);
          const progress = plan?.billingMode === 'package' ? packageProgress(data, student.id) : 'بالحصة';
          const status = financial.duePence > 0
            ? `مطلوب ${money(financial.duePence, currency)}`
            : financial.creditPence > 0
              ? `رصيد ${money(financial.creditPence, currency)}`
              : 'تمام';
          return (
            <button type="button" className="student-money-row" key={student.id} onClick={() => onOpenStudent(student.id)}>
              <div className="avatar-circle">{student.name.trim().charAt(0)}</div>
              <div><strong>{student.name}</strong><small>{plan?.billingMode === 'package' ? `الدورة الحالية · ${progress}` : 'الحساب بالحصة'}</small></div>
              <div className="student-money-status"><span className={financial.duePence > 0 ? 'needs' : 'ok'}>{status}</span>{financial.receivedPence > 0 && <small>دفع {money(financial.receivedPence, currency)}</small>}</div>
            </button>
          );
        })}
      </div>

      <SectionTitle eyebrow="آخر حركة" title="المقبوض والمصروف" />
      <div className="activity-list">
        {recentRows.map((row) => (
          <button type="button" className="activity-row money-activity-button" key={`${row.kind}-${row.id}`} onClick={() => openMovement(row.kind, row.id)}><div><strong>{row.title}</strong><small>{formatShortDate(row.date)}</small></div><b className={row.tone}>{row.value}</b></button>
        ))}
        {!recentRows.length && <div className="friendly-empty">لسه مفيش حركات مالية مسجلة.</div>}
      </div>
    </section>
  );
}

function MoneyMetric({ label, value, accent = false, onClick }: { label: string; value: string; accent?: boolean; onClick: () => void }) {
  return <button type="button" className={`metric-card money-metric-button ${accent ? 'accent' : ''}`} onClick={onClick}><span>{label}</span><strong>{value}</strong><small>عرض التفاصيل ‹</small></button>;
}

function MoneySubView({ title, subtitle, onBack, children }: { title: string; subtitle?: string; onBack: () => void; children: React.ReactNode }) {
  return <section className="simple-screen money-subview"><header className="money-subheader"><div>{subtitle && <small>{subtitle}</small>}<h2>{title}</h2></div><button type="button" onClick={onBack}>رجوع</button></header>{children}</section>;
}

function MovementCard({ amount, tone, rows }: { amount: string; tone: 'in' | 'out'; rows: Array<[string, string]> }) {
  return <article className="money-movement-card"><strong className={tone}>{amount}</strong><div>{rows.map(([label, value]) => <p key={label}><span>{label}</span><b>{value}</b></p>)}</div></article>;
}

function paymentMethodLabel(value: 'cash' | 'bank' | 'wallet' | 'other'): string {
  return value === 'cash' ? 'كاش' : value === 'bank' ? 'بنك' : value === 'wallet' ? 'محفظة' : 'أخرى';
}
