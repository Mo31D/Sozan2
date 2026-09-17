import { useMemo, useState } from 'react';
import {
  buildWorkspaceReportForRange,
  reportRangeForPreset,
  type ReportDateRange,
  type ReportPreset,
} from '../../../../../modules/reports/insights';
import { buildStudentFinancialSummary } from '../../../../../modules/reports/student-finance';
import { activeCycleFor, planFor, type SimpleWorkspaceData } from '../../../data';
import { ArabicDateField } from '../../localized-fields';
import { formatArabicDate, formatDurationArabic, money, todayIso } from '../../utils';

export type TutoringReportKind = 'work' | 'finance' | 'students' | 'attendance' | 'packages';

export function ReportsHub({
  data,
  currency,
  initialKind = 'work',
  initialPreset = 'week',
  onOpenStudent,
  onBack,
}: {
  data: SimpleWorkspaceData;
  currency: string;
  initialKind?: TutoringReportKind;
  initialPreset?: Exclude<ReportPreset, 'last28'>;
  onOpenStudent: (studentId: string) => void;
  onBack: () => void;
}) {
  const [kind, setKind] = useState<TutoringReportKind>(initialKind);
  const [preset, setPreset] = useState<Exclude<ReportPreset, 'last28'>>(initialPreset);
  const today = todayIso();
  const [fromDate, setFromDate] = useState(`${today.slice(0, 7)}-01`);
  const [toDate, setToDate] = useState(today);
  const range = useMemo(
    () => reportRangeForPreset(preset, today, preset === 'custom' ? { fromDate, toDate } : undefined),
    [preset, today, fromDate, toDate],
  );
  const report = useMemo(() => buildWorkspaceReportForRange(data, range), [data, range]);

  return (
    <section className="management-subview reports-hub">
      <SubHeader title="التقارير" subtitle={`${formatArabicDate(range.fromDate)} — ${formatArabicDate(range.toDate)}`} onBack={onBack} />

      <div className="report-kind-scroll" role="tablist" aria-label="نوع التقرير">
        <ReportKindButton active={kind === 'work'} onClick={() => setKind('work')}>العمل</ReportKindButton>
        <ReportKindButton active={kind === 'finance'} onClick={() => setKind('finance')}>الفلوس</ReportKindButton>
        <ReportKindButton active={kind === 'students'} onClick={() => setKind('students')}>الطلاب</ReportKindButton>
        <ReportKindButton active={kind === 'attendance'} onClick={() => setKind('attendance')}>الحضور</ReportKindButton>
        <ReportKindButton active={kind === 'packages'} onClick={() => setKind('packages')}>الباقات</ReportKindButton>
      </div>

      <div className="report-range-tabs" role="tablist" aria-label="فترة التقرير">
        <button type="button" className={preset === 'week' ? 'active' : ''} onClick={() => setPreset('week')}>أسبوع</button>
        <button type="button" className={preset === 'month' ? 'active' : ''} onClick={() => setPreset('month')}>شهر</button>
        <button type="button" className={preset === 'custom' ? 'active' : ''} onClick={() => setPreset('custom')}>مخصص</button>
      </div>

      {preset === 'custom' && (
        <div className="report-custom-range">
          <label>من<ArabicDateField value={fromDate} onValueChange={setFromDate} ariaLabel="بداية التقرير" /></label>
          <label>إلى<ArabicDateField value={toDate} onValueChange={setToDate} ariaLabel="نهاية التقرير" /></label>
        </div>
      )}

      {kind === 'work' && <WorkReport report={report} currency={currency} />}
      {kind === 'finance' && <FinanceReport report={report} currency={currency} />}
      {kind === 'students' && <StudentsReport data={data} range={range} currency={currency} onOpenStudent={onOpenStudent} />}
      {kind === 'attendance' && <AttendanceReport report={report} />}
      {kind === 'packages' && <PackagesReport data={data} currency={currency} onOpenStudent={onOpenStudent} />}

      <div className="report-insights-list">
        {report.insights.map((insight) => (
          <article className={`report-insight-card ${insight.level}`} key={insight.key}>
            <strong>{insight.title}</strong><span>{insight.detail}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

function WorkReport({ report, currency }: { report: ReturnType<typeof buildWorkspaceReportForRange>; currency: string }) {
  return <><article className="report-answer-card"><span>اشتغلتي خلال الفترة</span><strong>{formatDurationArabic(report.workMinutes)}</strong><small>{report.completedLessons} حصة مكتملة · قيمة الشغل {money(report.earnedPence, currency)}</small></article><MetricGrid items={[["وقت التدريس", formatDurationArabic(report.teachingMinutes)],["وقت الانتقال", formatDurationArabic(report.travelMinutes)],["العائد الحقيقي/ساعة", money(report.effectiveHourlyPence, currency)],["إلغاء أو فوات", String(report.cancelledLessons)]]} /></>;
}

function FinanceReport({ report, currency }: { report: ReturnType<typeof buildWorkspaceReportForRange>; currency: string }) {
  return <><article className="report-answer-card"><span>صافي الحركة خلال الفترة</span><strong>{money(report.netCashPence, currency)}</strong><small>المقبوض + الدخل الآخر − المصروفات</small></article><MetricGrid items={[["قبضتي", money(report.receivedPence, currency)],["دخل آخر", money(report.otherIncomePence, currency)],["صرفتي", money(report.expensesPence, currency)],["مطلوب تحصيله الآن", money(report.duePence, currency)]]} /></>;
}

function StudentsReport({ data, range, currency, onOpenStudent }: { data: SimpleWorkspaceData; range: ReportDateRange; currency: string; onOpenStudent: (studentId: string) => void }) {
  const sessionById = new Map(data.sessions.map((session) => [session.id, session]));
  const inRange = (value: string) => value.slice(0, 10) >= range.fromDate && value.slice(0, 10) <= range.toDate;
  const rows = data.students.map((student) => {
    const occurrences = data.occurrences.filter((occurrence) => {
      const session = sessionById.get(occurrence.recurringSessionId);
      return Boolean(session?.studentIds.includes(student.id)) && inRange(occurrence.rescheduledToDate ?? occurrence.sessionDate);
    });
    const completed = occurrences.filter((row) => row.status === 'completed');
    const cancelled = occurrences.filter((row) => row.status === 'cancelled' || row.status === 'missed').length;
    const minutes = completed.reduce((total, occurrence) => total + (sessionById.get(occurrence.recurringSessionId)?.durationMinutes ?? 0), 0);
    const received = data.receipts.filter((receipt) => receipt.payerRefId === student.id && inRange(receipt.receivedAt)).reduce((total, receipt) => total + receipt.amountPence, 0);
    const financial = buildStudentFinancialSummary(data, student.id);
    return { student, completed: completed.length, cancelled, minutes, received, due: financial.duePence };
  }).sort((a, b) => b.completed - a.completed || a.student.name.localeCompare(b.student.name, 'ar'));

  return <div className="report-row-list">{rows.map((row) => <button type="button" key={row.student.id} className="report-person-row" onClick={() => onOpenStudent(row.student.id)}><div className="avatar-circle">{row.student.name.trim().charAt(0)}</div><div><strong>{row.student.name}</strong><small>{row.completed} حصة · {formatDurationArabic(row.minutes)}{row.cancelled ? ` · ${row.cancelled} إلغاء/فوات` : ''}</small></div><div><b>{money(row.received, currency)}</b><small>{row.due ? `مستحق ${money(row.due, currency)}` : 'لا مستحقات'}</small></div></button>)}{!rows.length && <div className="friendly-empty">لا يوجد طلاب لعرضهم.</div>}</div>;
}

function AttendanceReport({ report }: { report: ReturnType<typeof buildWorkspaceReportForRange> }) {
  const total = report.completedLessons + report.cancelledLessons;
  const completedRate = total ? Math.round((report.completedLessons / total) * 100) : 0;
  return <><article className="report-answer-card"><span>الحصص التي تمت</span><strong>{report.completedLessons}</strong><small>{total ? `${completedRate}% من الحصص المحسومة خلال الفترة` : 'لا توجد حصص محسومة خلال الفترة'}</small></article><MetricGrid items={[["تمت", String(report.completedLessons)],["إلغاء/فوات", String(report.cancelledLessons)],["نسبة الإتمام", `${completedRate}%`],["الإجمالي المحسوم", String(total)]]} /></>;
}

function PackagesReport({ data, currency, onOpenStudent }: { data: SimpleWorkspaceData; currency: string; onOpenStudent: (studentId: string) => void }) {
  const rows = data.students.flatMap((student) => {
    const plan = planFor(data, student.id);
    const cycle = activeCycleFor(data, student.id);
    if (plan?.billingMode !== 'package' || !cycle) return [];
    const completed = cycle.openingCompletedCount + cycle.realCompletedCount;
    return [{ student, cycle, completed, remaining: Math.max(0, cycle.sessionLimit - completed) }];
  });
  return <div className="report-row-list">{rows.map((row) => <button type="button" key={row.student.id} className="report-person-row" onClick={() => onOpenStudent(row.student.id)}><div className="avatar-circle">{row.student.name.trim().charAt(0)}</div><div><strong>{row.student.name}</strong><small>{row.completed}/{row.cycle.sessionLimit} تمت · باقي {row.remaining}</small></div><div><b>{money(row.cycle.pricePence, currency)}</b><small>{row.cycle.status === 'due' ? 'جاهزة للتحصيل' : row.cycle.status === 'paid' ? 'مدفوعة' : 'جارية'}</small></div></button>)}{!rows.length && <div className="friendly-empty">لا توجد باقات نشطة.</div>}</div>;
}

function MetricGrid({ items }: { items: Array<[string, string]> }) { return <div className="management-metric-grid">{items.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>; }
function ReportKindButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) { return <button type="button" className={active ? 'active' : ''} onClick={onClick}>{children}</button>; }
export function SubHeader({ title, subtitle, onBack }: { title: string; subtitle?: string; onBack: () => void }) { return <header className="management-subheader"><div>{subtitle && <small>{subtitle}</small>}<h2>{title}</h2></div><button type="button" onClick={onBack}>رجوع</button></header>; }
