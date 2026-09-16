import { buildWorkspaceReport } from '../../../modules/reports/insights';
import type { SimpleWorkspaceData } from '../../simple/data';
import { money } from '../presentation';

export function ReportView({ data, currency }: { data: SimpleWorkspaceData; currency: string }) {
  const report = buildWorkspaceReport(data);
  return (
    <div className="report-view">
      <div className="profile-metrics report-metrics">
        <div><span>حصص مكتملة</span><strong>{report.completedLessons}</strong></div>
        <div><span>صافي الحركة</span><strong>{money(report.netCashPence, currency)}</strong></div>
        <div><span>مطلوب تحصيله</span><strong>{money(report.duePence, currency)}</strong></div>
      </div>
      <article className="control-card">
        <small>آخر 28 يومًا</small>
        <div className="report-grid">
          <p><span>المقبوض</span><b>{money(report.receivedPence, currency)}</b></p>
          <p><span>دخل آخر</span><b>{money(report.otherIncomePence, currency)}</b></p>
          <p><span>المصروفات</span><b>{money(report.expensesPence, currency)}</b></p>
          <p><span>الإلغاءات/الفائت</span><b>{report.cancelledLessons}</b></p>
          <p><span>وقت التدريس</span><b>{report.teachingMinutes} د</b></p>
          <p><span>وقت الانتقال</span><b>{report.travelMinutes} د</b></p>
          <p><span>العائد الحقيقي/ساعة</span><b>{money(report.effectiveHourlyPence, currency)}</b></p>
        </div>
      </article>
      <div className="control-list">
        {report.insights.map((insight) => (
          <article className={`report-insight ${insight.level}`} key={insight.key}>
            <strong>{insight.title}</strong><p>{insight.detail}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
