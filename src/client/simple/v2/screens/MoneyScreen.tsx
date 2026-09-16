import type { LocalPlatformSnapshot } from '../../../adapters/indexeddb/platform.repository';
import { activeCycleFor, planFor, type SimpleWorkspaceData } from '../../data';
import { Metric, QuickForm, ScreenHeader, SectionTitle } from '../components';
import type { MoneyMode } from '../types';
import {
  dueTotal,
  formatShortDate,
  money,
  packageProgress,
  recentMoneyRows,
  sum,
  todayIso,
} from '../utils';

export function MoneyScreen({
  snapshot,
  data,
  mode,
  busy,
  onMode,
  onCollect,
  onExpense,
}: {
  snapshot: LocalPlatformSnapshot;
  data: SimpleWorkspaceData;
  mode: MoneyMode;
  busy: boolean;
  onMode: (mode: MoneyMode) => void;
  onCollect: (form: FormData) => void;
  onExpense: (form: FormData) => void;
}) {
  const month = todayIso().slice(0, 7);
  const receipts = data.receipts.filter((row) => row.receivedAt.startsWith(month));
  const expenses = data.expenses.filter((row) => row.expenseDate.startsWith(month));
  const income = data.otherIncome.filter((row) => row.incomeDate.startsWith(month));
  const received = sum(receipts.map((row) => row.amountPence));
  const spent = sum(expenses.map((row) => row.amountPence));
  const other = sum(income.map((row) => row.amountPence));
  const due = dueTotal(data);
  const recentRows = recentMoneyRows(data, snapshot.workspace.currencyLabel);

  return (
    <section className="simple-screen">
      <ScreenHeader kicker="مساعد سوزان" title="فلوسي" />
      <div className="screen-action-row">
        <button className="primary-small" type="button" onClick={() => onMode(mode === 'receipt' ? 'none' : 'receipt')}>＋ قبضت فلوس</button>
        <button className="secondary-small" type="button" onClick={() => onMode(mode === 'expense' ? 'none' : 'expense')}>− مصروف</button>
      </div>

      {mode === 'receipt' && (
        <QuickForm title="سجلّي التحصيل" onSubmit={onCollect} busy={busy}>
          <select name="studentId" required defaultValue=""><option value="" disabled>اختاري الطالب</option>{data.students.map((student) => <option key={student.id} value={student.id}>{student.name}</option>)}</select>
          <input name="amount" type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="المبلغ" required />
          <input name="receivedAt" type="date" defaultValue={todayIso()} required />
          <select name="paymentMethod" defaultValue="cash"><option value="cash">كاش</option><option value="bank">بنك</option><option value="wallet">محفظة</option><option value="other">أخرى</option></select>
          <input name="note" placeholder="ملاحظة اختيارية" />
        </QuickForm>
      )}

      {mode === 'expense' && (
        <QuickForm title="سجلّي المصروف" onSubmit={onExpense} busy={busy}>
          <input name="amount" type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="المبلغ" required />
          <input name="expenseDate" type="date" defaultValue={todayIso()} required />
          <select name="scope" defaultValue="personal"><option value="personal">شخصي</option><option value="business">شغل</option></select>
          <input name="category" placeholder="التصنيف: بيت، مواصلات، أدوات…" required />
          <input name="note" placeholder="ملاحظة اختيارية" />
        </QuickForm>
      )}

      <SectionTitle eyebrow="صورة الشهر" title="فلوسي" />
      <div className="money-grid">
        <Metric label="قبضت" value={money(received, snapshot.workspace.currencyLabel)} />
        <Metric label="دخل آخر" value={money(other, snapshot.workspace.currencyLabel)} />
        <Metric label="صرفت" value={money(spent, snapshot.workspace.currencyLabel)} />
        <Metric label="مطلوب تحصيله الآن" value={money(due, snapshot.workspace.currencyLabel)} accent />
      </div>
      <p className="money-note">{due > 0 ? 'فيه مستحقات جاهزة للتحصيل.' : 'مفيش باقات مكتملة ومستحقة حاليًا.'}</p>

      <SectionTitle eyebrow="التحصيل" title="مين دفع ومين لسه؟" />
      <div className="student-money-list">
        {data.students.map((student) => {
          const plan = planFor(data, student.id);
          const cycle = activeCycleFor(data, student.id);
          const paid = sum(data.receipts.filter((row) => row.payerRefId === student.id).map((row) => row.amountPence));
          const progress = plan?.billingMode === 'package' ? packageProgress(data, student.id) : 'بالحصة';
          const dueNow = cycle?.status === 'due';
          return (
            <article className="student-money-row" key={student.id}>
              <div className="avatar-circle">{student.name.trim().charAt(0)}</div>
              <div><strong>{student.name}</strong><small>{plan?.billingMode === 'package' ? `الدورة الحالية · ${progress}` : 'الحساب بالحصة'}</small></div>
              <div className="student-money-status"><span className={dueNow ? 'needs' : 'ok'}>{dueNow ? 'مطلوب' : progress}</span>{paid > 0 && <small>دفع {money(paid, snapshot.workspace.currencyLabel)}</small>}</div>
            </article>
          );
        })}
      </div>

      <SectionTitle eyebrow="آخر حركة" title="المقبوض والمصروف" />
      <div className="activity-list">
        {recentRows.map((row) => (
          <div className="activity-row" key={row.id}><div><strong>{row.title}</strong><small>{formatShortDate(row.date)}</small></div><b className={row.kind}>{row.value}</b></div>
        ))}
        {!recentRows.length && <div className="friendly-empty">لسه مفيش حركات مالية مسجلة.</div>}
      </div>
    </section>
  );
}
