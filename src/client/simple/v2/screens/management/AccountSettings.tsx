import type { LocalPlatformSnapshot } from '../../../../adapters/indexeddb/platform.repository';
import { CloudLinkPanel } from '../../../../cloud/CloudAccess';
import { SubHeader } from './ReportsHub';

export function AccountSettings({
  snapshot,
  cloudAvailable,
  pendingSync,
  onPlatformChanged,
  onBack,
}: {
  snapshot: LocalPlatformSnapshot;
  cloudAvailable: boolean;
  pendingSync: number;
  onPlatformChanged: () => Promise<void>;
  onBack: () => void;
}) {
  return (
    <section className="management-subview">
      <SubHeader title="الحساب والمزامنة" subtitle={pendingSync ? `${pendingSync} تغيير مستني المزامنة` : 'البيانات المحلية محدثة'} onBack={onBack} />
      <article className={`management-sync-state ${pendingSync ? 'attention' : 'good'}`}>
        <strong>{pendingSync ? 'فيه تغييرات لم تصل للسحابة بعد' : snapshot.cloudLink ? 'المزامنة مستقرة' : 'النسخة تعمل محليًا'}</strong>
        <span>{snapshot.cloudLink ? `الحساب: ${snapshot.cloudLink.loginName}` : 'تقدري تستخدمي البرنامج بدون إنترنت أو تربطيه بحساب للوصول من أجهزة أخرى.'}</span>
      </article>
      <div className="management-form-card">
        <CloudLinkPanel snapshot={snapshot} available={cloudAvailable} onLinked={onPlatformChanged} />
      </div>
    </section>
  );
}
