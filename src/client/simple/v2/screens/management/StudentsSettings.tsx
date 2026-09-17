import { activeCycleFor, planFor, type SimpleWorkspaceData } from '../../../data';
import { QuickForm } from '../../components';
import { todayIso } from '../../utils';
import { SubHeader } from './ReportsHub';

export function StudentsSettings({
  data,
  busy,
  showAddStudent,
  onToggleAddStudent,
  onStudentAdd,
  onPackage,
  onBack,
  onAdvancedStudents,
}: {
  data: SimpleWorkspaceData;
  busy: boolean;
  showAddStudent: boolean;
  onToggleAddStudent: () => void;
  onStudentAdd: (form: FormData) => void;
  onPackage: (studentId: string, form: FormData) => void;
  onBack: () => void;
  onAdvancedStudents: () => void;
}) {
  return (
    <section className="management-subview">
      <SubHeader title="الطلاب والباقات" subtitle={`${data.students.length} طالب`} onBack={onBack} />
      <div className="management-inline-actions">
        <button className="primary-small" type="button" onClick={onToggleAddStudent}>{showAddStudent ? 'إغلاق' : '＋ إضافة طالب'}</button>
        <button className="secondary-small" type="button" onClick={onAdvancedStudents}>بيانات الطلاب بالتفصيل</button>
      </div>

      {showAddStudent && (
        <QuickForm title="طالب جديد" onSubmit={onStudentAdd} busy={busy}>
          <input name="name" placeholder="اسم الطالب" required />
          <input name="guardianName" placeholder="ولي الأمر" />
          <input name="guardianPhone" placeholder="رقم الهاتف" inputMode="tel" />
          <input name="level" placeholder="المستوى" />
          <input name="notes" placeholder="ملاحظات" />
        </QuickForm>
      )}

      <div className="management-student-stack">
        {data.students.map((student) => {
          const plan = planFor(data, student.id);
          const cycle = activeCycleFor(data, student.id);
          const packageSize = cycle?.sessionLimit ?? plan?.packageSize ?? 8;
          const completed = cycle ? cycle.openingCompletedCount + cycle.realCompletedCount : 0;
          const remaining = Math.max(0, packageSize - completed);
          const nextPosition = completed < packageSize ? completed + 1 : null;
          const openingLocked = Boolean(cycle?.openingProgressLockedAt) || (cycle?.realCompletedCount ?? 0) > 0;
          return (
            <details className="management-student-card" key={student.id}>
              <summary>
                <span><strong>{student.name}</strong><small>{plan?.billingMode === 'package' ? `باقة ${packageSize} · ${completed}/${packageSize}` : 'الحساب بالحصة'}</small></span>
                <b>‹</b>
              </summary>
              <div className="management-student-body">
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
                      <input name="openingCompletedCount" type="number" min="0" max={cycle?.sessionLimit ?? 100} defaultValue={cycle?.openingCompletedCount ?? 0} readOnly={openingLocked} />
                    </label>
                  </div>
                  {openingLocked && <small className="management-helper">بعد تسجيل أول حصة جديدة، تقدم البداية بيتقفل والتقدم الحالي بيتحدث تلقائيًا.</small>}
                  <input name="effectiveFrom" type="hidden" value={plan?.effectiveFrom ?? todayIso()} />
                  <button className="secondary-small" type="submit" disabled={busy}>حفظ الباقة</button>
                </form>
              </div>
            </details>
          );
        })}
        {!data.students.length && <div className="friendly-empty">لا يوجد طلاب حتى الآن.</div>}
      </div>
    </section>
  );
}
