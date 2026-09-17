import { buildStudentFinancialSummary } from '../../../../../modules/reports/student-finance';
import { activeCycleFor, planFor, type SimpleWorkspaceData } from '../../../data';
import { QuickForm } from '../../components';
import { money } from '../../utils';
import { SubHeader } from './ReportsHub';

export function StudentsSettings({
  data,
  busy,
  currency,
  showAddStudent,
  onToggleAddStudent,
  onStudentAdd,
  onOpenStudent,
  onRestoreStudent,
  onBack,
  onAdvancedStudents,
}: {
  data: SimpleWorkspaceData;
  busy: boolean;
  currency: string;
  showAddStudent: boolean;
  onToggleAddStudent: () => void;
  onStudentAdd: (form: FormData) => void;
  onOpenStudent: (studentId: string) => void;
  onRestoreStudent: (studentId: string) => Promise<boolean>;
  onBack: () => void;
  onAdvancedStudents: () => void;
}) {
  return (
    <section className="management-subview">
      <SubHeader title="الطلاب" subtitle={`${data.students.length} طالب`} onBack={onBack} />
      <div className="management-inline-actions">
        <button className="primary-small" type="button" onClick={onToggleAddStudent}>{showAddStudent ? 'إغلاق' : '＋ إضافة طالب'}</button>
        <button className="secondary-small" type="button" onClick={onAdvancedStudents}>تصحيحات متقدمة</button>
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
          const financial = buildStudentFinancialSummary(data, student.id);
          const packageSize = cycle?.sessionLimit ?? plan?.packageSize ?? 8;
          const completed = cycle ? cycle.openingCompletedCount + cycle.realCompletedCount : 0;
          const siblings = student.familyId ? data.students.filter((row) => row.id !== student.id && row.familyId === student.familyId) : [];
          return (
            <button className="management-student-link" type="button" key={student.id} onClick={() => onOpenStudent(student.id)}>
              <span className="management-row-icon">{student.name.trim().charAt(0)}</span>
              <span>
                <strong>{student.name}</strong>
                <small>{plan?.billingMode === 'package' ? `باقة ${completed}/${packageSize}` : 'الحساب بالحصة'}{financial.duePence ? ` · مطلوب ${money(financial.duePence, currency)}` : ''}{siblings.length ? ` · ${siblings.length} إخوة مرتبطين` : ''}</small>
              </span>
              <b>فتح</b>
            </button>
          );
        })}
        {!data.students.length && <div className="friendly-empty">لا يوجد طلاب حتى الآن.</div>}
      </div>

      {data.archivedStudents.length > 0 && (
        <details className="archived-students-panel">
          <summary>طلاب سابقون ({data.archivedStudents.length})</summary>
          <p>ملفاتهم وتاريخهم محفوظ. الاسترجاع يعيد الطالب للقائمة فقط؛ المواعيد القديمة لا ترجع تلقائيًا.</p>
          <div className="archived-student-list">
            {data.archivedStudents.map((student) => (
              <div key={student.id}>
                <span><strong>{student.name}</strong><small>{student.guardianName || student.level || 'ملف محفوظ'}</small></span>
                <button type="button" disabled={busy} onClick={() => void onRestoreStudent(student.id)}>استرجاع</button>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
