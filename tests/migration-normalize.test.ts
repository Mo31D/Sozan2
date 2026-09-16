import { describe, expect, it } from 'vitest';
import { normalizeSozan1PayloadForImport } from '../src/server/migration/normalize';

describe('Sozan1 migration normalization', () => {
  it('converts untouched legacy billing defaults to 8-session packages', () => {
    const result = normalizeSozan1PayloadForImport({
      schemaVersion: 'sozan1-d1-export-v1',
      exportedAt: '2026-09-16T17:58:20.839Z',
      tables: {
        students_v3: [{ id: 1, created_at: '2026-09-15 10:00:00' }],
        activity_events_v4: [],
        student_billing_v6: [{
          student_id: 1,
          billing_mode: 'per_session',
          package_size: 8,
          package_price_pence: 0,
        }],
      },
    }) as { tables: { student_billing_v6: Array<Record<string, unknown>> } };

    expect(result.tables.student_billing_v6[0]).toMatchObject({
      billing_mode: 'package',
      package_size: 8,
      package_price_pence: 0,
    });
  });

  it('preserves an explicitly configured per-session choice', () => {
    const result = normalizeSozan1PayloadForImport({
      schemaVersion: 'sozan1-d1-export-v1',
      tables: {
        students_v3: [{ id: 1 }],
        student_billing_v6: [{ student_id: 1, billing_mode: 'per_session', package_size: 8, package_price_pence: 0 }],
        activity_events_v4: [{
          after_json: JSON.stringify({ student_id: 1, billing_mode: 'per_session' }),
        }],
      },
    }) as { tables: { student_billing_v6: Array<Record<string, unknown>> } };

    expect(result.tables.student_billing_v6[0]?.billing_mode).toBe('per_session');
  });

  it('turns Arabic unspecified times into pending schedules', () => {
    const result = normalizeSozan1PayloadForImport({
      schemaVersion: 'sozan1-d1-export-v1',
      tables: {
        recurring_sessions_v3: [{ id: 1, start_time: 'غير محدد', schedule_status: 'confirmed' }],
        session_occurrences_v3: [{ id: 1, scheduled_start: 'غير محدد' }],
      },
    }) as {
      tables: {
        recurring_sessions_v3: Array<Record<string, unknown>>;
        session_occurrences_v3: Array<Record<string, unknown>>;
      };
    };

    expect(result.tables.recurring_sessions_v3[0]).toMatchObject({ start_time: null, schedule_status: 'pending' });
    expect(result.tables.session_occurrences_v3[0]?.scheduled_start).toBeNull();
  });
});
