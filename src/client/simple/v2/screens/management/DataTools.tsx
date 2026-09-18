import { useState } from 'react';
import type { LocalPlatformSnapshot } from '../../../../adapters/indexeddb/platform.repository';
import {
  createLocalWorkspaceBackup,
  downloadWorkspaceBackup,
  importWorkspaceBackupLocalFirst,
  validateWorkspaceBackupForImport,
} from '../../../../backup/workspace-backup';
import type {
  BackupValidationSummary,
  WorkspaceBackup,
} from '../../../../../modules/backup/workspace-backup';
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
  const [restoreValidation, setRestoreValidation] = useState<BackupValidationSummary | null>(null);
  const [backupMessage, setBackupMessage] = useState('');

  const exportBackup = async () => {
    setBackupBusy(true);
    setBackupMessage('');
    try {
      const payload = await createLocalWorkspaceBackup(snapshot);
      downloadWorkspaceBackup(payload);
      setBackupMessage('تم تصدير نسخة كاملة من البيانات الموجودة على هذا الجهاز.');
    } catch (error) {
      setBackupMessage(importErrorMessage(error instanceof Error ? error.message : 'BACKUP_EXPORT_FAILED'));
    } finally {
      setBackupBusy(false);
    }
  };

  const selectRestoreFile = async (file: File | null) => {
    setRestoreBackup(null);
    setRestoreFilename('');
    setRestoreConfirm('');
    setRestoreValidation(null);
    setBackupMessage('');
    if (!file) return;

    setBackupBusy(true);
    try {
      const raw = JSON.parse(await file.text()) as unknown;
      const checked = await validateWorkspaceBackupForImport(snapshot, raw);
      setRestoreFilename(file.name);
      setRestoreBackup(checked.backup);
      setRestoreValidation(checked.validation);
      setBackupMessage('الملف صالح للاستيراد. الفحص تم على الجهاز ولم يعتمد على الاتصال بالسحابة.');
    } catch (error) {
      setBackupMessage(importErrorMessage(error instanceof Error ? error.message : 'BACKUP_FILE_INVALID'));
    } finally {
      setBackupBusy(false);
    }
  };

  const runRestore = async () => {
    if (!restoreBackup || restoreConfirm.trim() !== 'استيراد') return;

    setBackupBusy(true);
    try {
      const checked = await validateWorkspaceBackupForImport(snapshot, restoreBackup);
      setRestoreValidation(checked.validation);

      setBackupMessage('جاري إنشاء نسخة أمان محلية ثم استبدال البيانات…');
      const outcome = await importWorkspaceBackupLocalFirst(snapshot, checked.backup, {
        onSafetyBackup: (safety) => {
          downloadWorkspaceBackup(safety, 'قبل-الاستيراد');
          setBackupMessage('تم حفظ نسخة الأمان. جاري استبدال البيانات على الجهاز…');
        },
      });

      setRestoreBackup(null);
      setRestoreFilename('');
      setRestoreConfirm('');
      setRestoreValidation(null);

      if (outcome.cloud === 'synced') {
        setBackupMessage('تم الاستيراد بنجاح على الجهاز والسحابة، وتم توحيد النسختين.');
      } else if (outcome.cloud === 'pending') {
        setBackupMessage(
          'تم استيراد البيانات بنجاح على الجهاز. رفع النسخة للسحابة لم يُؤكد بعد، لذلك تم إيقاف المزامنة مؤقتًا لحماية البيانات المستوردة. يمكنك إكمال الرفع من إعدادات الحساب.',
        );
      } else {
        setBackupMessage('تم الاستيراد بنجاح على هذا الجهاز.');
      }

      await onImported();
    } catch (error) {
      setBackupMessage(importErrorMessage(error instanceof Error ? error.message : 'BACKUP_RESTORE_FAILED'));
    } finally {
      setBackupBusy(false);
    }
  };

  const cloudPending = snapshot.cloudLink?.initializationState === 'provisioning'
    && snapshot.cloudLink.provisioningReason === 'backup-import';

  return (
    <section className="management-subview">
      <SubHeader title="البيانات" subtitle="نسخ محلية كاملة واستيراد Local-first آمن" onBack={onBack} />

      {cloudPending && (
        <div className="management-helper">
          النسخة المستوردة محفوظة على الجهاز، والمزامنة السحابية متوقفة مؤقتًا حتى يكتمل رفع النسخة الجديدة من إعدادات الحساب.
        </div>
      )}

      <div className="management-group">
        <button className="management-row" type="button" onClick={onOpenActivity}>
          <span className="management-row-icon">↶</span>
          <span><strong>السجل</strong><small>راجعي التغييرات والتراجعات السابقة</small></span>
          <b>‹</b>
        </button>

        <button className="management-row" type="button" disabled={backupBusy} onClick={() => void exportBackup()}>
          <span className="management-row-icon">↓</span>
          <span>
            <strong>تصدير نسخة كاملة</strong>
            <small>نسخة من البيانات الفعلية الموجودة على الجهاز، وتشمل أي تعديلات لم تُرفع للسحابة بعد</small>
          </span>
          <b>‹</b>
        </button>

        <label className="management-row">
          <span className="management-row-icon">↑</span>
          <span>
            <strong>استيراد نسخة</strong>
            <small>يفحص الملف محليًا، يحفظ نسخة أمان، ثم يستبدل بيانات الجهاز قبل محاولة تحديث السحابة</small>
          </span>
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
          <strong>ملف جاهز للاستيراد{restoreFilename ? `: ${restoreFilename}` : ''}</strong>
          <p className="management-helper">تاريخ التصدير: {restoreBackup.exportedAt.slice(0, 10)}</p>
          <p className="management-helper">
            الطلاب: {restoreValidation?.counts.students ?? restoreBackup.stores.tutoringStudents.length}
            {' · '}الحصص: {restoreValidation?.counts.sessions ?? restoreBackup.stores.tutoringSessions.length}
            {' · '}أعداد الحصص السابقة: {restoreValidation?.counts.baselines ?? restoreBackup.stores.tutoringStudentBaselines.length}
            {' · '}التحصيلات: {restoreValidation?.counts.receipts ?? restoreBackup.stores.financeReceipts.length}
          </p>

          {restoreValidation?.warnings.includes('BACKUP_CENTER_GROUP_MEMBERSHIP_DAY_UNASSIGNED') && (
            <p className="management-helper">طلاب السنتر محفوظون بدون افتراض يوم حضور فردي غير مؤكد.</p>
          )}

          <p className="management-helper">
            سيتم أولًا تنزيل نسخة أمان من الوضع الحالي. بعد ذلك تُستبدل بيانات الجهاز في معاملة واحدة. لو تعذر الاتصال بالسحابة، تبقى البيانات الجديدة محفوظة محليًا وتُوقف المزامنة القديمة بدل أن تعيد البيانات السابقة. اكتب «استيراد» للتأكيد.
          </p>

          <input
            value={restoreConfirm}
            onChange={(event) => setRestoreConfirm(event.currentTarget.value)}
            placeholder="استيراد"
            disabled={backupBusy}
          />
          <button
            type="button"
            disabled={backupBusy || restoreConfirm.trim() !== 'استيراد'}
            onClick={() => void runRestore()}
          >
            {backupBusy ? 'جاري الاستيراد…' : 'استيراد النسخة الآن'}
          </button>
        </div>
      )}
    </section>
  );
}

function importErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    BACKUP_WORKSPACE_ID_MISMATCH: 'النسخة تخص مساحة عمل مختلفة.',
    BACKUP_WORKSPACE_SCOPE_MISMATCH: 'الملف يحتوي سجلات تخص مساحة عمل مختلفة.',
    BACKUP_FILE_INVALID: 'الملف ليس نسخة Sozan2 صالحة.',
    BACKUP_VALIDATION_FAILED: 'فشل فحص سلامة البيانات داخل الملف.',
    BACKUP_DUPLICATE_STUDENT_ID: 'يوجد طالب مكرر بنفس المعرّف داخل الملف.',
    BACKUP_DUPLICATE_SESSION_ID: 'توجد حصة مكررة بنفس المعرّف داخل الملف.',
    BACKUP_SESSION_STUDENT_MISSING: 'توجد حصة مرتبطة بطالب غير موجود في الملف.',
    BACKUP_SESSION_PAYER_NOT_LINKED: 'بيانات دافع إحدى الحصص لا تتطابق مع الطلاب المرتبطين بها.',
    BACKUP_CONFIRMED_SESSION_SCHEDULE_INVALID: 'يوجد موعد مؤكد بدون يوم أو وقت صحيح.',
    BACKUP_BASELINE_STUDENT_MISSING: 'عدد حصص سابق مرتبط بطالب غير موجود.',
    BACKUP_BASELINE_COUNT_INVALID: 'يوجد عدد حصص سابق غير صالح.',
    BACKUP_MANIFEST_COUNT_MISMATCH: 'أعداد محتويات الملف لا تطابق البيانات الفعلية داخله.',
    BACKUP_TOO_LARGE_FOR_ATOMIC_RESTORE: 'النسخة أكبر من الحد الآمن للاستيراد السحابي. تم الاحتفاظ بالنسخة المحلية ويمكن إكمال الرفع لاحقًا.',
    BACKUP_IMPORT_REVISION_CONFLICT: 'النسخة السحابية تغيرت منذ آخر مزامنة. بيانات الاستيراد المحلية محمية ولن تُستبدل تلقائيًا.',
    BACKUP_IMPORT_IN_PROGRESS: 'يوجد استيراد آخر قيد التنفيذ.',
    BACKUP_CLOUD_STATUS_UNKNOWN: 'تم حفظ البيانات على الجهاز، لكن حالة الرفع للسحابة غير مؤكدة حتى يعود الاتصال.',
    BACKUP_NETWORK_ERROR: 'تعذر الاتصال بالسحابة.',
    BACKUP_REQUEST_TIMEOUT: 'انتهت مهلة الاتصال بالسحابة.',
    BACKUP_RESTORE_FAILED: 'تعذر استيراد النسخة.',
    BACKUP_EXPORT_FAILED: 'تعذر تصدير النسخة.',
    WORKSPACE_OPERATION_BUSY: 'هناك عملية مزامنة أو استيراد أخرى قيد التنفيذ. انتظر لحظات ثم أعد المحاولة.',
    SYNC_WRITE_IN_PROGRESS: 'هناك عملية كتابة سحابية أخرى قيد التنفيذ. انتظر قليلًا ثم أعد المحاولة.',
  };
  return messages[code] ?? `تعذر تنفيذ العملية (${code})`;
}
