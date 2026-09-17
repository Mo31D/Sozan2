import type { LocalPlatformSnapshot } from '../../../../adapters/indexeddb/platform.repository';
import { resolveWorkspacePresentation } from '../../../../platform/workspace-preferences';
import type { SimpleWorkspaceData } from '../../../data';
import { SubHeader } from './ReportsHub';

export function ProfileSettings({
  snapshot,
  data,
  busy,
  onSave,
  onBack,
}: {
  snapshot: LocalPlatformSnapshot;
  data: SimpleWorkspaceData;
  busy: boolean;
  onSave: (form: FormData) => Promise<boolean>;
  onBack: () => void;
}) {
  const presentation = resolveWorkspacePresentation(snapshot, data.workspaceSettings);
  return (
    <section className="management-subview">
      <SubHeader title="بياناتي" subtitle="الاسم وطريقة عرض مساحة العمل" onBack={onBack} />
      <form className="management-settings-form" onSubmit={(event) => {
        event.preventDefault();
        void onSave(new FormData(event.currentTarget));
      }}>
        <label>اسمك<input name="displayName" defaultValue={presentation.displayName} required /></label>
        <label>اسم شغلك<input name="workspaceName" defaultValue={presentation.workspaceName} required /></label>
        <div className="management-settings-row-static">
          <span><strong>طريقة الاستخدام</strong><small>تدريس وحصص</small></span>
          <b>تدريس</b>
        </div>
        <div className="management-settings-two">
          <label>رمز العملة<input name="currencyCode" defaultValue={presentation.currencyCode} maxLength={8} required /></label>
          <label>علامة العملة<input name="currencyLabel" defaultValue={presentation.currencyLabel} maxLength={12} required /></label>
        </div>
        <p className="management-helper">تغيير الاسم أو العملة يغير طريقة العرض فقط ولا يمس سجل الحصص أو التحصيلات القديمة.</p>
        <button className="form-submit" type="submit" disabled={busy}>{busy ? 'جاري الحفظ…' : 'حفظ البيانات'}</button>
      </form>
      <article className="management-info-card">
        <strong>عايز تستخدم البرنامج للمواعيد والخدمات بدل التدريس؟</strong>
        <p>مساحة التدريس الحالية تحتفظ بمنطق الطلاب والباقات. وضع «مواعيد وخدمات» يُنشأ كمساحة مستقلة حتى لا تختلط بيانات أو قواعد الحساب.</p>
      </article>
    </section>
  );
}
