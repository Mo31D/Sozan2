import { useState } from 'react';
import type { LocalPlatformSnapshot } from '../../../../adapters/indexeddb/platform.repository';
import {
  createWorkspaceBackup,
  downloadWorkspaceBackup,
  restoreWorkspaceBackup,
} from '../../../../backup/workspace-backup';
import { runWorkspaceSync } from '../../../../sync/engine';
import { workspaceBackupSchema, type WorkspaceBackup } from '../../../../../modules/backup/workspace-backup';
import { Sozan1MigrationPanel } from '../../../../migration/Sozan1MigrationPanel';
import { SubHeader } from './ReportsHub';

export function DataTools({
  snapshot,
  onImported,
  onBack,
  onOpenActivity,
}: {
  snapshot: LocalPlatformSnapshot;
  onImported: () => Promise<void>;
  onBack: () => void;
  onOpenActivity: () => void;
}) {
  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreBackup, setRestoreBackup] = useState<WorkspaceBackup | null>(null);
  const [restoreConfirm, setRestoreConfirm] = useState('');
  const [backupMessage, setBackupMessage] = useState('');

  const exportBackup = async () => {
    setBackupBusy(true);
    setBackupMessage('');
    try {
      const payload = await createWorkspaceBackup(snapshot);
      downloadWorkspaceBackup(payload);
      setBackupMessage('تم تجهيز نسخة كاملة قابلة للاستعادة.');
    } catch (error) {
      setBackupMessage(error instanceof Error ? error.message : 'BACKUP_EXPORT_FAILED');
    } finally {
      setBackupBusy(false);
    }
  };

  const selectRestoreFile = async (file: File | null) => {
    setRestoreBackup(null);
    setRestoreConfirm('');
    setBackupMessage('');
    if (!file) return;
    try {
      const parsed = workspaceBackupSchema.parse(JSON.parse(await file.text()));
      if (parsed.workspace.id !== snapshot.workspace.id) {
        throw new Error('BACKUP_WORKSPACE_ID_MISMATCH');
      }
      setRestoreBackup(parsed);
    } catch (error) {
      setBackupMessage(error instanceof Error ? error.message : 'BACKUP_FILE_INVALID');
    }
  };

  const runRestore = async () => {
    if (!restoreBackup || restoreConfirm.trim() !== 'استعادة') return;
    setBackupBusy(true);
    setBackupMessage('');
    try {
      // Always create a safety copy immediately before the destructive restore.
      const safety = await createWorkspaceBackup(snapshot);
      downloadWorkspaceBackup(safety, 'قبل-الاستعادة');
      await restoreWorkspaceBackup(snapshot, restoreBackup);
      if (snapshot.cloudLink) await runWorkspaceSync(snapshot.workspace.id);
      setRestoreBackup(null);
      setRestoreConfirm('');
      setBackupMessage('تمت الاستعادة بنجاح، وتمت مزامنة النسخة المستعادة.');
      await onImported();
    } catch (error) {
      setBackupMessage(error instanceof Error ? error.message : 'BACKUP_RESTORE_FAILED');
    } finally {
      setBackupBusy(false);
    }
  };

  return (
    <section className="management-subview">
      <SubHeader title="البيانات" subtitle="السجل والنسخ والاستيراد" onBack={onBack} />
      <div className="management-group">
        <button className="management-row" type="button" onClick={onOpenActivity}>
          <span className="management-row-icon">↶</span><span><strong>السجل</strong><small>راجعي التغييرات والتراجعات السابقة</small></span><b>‹</b>
        </button>
        <button className="management-row" type="button" disabled={backupBusy} onClick={() => void exportBackup()}>
          <span className="management-row-icon">↓</span><span><strong>تصدير نسخة من البيانات</strong><small>ملف JSON مقروء للحفظ والمراجعة</small></span><b>‹</b>
        </button>
        <label className="management-row">
          <span className="management-row-icon">↑</span>
          <span><strong>استعادة نسخة كاملة</strong><small>تستبدل بيانات مساحة العمل الحالية بعد التحقق</small></span>
          <input
            type="file"
            accept="application/json,.json"
            disabled={backupBusy}
            onChange={(event) => void selectRestoreFile(event.currentTarget.files?.[0] ?? null)}
            style={{ display: 'none' }}
          />
          <b>‹</b>
        </label>
      </div>

      {backupMessage && <div className="management-helper">{backupMessage}</div>}
      {restoreBackup && (
        <div className="management-legacy-body">
          <strong>نسخة كاملة: {restoreBackup.exportedAt.slice(0, 10)}</strong>
          <p className="management-helper">
            الطلاب: {restoreBackup.stores.tutoringStudents.length} · الحصص: {restoreBackup.stores.tutoringSessions.length} · التحصيلات: {restoreBackup.stores.financeReceipts.length}
          </p>
          <p className="management-helper">سيتم تنزيل نسخة أمان من الوضع الحالي أولًا. اكتب «استعادة» للتأكيد.</p>
          <input
            value={restoreConfirm}
            onChange={(event) => setRestoreConfirm(event.currentTarget.value)}
            placeholder="استعادة"
            disabled={backupBusy}
          />
          <button
            type="button"
            disabled={backupBusy || restoreConfirm.trim() !== 'استعادة'}
            onClick={() => void runRestore()}
          >
            استعادة النسخة الآن
          </button>
        </div>
      )}

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
