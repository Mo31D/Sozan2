import { parseSozan1Export } from './sozan1';

type LegacyRow = Record<string, unknown>;

type Reconciliation = {
  ok: boolean;
  expected: {
    students: number;
    recurringSessions: number;
    occurrences: number;
    teachingReceivedPence: number;
    otherIncomePence: number;
    expensesPence: number;
    packageCycles: number;
  };
  actual: {
    students: number;
    recurringSessions: number;
    occurrences: number;
    teachingReceivedPence: number;
    otherIncomePence: number;
    expensesPence: number;
    packageCycles: number;
  };
  mismatches: string[];
};

export async function reconcileSozan1Migration(
  db: D1Database,
  workspaceId: string,
  rawPayload: unknown,
): Promise<Reconciliation> {
  const payload = parseSozan1Export(rawPayload);
  const table = (name: string): LegacyRow[] => payload.tables[name] ?? [];

  const openingProgress = table('package_opening_progress_v7');
  const shadowSessionIds = new Set(
    openingProgress.map((row) => key(row.shadow_session_id)).filter(Boolean),
  );
  const shadowOccurrenceIds = new Set(
    table('session_occurrences_v3')
      .filter((row) => shadowSessionIds.has(key(row.recurring_session_id)))
      .map((row) => key(row.id)),
  );

  const expected = {
    students: table('students_v3').length,
    recurringSessions: table('recurring_sessions_v3').filter((row) => !shadowSessionIds.has(key(row.id))).length,
    occurrences: table('session_occurrences_v3').filter((row) => !shadowOccurrenceIds.has(key(row.id))).length,
    teachingReceivedPence:
      sumActive(table('payments_v3'), 'amount_pence', (row) => !truthyText(row.reversed_at)) +
      sumActive(table('student_receipts_v4'), 'amount_pence', (row) => !truthyText(row.deleted_at)),
    otherIncomePence: sumActive(table('other_income_v3'), 'amount_pence', (row) => !truthyText(row.deleted_at)),
    expensesPence: sumActive(table('expenses_v3'), 'amount_pence', (row) => !truthyText(row.deleted_at)),
    packageCycles: table('package_cycles_v6').length,
  };

  const counts = await db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM tutoring_students WHERE workspace_id=?1) AS students,
       (SELECT COUNT(*) FROM tutoring_recurring_sessions WHERE workspace_id=?1) AS sessions,
       (SELECT COUNT(*) FROM tutoring_occurrences WHERE workspace_id=?1) AS occurrences,
       (SELECT COUNT(*) FROM tutoring_billing_cycles WHERE workspace_id=?1) AS cycles,
       (SELECT COALESCE(SUM(amount_pence),0) FROM finance_receipts
          WHERE workspace_id=?1 AND source_kind='migration' AND deleted_at IS NULL) AS teaching_received,
       (SELECT COALESCE(SUM(amount_pence),0) FROM finance_other_income
          WHERE workspace_id=?1 AND deleted_at IS NULL) AS other_income,
       (SELECT COALESCE(SUM(amount_pence),0) FROM finance_expenses
          WHERE workspace_id=?1 AND deleted_at IS NULL) AS expenses`,
  ).bind(workspaceId).first<{
    students: number;
    sessions: number;
    occurrences: number;
    cycles: number;
    teaching_received: number;
    other_income: number;
    expenses: number;
  }>();

  const actual = {
    students: Number(counts?.students ?? 0),
    recurringSessions: Number(counts?.sessions ?? 0),
    occurrences: Number(counts?.occurrences ?? 0),
    teachingReceivedPence: Number(counts?.teaching_received ?? 0),
    otherIncomePence: Number(counts?.other_income ?? 0),
    expensesPence: Number(counts?.expenses ?? 0),
    packageCycles: Number(counts?.cycles ?? 0),
  };

  const mismatches: string[] = [];
  compare(mismatches, 'students', expected.students, actual.students);
  compare(mismatches, 'recurringSessions', expected.recurringSessions, actual.recurringSessions);
  compare(mismatches, 'occurrences', expected.occurrences, actual.occurrences);
  compare(mismatches, 'teachingReceivedPence', expected.teachingReceivedPence, actual.teachingReceivedPence);
  compare(mismatches, 'otherIncomePence', expected.otherIncomePence, actual.otherIncomePence);
  compare(mismatches, 'expensesPence', expected.expensesPence, actual.expensesPence);
  compare(mismatches, 'packageCycles', expected.packageCycles, actual.packageCycles);

  return { ok: mismatches.length === 0, expected, actual, mismatches };
}

export async function markMigrationUnverified(db: D1Database, workspaceId: string): Promise<void> {
  await db.prepare(
    `DELETE FROM core_workspace_settings
     WHERE workspace_id=?1 AND key='migration.sozan1.completed_at'`,
  ).bind(workspaceId).run();
  await db.prepare(
    `INSERT INTO core_workspace_settings(workspace_id,key,value,updated_at)
     VALUES (?1,'migration.sozan1.reconciliation_failed_at',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
     ON CONFLICT(workspace_id,key) DO UPDATE SET value=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP`,
  ).bind(workspaceId).run();
}

function compare(mismatches: string[], field: string, expected: number, actual: number): void {
  if (expected !== actual) mismatches.push(`${field}:${expected}->${actual}`);
}

function sumActive(rows: LegacyRow[], keyName: string, include: (row: LegacyRow) => boolean): number {
  return rows.reduce((total, row) => {
    if (!include(row)) return total;
    const value = Number(row[keyName] ?? 0);
    return total + (Number.isFinite(value) ? Math.trunc(value) : 0);
  }, 0);
}

function key(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
  return typeof value === 'string' ? value.trim() : '';
}

function truthyText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}
