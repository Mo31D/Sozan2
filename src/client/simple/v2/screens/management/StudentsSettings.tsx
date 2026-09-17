import { planFor, type SimpleWorkspaceData } from '../../../data';
import { QuickForm } from '../../components';
import { SubHeader } from './ReportsHub';

export function StudentsSettings({
  data,
  busy,
  showAddStudent,
  onToggleAddStudent,
  onStudentAdd,
  onOpenStudent,
  onBack,
}: {
  data: SimpleWorkspaceData;
  busy: boolean;
  showAddStudent: boolean;
  onToggleAddStudent: () => void;
  onStudentAdd: (form: FormData) => void;
  onOpenStudent: (studentId: string) => void;
  onBack: () => void;
}) {
  return (
    <section className="management-subview">
      <SubHeader title="الطلاب" subtitle={`${data.students.length} طالب`} onBack={onBack} />
      <div className="management-inline-actions">
        <button className="primary-small" type="button" onClick={onToggleAddStudent}>{showAddStudent ? 'إغلاق' : '＋ إضافة طالب'}</button>
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
          return (
            <button className="management-student-link" type="button" key={student.id} onClick={() => onOpenStudent(student.id)}>
              <span className="management-avatar">{student.name.trim().charAt(0)}</span>
              <span><strong>{student.name}</strong><small>{plan?.billingMode === 'package' ? 'باقة حصص' : 'الحساب بالحصة'} · افتحي الملف لكل التفاصيل</small></span>
              <b>‹</b>
            </button>
          );
        })}
        {!data.students.length && <div className="friendly-empty">لا يوجد طلاب حتى الآن.</div>}
      </div>
    </section>
  );
}
