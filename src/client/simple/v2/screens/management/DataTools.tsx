import { useState } from 'react';
import type { LocalPlatformSnapshot } from '../../../../adapters/indexeddb/platform.repository';
import {
  createWorkspaceBackup,
  downloadWorkspaceBackup,
  restoreWorkspaceBackup,
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
      const payload = await createWorkspaceBackup(snapshot);
      downloadWorkspaceBackup(payload);
      setBackupMessage('تم تصدير نسخة كاملة قابلة للاستيراد.');
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
      setBackupMessage('الملف صالح للاستيراد واجتاز فحص البنية والعلاقات.');
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
      setBackupMessage('جاري إعادة فحص الملف…');
      const checked = await validateWorkspaceBackupForImport(snapshot, restoreBackup);
      setRestoreValidation(checked.validation);

      setBackupMessage('جاري تنزيل نسخة أمان ثم استيراد البيانات…');
      const safety = await createWorkspaceBackup(snapshot);
      downloadWorkspaceBackup(safety, 'قبل-الاستيراد');

      await restoreWorkspaceBackup(snapshot, checked.backup);
      setRestoreBackup(null);
      setRestoreFilename('');
      setRestoreConfirm('');
      setRestoreValidation(null);
      setBackupMessage('تم الاستيراد بنجاح. النسخة المحلية والسحابية متطابقتان.');
      await onImported();
    } catch (error) {
      setBackupMessage(importErrorMessage(error instanceof Error ? error.message : 'BACKUP_RESTORE_FAILED'));
    } finally {
      setBackupBusy(false);
    }
  };

  return (
    <section className="management-subview">
      <SubHeader title="البيانات" subtitle="نسخة احتياطية كاملة واستيراد آمن لبيانات Sozan2" onBack={onBack} />

      <div className="management-group">
        <button className="management-row" type="button" onClick={onOpenActivity}>
          <span className="management-row-icon">↶</span>
          <span><strong>السجل</strong><small>راجعي التغييرات والتراجعات السابقة</small></span>
          <b>‹</b>
        </button>

        <button className="management-row" type="button" disabled={backupBusy} onClick={() => void exportBackup()}>
          <span className="management-row-icon">↓</span>
          <span><strong>تصدير نسخة كاملة</strong><small>كل بيانات العمل في ملف JSON قابل للحفظ والتعديل والاستيراد</small></span>
          <b>‹</b>
        </button>

        <label className="management-row">
          <span className="management-row-icon">↑</span>
          <span><strong>استيراد نسخة</strong><small>يفحص الملف والعلاقات أولًا، ثم يستبدل البيانات كعملية واحدة آمنة</small></span>
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
            سيتم تنزيل نسخة أمان من الوضع الحالي أولًا. بعدها يتم استبدال البيانات على السحابة كعملية ذرية واحدة ثم تطبيق نفس النسخة محليًا. اكتب «استيراد» للتأكيد.
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
    BACKUP_TOO_LARGE_FOR_ATOMIC_RESTORE: 'النسخة أكبر من الحد الآمن للاستيراد الذري الحالي. لم يتم تغيير أي بيانات.',
    BACKUP_NETWORK_ERROR: 'تعذر الاتصال بالخادم. لم يتم اعتبار الاستيراد ناجحًا.',
    BACKUP_REQUEST_TIMEOUT: 'انتهت مهلة الاتصال أثناء الاستيراد. لم يتم اعتبار العملية ناجحة.',
    BACKUP_RESPONSE_INVALID: 'الخادم أعاد استجابة غير صالحة للاستيراد.',
    BACKUP_RESPONSE_EMPTY: 'لم تصل استجابة مكتملة من الخادم.',
    BACKUP_RESTORE_FAILED: 'تعذر استيراد النسخة.',
    BACKUP_EXPORT_FAILED: 'تعذر تصدير النسخة.',
    SYNC_WRITE_IN_PROGRESS: 'هناك مزامنة أخرى قيد التنفيذ. انتظر قليلًا ثم أعد المحاولة.',
  };
  return messages[code] ?? `تعذر تنفيذ العملية (${code})`;
}
