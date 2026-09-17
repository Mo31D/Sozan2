import type { LocalPlatformSnapshot } from '../../../../adapters/indexeddb/platform.repository';
import { Sozan1MigrationPanel } from '../../../../migration/Sozan1MigrationPanel';
import type { SimpleWorkspaceData } from '../../../data';
import { SubHeader } from './ReportsHub';

export function DataTools({
  snapshot,
  data,
  onImported,
  onBack,
  onOpenActivity,
}: {
  snapshot: LocalPlatformSnapshot;
  data: SimpleWorkspaceData;
  onImported: () => Promise<void>;
  onBack: () => void;
  onOpenActivity: () => void;
}) {
  const exportBackup = () => {
    const payload = {
      schemaVersion: 'sozan2-readable-backup-v1',
      exportedAt: new Date().toISOString(),
      workspace: {
        id: snapshot.workspace.id,
        name: snapshot.workspace.name,
        templateKey: snapshot.workspace.templateKey,
        locale: snapshot.workspace.locale,
        timezone: snapshot.workspace.timezone,
        currencyCode: snapshot.workspace.currencyCode,
        currencyLabel: snapshot.workspace.currencyLabel,
      },
      user: {
        displayName: snapshot.user.displayName,
        locale: snapshot.user.locale,
        timezone: snapshot.user.timezone,
      },
      data,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `sozan2-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="management-subview">
      <SubHeader title="البيانات" subtitle="السجل والنسخ والاستيراد" onBack={onBack} />
      <div className="management-group">
        <button className="management-row" type="button" onClick={onOpenActivity}>
          <span className="management-row-icon">↶</span><span><strong>السجل</strong><small>راجعي التغييرات والتراجعات السابقة</small></span><b>‹</b>
        </button>
        <button className="management-row" type="button" onClick={exportBackup}>
          <span className="management-row-icon">↓</span><span><strong>تصدير نسخة من البيانات</strong><small>ملف JSON مقروء للحفظ والمراجعة</small></span><b>‹</b>
        </button>
      </div>

      <details className="management-legacy-import">
        <summary><span>↑</span><div><strong>استيراد بيانات قديمة</strong><small>فقط لو عندك ملف تصدير من Sozan1</small></div><b>‹</b></summary>
        <div className="management-legacy-body">
          <Sozan1MigrationPanel
            workspaceId={snapshot.workspace.id}
            cloudLinked={Boolean(snapshot.cloudLink)}
            currencyLabel={snapshot.workspace.currencyLabel}
            onImported={onImported}
          />
          {!snapshot.cloudLink && <p className="management-helper">استيراد Sozan1 يحتاج ربط الحساب السحابي أولًا لأنه ينقل البيانات إلى D1 ثم يعيد مزامنتها للجهاز.</p>}
        </div>
      </details>
    </section>
  );
}
