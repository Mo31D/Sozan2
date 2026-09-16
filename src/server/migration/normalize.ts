type LegacyRow = Record<string, unknown>;

const UNSET_TIME_LABELS = new Set(['غير محدد', 'undefined', 'unknown', 'n/a', 'na', '-']);

/**
 * Normalise Sozan1 export semantics before importing them into the stricter
 * Sozan2 model.
 *
 * Two legacy behaviours need interpretation rather than literal copying:
 * 1. Sozan1 seeded every active student with per_session + package_size=8.
 *    An untouched seeded row therefore means "billing not configured", not an
 *    explicit per-session decision. Those rows become 8-session packages.
 * 2. The paper-schedule importer used the Arabic text "غير محدد" as a time.
 *    Sozan2 represents that correctly as a pending schedule with no start time.
 */
export function normalizeSozan1PayloadForImport(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;

  const root = value as Record<string, unknown>;
  const rawTables = root.tables;
  if (!rawTables || typeof rawTables !== 'object' || Array.isArray(rawTables)) return value;

  const tables = { ...(rawTables as Record<string, unknown>) };
  const activities = rows(tables.activity_events_v4);
  const explicitlyConfiguredBillingStudents = explicitBillingStudents(activities);

  const students = rows(tables.students_v3);
  const billing = rows(tables.student_billing_v6).map((row) => {
    const studentId = key(row.student_id);
    const mode = text(row.billing_mode);

    if (mode === 'package') {
      return {
        ...row,
        package_size: validPositiveInt(row.package_size) ?? 8,
      };
    }

    if (mode === 'per_session' && explicitlyConfiguredBillingStudents.has(studentId)) {
      return row;
    }

    // In Sozan1 migration 0010, per_session/8/0 was inserted automatically for
    // every active student. If nobody explicitly edited billing afterwards, it
    // is an unset legacy default. User policy for migration: default to 8 lessons.
    return {
      ...row,
      billing_mode: 'package',
      package_size: 8,
      package_price_pence: validNonNegativeInt(row.package_price_pence) ?? 0,
    };
  });

  const existingBillingStudents = new Set(billing.map((row) => key(row.student_id)).filter(Boolean));
  const exportedAt = text(root.exportedAt) || new Date().toISOString();
  for (const student of students) {
    const studentId = key(student.id);
    if (!studentId || existingBillingStudents.has(studentId)) continue;
    const anchor = (text(student.created_at) || exportedAt).slice(0, 10);
    billing.push({
      student_id: student.id,
      billing_mode: 'package',
      package_size: 8,
      package_price_pence: 0,
      cycle_anchor_date: anchor,
      created_at: text(student.created_at) || exportedAt,
      updated_at: text(student.updated_at) || text(student.created_at) || exportedAt,
    });
  }

  tables.student_billing_v6 = billing;
  tables.recurring_sessions_v3 = rows(tables.recurring_sessions_v3).map((row) => {
    const start = normalizedTime(row.start_time);
    if (start !== null) return row;
    return {
      ...row,
      start_time: null,
      schedule_status: 'pending',
    };
  });
  tables.session_occurrences_v3 = rows(tables.session_occurrences_v3).map((row) => ({
    ...row,
    scheduled_start: normalizedTime(row.scheduled_start),
    rescheduled_to_start: normalizedTime(row.rescheduled_to_start),
  }));

  return { ...root, tables };
}

function explicitBillingStudents(activities: LegacyRow[]): Set<string> {
  const result = new Set<string>();
  for (const activity of activities) {
    for (const field of ['before_json', 'after_json'] as const) {
      const parsed = parseJsonObject(activity[field]);
      if (!parsed || !Object.prototype.hasOwnProperty.call(parsed, 'billing_mode')) continue;
      const studentId = key(parsed.student_id);
      if (studentId) result.add(studentId);
    }
  }
  return result;
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function normalizedTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || UNSET_TIME_LABELS.has(trimmed.toLowerCase())) return null;
  return trimmed;
}

function rows(value: unknown): LegacyRow[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is LegacyRow => Boolean(row) && typeof row === 'object' && !Array.isArray(row));
}

function key(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
  return typeof value === 'string' ? value.trim() : '';
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function validPositiveInt(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.trunc(parsed) : null;
}

function validNonNegativeInt(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : null;
}
