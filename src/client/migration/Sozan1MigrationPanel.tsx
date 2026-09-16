import { ChangeEvent, useState } from 'react';
import { runWorkspaceSync } from '../sync/engine';

type ExportPreview = {
  schemaVersion?: string;
  exportedAt?: string;
  summary?: {
    students?: number;
    recurringSessions?: number;
    occurrences?: number;
    packageCycles?: number;
    directPayments?: number;
    studentReceipts?: number;
    receivedPence?: number;
    expensesPence?: number;
  };
};

type ImportResult = {
  ok: true;
  summary: Record<string, number>;
  warnings: string[];
};

export function Sozan1MigrationPanel({
  workspaceId,
  cloudLinked,
  currencyLabel,
  onImported,
}: {
  workspaceId: string;
  cloudLinked: boolean;
  currencyLabel: string;
  onImported: () => Promise<void>;
}) {
  const [rawFile, setRawFile] = useState<string | null>(null);
  const [preview, setPreview] = useState<ExportPreview | null>(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<ImportResult | null>(null);

  if (!cloudLinked) return null;

  const selectFile = async (event: ChangeEvent<HTMLInputElement>) => {
    setError('');
    setDone(null);
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as ExportPreview;
      if (parsed.schemaVersion !== 'sozan1-d1-export-v1') throw new Error('MIGRATION_FILE_VERSION_UNSUPPORTED');
      setRawFile(text);
      setPreview(parsed);
      setFileName(file.name);
    } catch (cause) {
      setRawFile(null);
      setPreview(null);
      setFileName('');
      setError(messageFor(cause));
    }
  };

  const runImport = async () => {
    if (!rawFile) return;
    setBusy(true);
    setError('');
    setDone(null);
    try {
      const response = await fetch(`/api/migration/${workspaceId}/sozan1`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: rawFile,
      });
      const body = await response.json() as ImportResult | { error?: string };
      if (!response.ok || !('ok' in body)) throw new Error(('error' in body && body.error) || `HTTP_${response.status}`);
      await runWorkspaceSync(workspaceId);
      await onImported();
      setDone(body);
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  };

  const summary = preview?.summary;
  return (
    <section className="panel migration-panel">
      <div className="section-heading compact-heading"><div><p className="eyebrow">النسخة القديمة</p><h2>انقل بيانات سوزان القديمة</h2></div></div>
      <p className="migration-copy">اختاري ملف التصدير القديم. الطلاب والمواعيد والحضور والباقات والتحصيل والمصروفات تنتقل مرة واحدة بدون إدخال يدوي.</p>

      <label className="migration-file-picker">
        <span>{fileName || 'اختيار ملف البيانات'}</span>
        <input type="file" accept="application/json,.json" onChange={(event) => void selectFile(event)} disabled={busy} />
      </label>

      {preview && (
        <div className="migration-preview">
          {preview.exportedAt && <small>تاريخ التصدير: {new Date(preview.exportedAt).toLocaleString('ar-EG')}</small>}
          <div className="migration-stats">
            <span>طلاب: {summary?.students ?? 0}</span>
            <span>مواعيد: {summary?.recurringSessions ?? 0}</span>
            <span>حصص: {summary?.occurrences ?? 0}</span>
            <span>باقات مكتملة سابقًا: {summary?.packageCycles ?? 0}</span>
          </div>
          <small>المقبوض: {money(summary?.receivedPence ?? 0, currencyLabel)} · المصروفات: {money(summary?.expensesPence ?? 0, currencyLabel)}</small>
          <button className="primary-button" type="button" disabled={busy} onClick={() => void runImport()}>{busy ? 'جاري النقل والمزامنة…' : 'نقل البيانات إلى حسابي'}</button>
        </div>
      )}

      {done && (
        <div className="status good migration-result">
          <strong>تم نقل البيانات ومزامنتها.</strong>
          <span>الطلاب: {done.summary.students ?? 0}</span>
          <span>الحصص المسجلة: {done.summary.occurrences ?? 0}</span>
          <span>التحصيلات: {done.summary.receipts ?? 0}</span>
          {done.summary.skippedShadowSessions > 0 && <span>تم تحويل تقدم الباقات القديمة إلى تقدم حقيقي داخل الباقة الجديدة بدون إنشاء حصص وهمية.</span>}
          {done.warnings.includes('LEGACY_MONTHLY_DUES_PRESERVED_AS_LEGACY_ONLY') && <span>وجدت بيانات من نظام حساب قديم وتم الاحتفاظ بها للمراجعة بدون إنشاء مستحقات جديدة.</span>}
        </div>
      )}
      {error && <div className="status bad">{error}</div>}
    </section>
  );
}

function money(pence: number, currencyLabel: string): string {
  return `${(Number(pence || 0) / 100).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ${currencyLabel}`;
}

function messageFor(cause: unknown): string {
  const code = cause instanceof Error ? cause.message : 'MIGRATION_FAILED';
  const messages: Record<string, string> = {
    MIGRATION_FILE_INVALID: 'الملف غير صالح كنسخة تصدير من البرنامج القديم.',
    MIGRATION_FILE_VERSION_UNSUPPORTED: 'الملف ليس من أداة التصدير الصحيحة للنسخة القديمة.',
    MIGRATION_TARGET_NOT_EMPTY: 'الحساب يحتوي بيانات بالفعل. النقل الكامل مسموح للحساب الفارغ فقط حتى لا تتكرر البيانات.',
    MIGRATION_ALREADY_COMPLETED: 'تم نقل بيانات النسخة القديمة إلى الحساب ده بالفعل.',
    MIGRATION_OWNER_REQUIRED: 'النقل يحتاج حساب المالك أو المدير.',
    UNAUTHENTICATED: 'جلسة الحساب انتهت. سجلي الدخول مرة أخرى.',
  };
  return messages[code] ?? `تعذر نقل البيانات (${code})`;
}
