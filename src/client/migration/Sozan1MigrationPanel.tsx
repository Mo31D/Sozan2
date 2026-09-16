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
      if (parsed.schemaVersion !== 'sozan1-d1-export-v1') {
        throw new Error('MIGRATION_FILE_VERSION_UNSUPPORTED');
      }
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
      if (!response.ok || !('ok' in body)) {
        throw new Error(('error' in body && body.error) || `HTTP_${response.status}`);
      }
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
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">Sozan1 migration</p>
          <h2>انقل بيانات النسخة القديمة</h2>
        </div>
      </div>
      <p className="migration-copy">
        تصدير واحد من Sozan1 ثم استيراده هنا. الطلاب والجدول والحضور والباقات والتحصيل والمصروفات تنتقل بدون إعادة إدخال يدوي.
      </p>

      <label className="migration-file-picker">
        <span>اختر ملف Sozan1</span>
        <input type="file" accept="application/json,.json" onChange={(event) => void selectFile(event)} disabled={busy} />
      </label>

      {preview && (
        <div className="migration-preview">
          <strong>{fileName}</strong>
          {preview.exportedAt && <small>تاريخ التصدير: {new Date(preview.exportedAt).toLocaleString('ar-EG')}</small>}
          <div className="migration-stats">
            <span>طلاب: {summary?.students ?? 0}</span>
            <span>مواعيد: {summary?.recurringSessions ?? 0}</span>
            <span>حصص: {summary?.occurrences ?? 0}</span>
            <span>دورات باقات: {summary?.packageCycles ?? 0}</span>
          </div>
          <small>
            إجمالي المقبوض في الملف: {money(summary?.receivedPence ?? 0, currencyLabel)} · المصروفات: {money(summary?.expensesPence ?? 0, currencyLabel)}
          </small>
          <button className="primary-button" type="button" disabled={busy} onClick={() => void runImport()}>
            {busy ? 'جاري النقل والمزامنة…' : 'استيراد إلى مساحة العمل الحالية'}
          </button>
        </div>
      )}

      {done && (
        <div className="status good migration-result">
          <strong>تم نقل البيانات ومزامنتها.</strong>
          <span>الطلاب: {done.summary.students ?? 0}</span>
          <span>الحصص الفعلية: {done.summary.occurrences ?? 0}</span>
          <span>التحصيلات: {done.summary.receipts ?? 0}</span>
          {done.summary.skippedShadowSessions > 0 && (
            <span>تم تحويل جلسات تقدم الباقة الوهمية إلى Opening Progress بدل نقلها كحصص.</span>
          )}
          {done.warnings.includes('LEGACY_MONTHLY_DUES_PRESERVED_AS_LEGACY_ONLY') && (
            <span>وجدت آثارًا من نظام Monthly القديم وتم الاحتفاظ بإشارتها للمراجعة، بدون جعلها مستحقات جديدة.</span>
          )}
        </div>
      )}
      {error && <div className="status bad">{error}</div>}
    </section>
  );
}

function money(pence: number, currencyLabel: string): string {
  return `${(Number(pence || 0) / 100).toFixed(2)} ${currencyLabel}`;
}

function messageFor(cause: unknown): string {
  const code = cause instanceof Error ? cause.message : 'MIGRATION_FAILED';
  const messages: Record<string, string> = {
    MIGRATION_FILE_INVALID: 'الملف غير صالح كنسخة تصدير من Sozan1.',
    MIGRATION_FILE_VERSION_UNSUPPORTED: 'الملف ليس من أداة التصدير الجديدة الخاصة بـSozan1.',
    MIGRATION_TARGET_NOT_EMPTY: 'مساحة العمل الجديدة تحتوي بيانات بالفعل. النقل الكامل مسموح لمساحة فارغة فقط لمنع التكرار.',
    MIGRATION_ALREADY_COMPLETED: 'تم نقل Sozan1 إلى مساحة العمل هذه بالفعل.',
    MIGRATION_OWNER_REQUIRED: 'النقل يحتاج حساب المالك أو مدير مساحة العمل.',
    UNAUTHENTICATED: 'جلسة الحساب السحابي انتهت. سجل الدخول مرة أخرى.',
  };
  return messages[code] ?? `تعذر نقل البيانات (${code})`;
}
