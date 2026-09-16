import type { LocalPlatformSnapshot } from '../../../adapters/indexeddb/platform.repository';
import { CloudLinkPanel } from '../../../cloud/CloudAccess';
import { Sozan1MigrationPanel } from '../../../migration/Sozan1MigrationPanel';
import { activeCycleFor, planFor, type SimpleWorkspaceData } from '../../data';
import { QuickForm, ScreenHeader } from '../components';
import { dueTotal, money, sum, todayIso } from '../utils';

export function MeScreen({
  snapshot,
  data,
  cloudAvailable,
  pendingSync,
  busy,
  showAddStudent,
  onToggleAddStudent,
  onPlatformChanged,
  onStudentAdd,
  onPackage,
}: {
  snapshot: LocalPlatformSnapshot;
  data: SimpleWorkspaceData;
  cloudAvailable: boolean;
  pendingSync: number;
  busy: boolean;
  showAddStudent: boolean;
  onToggleAddStudent: () => void;
  onPlatformChanged: () => Promise<void>;
  onStudentAdd: (form: FormData) => void;
  onPackage: (studentId: string, form: FormData) => void;
}) {
  const pendingTimes = data.sessions.filter((row) => row.scheduleStatus === 'pending').length;
  const due = dueTotal(data);
  const month = todayIso().slice(0, 7);
  const balance = sum(data.receipts.filter((row) => row.receivedAt.startsWith(month)).map((row) => row.amountPence))
    + sum(data.otherIncome.filter((row) => row.incomeDate.startsWith(month)).map((row) => row.amountPence))
    - sum(data.expenses.filter((row) => row.expenseDate.startsWith(month)).map((row) => row.amountPence));
  const notes = [
    pendingSync > 0 ? `${pendingSync} تغيير مستني المزامنة` : null,
    pendingTimes > 0 ? `${pendingTimes} مواعيد محتاجة تحديد وقت` : null,
    due > 0 ? `فيه ${money(due, snapshot.workspace.currencyLabel)} جاهزة للتحصيل` : null,
  ].filter(Boolean) as string[];

  return (
    <section className="simple-screen">
      <ScreenHeader kicker="مساعد سوزان" title="أنا" />
      <article className="attention-card">
        <span>ملاحظات ذكية</span><h2>إيه اللي محتاج انتباهك؟</h2>
        {notes.length
          ? notes.map((note) => <p key={note}>{note}</p>)
          : <div className="stable-box"><strong>الصورة مستقرة</strong><small>مفيش حاجة ملحّة محتاجة مراجعة دلوقتي.</small></div>}
      </article>
      <article className="cash-card"><span>الصورة المسجلة</span><h2>الموجود في الحسابات</h2><strong>{money(balance, snapshot.workspace.currencyLabel)}</strong><small>المقبوض والدخل الآخر ناقص المصروفات المسجلة خلال الشهر.</small></article>

      <details className="settings-card">
        <summary>الطلاب</summary>
        <div className="settings-body">
          <button className="primary-small" type="button" onClick={onToggleAddStudent}>＋ إضافة طالب</button>
          {showAddStudent && (
            <QuickForm title="طالب جديد" onSubmit={onStudentAdd} busy={busy}>
              <input name="name" placeholder="اسم الطالب" required />
              <input name="guardianName" placeholder="ولي الأمر" />
              <input name="guardianPhone" placeholder="رقم الهاتف" inputMode="tel" />
              <input name="level" placeholder="المستوى" />
              <input name="notes" placeholder="ملاحظات" />
            </QuickForm>
          )}
          <div className="student-settings-list">
            {data.students.map((student) => {
              const plan = planFor(data, student.id);
              const cycle = activeCycleFor(data, student.id);
              const packageSize = cycle?.sessionLimit ?? plan?.packageSize ?? 8;
              const completed = cycle ? cycle.openingCompletedCount + cycle.realCompletedCount : 0;
              const remaining = Math.max(0, packageSize - completed);
              const nextPosition = completed < packageSize ? completed + 1 : null;
              const openingLocked = Boolean(cycle?.openingProgressLockedAt) || (cycle?.realCompletedCount ?? 0) > 0;
              return (
                <details className="student-setting-row" key={student.id}>
                  <summary>
                    <strong>{student.name}</strong>
                    <span>{plan?.billingMode === 'package' ? `باقة ${packageSize} · ${completed}/${packageSize}` : 'بالحصة'}</span>
                  </summary>
                  {plan?.billingMode === 'package' && cycle && (
                    <div className="stable-box">
                      <strong>{completed}/{packageSize} تمت · باقي {remaining}</strong>
                      <small>{nextPosition ? `الحصة القادمة ${nextPosition}/${packageSize}` : cycle.status === 'paid' ? 'الباقة مكتملة ومدفوعة.' : 'الباقة مكتملة وجاهزة للتحصيل.'}</small>
                    </div>
                  )}
                  <form onSubmit={(event) => { event.preventDefault(); onPackage(student.id, new FormData(event.currentTarget)); }}>
                    <div className="inline-fields">
                      <label>عدد الحصص<input name="packageSize" type="number" min="1" max="100" defaultValue={packageSize} /></label>
                      <label>سعر الباقة<input name="packagePrice" type="number" min="0" step="0.01" defaultValue={(cycle?.pricePence ?? plan?.packagePricePence ?? 0) / 100 || ''} /></label>
                      <label>
                        {openingLocked ? 'التقدم عند بدء استخدام البرنامج' : 'تمت كام حصة من الدورة الحالية؟'}
                        <input
                          name="openingCompletedCount"
                          type="number"
                          min="0"
                          max={cycle?.sessionLimit ?? 100}
                          defaultValue={cycle?.openingCompletedCount ?? 0}
                          readOnly={openingLocked}
                        />
                      </label>
                    </div>
                    {openingLocked && <small>بعد تسجيل أول حصة جديدة، تقدم البداية بيتقفل والتقدم الحالي بيتحدث تلقائيًا.</small>}
                    <input name="effectiveFrom" type="hidden" value={plan?.effectiveFrom ?? todayIso()} />
                    <button className="secondary-small" type="submit" disabled={busy}>حفظ الباقة</button>
                  </form>
                </details>
              );
            })}
          </div>
        </div>
      </details>

      <details className="settings-card"><summary>الحساب والمزامنة</summary><div className="settings-body"><CloudLinkPanel snapshot={snapshot} available={cloudAvailable} onLinked={onPlatformChanged} /></div></details>
      <details className="settings-card"><summary>نقل أو استعادة البيانات</summary><div className="settings-body"><Sozan1MigrationPanel workspaceId={snapshot.workspace.id} cloudLinked={Boolean(snapshot.cloudLink)} currencyLabel={snapshot.workspace.currencyLabel} onImported={onPlatformChanged} /></div></details>
    </section>
  );
}
