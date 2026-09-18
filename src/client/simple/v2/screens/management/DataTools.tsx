import { useState } from 'react';
import type { LocalPlatformSnapshot } from '../../../../adapters/indexeddb/platform.repository';
import {
  createWorkspaceBackup,
  downloadWorkspaceBackup,
  restoreWorkspaceBackup,
} from '../../../../backup/workspace-backup';
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
  const [restoreFilename, setRestoreFilename] = useState('');
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
    setRestoreFilename('');
    setRestoreConfirm('');
    setBackupMessage('');
    if (!file) return;
    try {
      const parsed = workspaceBackupSchema.parse(JSON.parse(await file.text()));
      if (parsed.workspace.id !== snapshot.workspace.id) {
        throw new Error('BACKUP_WORKSPACE_ID_MISMATCH');
      }
      setRestoreFilename(file.name);
      setRestoreBackup(parsed);
      setBackupMessage('تم التحقق من ملف Sozan2. يمكنك استيراد النسخة الأصلية أو نسخة معدلة منها.');
    } catch (error) {
      const code = error instanceof Error ? error.message : 'BACKUP_FILE_INVALID';
      const messages: Record<string, string> = {
        BACKUP_WORKSPACE_ID_MISMATCH: 'هذا الملف يخص مساحة عمل Sozan2 مختلفة.',
        BACKUP_FILE_INVALID: 'الملف غير صالح للاستيراد.',
      };
      setBackupMessage(messages[code] ?? 'ملف JSON لا يطابق صيغة تصدير Sozan2. تأكد من عدم حذف بنية الملف الأساسية أثناء التعديل.');
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
      setRestoreBackup(null);
      setRestoreFilename('');
      setRestoreConfirm('');
      setBackupMessage('تم استيراد نسخة Sozan2 بنجاح، وتمت مزامنة البيانات المستوردة.');
      await onImported();
    } catch (error) {
      const code = error instanceof Error ? error.message : 'BACKUP_RESTORE_FAILED';
      const messages: Record<string, string> = {
        'Load failed': 'فشل الاتصال أثناء الاستعادة. لم يتم اعتبار العملية ناجحة؛ جرّبي مرة أخرى بعد تحديث النسخة المنشورة.',
        Failed to fetch: 'فشل الاتصال أثناء الاستعادة. لم يتم اعتبار العملية ناجحة؛ جرّبي مرة أخرى بعد تحديث النسخة المنشورة.',
        BACKUP_WORKSPACE_ID_MISMATCH: 'النسخة تخص مساحة عمل مختلفة.',
        BACKUP_RESTORE_FAILED: 'تعذر استعادة النسخة.',
      };
      setBackupMessage(messages[code] ?? code);
    } finally {
      setBackupBusy(false);
    }
  };

  return (
    <section className="management-subview">
      <SubHeader title="البيانات" subtitle="تصدير واستيراد نسخ Sozan2 أو ترحيل بيانات قديمة" onBack={onBack} />
      <div className="management-group">
        <button className="management-row" type="button" onClick={onOpenActivity}>
          <span className="management-row-icon">↶</span><span><strong>السجل</strong><small>راجعي التغييرات والتراجعات السابقة</small></span><b>‹</b>
        </button>
        <button className="management-row" type="button" disabled={backupBusy} onClick={() => void exportBackup()}>
          <span className="management-row-icon">↓</span><span><strong>تصدير نسخة Sozan2</strong><small>ملف JSON كامل يمكنك حفظه أو تعديله ثم استيراده مرة أخرى</small></span><b>‹</b>
        </button>
        <label className="management-row">
          <span className="management-row-icon">↑</span>
          <span><strong>استيراد نسخة Sozan2</strong><small>يقبل نفس ملف JSON الناتج من التصدير، بما في ذلك نسخة عدلتها يدويًا</small></span>
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
          <strong>ملف Sozan2 جاهز للاستيراد{restoreFilename ? `: ${restoreFilename}` : ''}</strong>
          <p className="management-helper">تاريخ التصدير: {restoreBackup.exportedAt.slice(0, 10)}</p>
          <p className="management-helper">
            الطلاب: {restoreBackup.stores.tutoringStudents.length} · الحصص: {restoreBackup.stores.tutoringSessions.length} · التحصيلات: {restoreBackup.stores.financeReceipts.length}
          </p>
          <p className="management-helper">سيتم تنزيل نسخة أمان من الوضع الحالي أولًا، ثم استبدال البيانات ببيانات الملف المختار. اكتب «استعادة» للتأكيد.</p>
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
        <summary><span>↥</span><div><strong>ترحيل من Sozan1</strong><small>أداة منفصلة للملفات القديمة فقط، وليست استيراد Sozan2</small></div><b>‹</b></summary>
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
