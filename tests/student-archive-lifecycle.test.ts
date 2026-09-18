import { describe, expect, it } from 'vitest';
import { archiveStudentFromRecurringSession } from '../src/modules/tutoring/domain/student-lifecycle';
import type { RecurringSession } from '../src/modules/tutoring/domain/session';

function session(studentIds: string[], overrides: Partial<RecurringSession> = {}): RecurringSession {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    workspaceId: '11111111-1111-4111-8111-111111111111',
    title: 'حصة',
    sessionType: 'own_group',
    scheduleStatus: 'confirmed',
    weekday: 1,
    startTime: '17:00',
    durationMinutes: 60,
    travelMinutes: 0,
    location: null,
    priceBasis: 'total_session',
    defaultPricePence: 0,
    expectedStudentCount: studentIds.length || 1,
    centerCutBps: 0,
    active: true,
    studentIds,
    payerStudentId: studentIds[0] ?? null,
    ...overrides,
  };
}

describe('student archive lifecycle', () => {
  it('deactivates a sole-student recurring session without erasing its historical link', () => {
    const current = session(['student-a'], { payerStudentId: 'student-a' });
    const result = archiveStudentFromRecurringSession(current, 'student-a');

    expect(result.kind).toBe('deactivated');
    expect(result.session.active).toBe(false);
    expect(result.session.studentIds).toEqual(['student-a']);
    expect(result.session.payerStudentId).toBe('student-a');
  });

  it('detaches a student from a shared future session and never guesses a replacement payer', () => {
    const current = session(['student-a', 'student-b'], {
      expectedStudentCount: 2,
      payerStudentId: 'student-a',
    });
    const result = archiveStudentFromRecurringSession(current, 'student-a');

    expect(result.kind).toBe('detached');
    expect(result.session.active).toBe(true);
    expect(result.session.studentIds).toEqual(['student-b']);
    expect(result.session.expectedStudentCount).toBe(1);
    expect(result.session.payerStudentId).toBeNull();
  });

  it('leaves unrelated and already inactive sessions untouched', () => {
    expect(archiveStudentFromRecurringSession(session(['student-b']), 'student-a').kind).toBe('unchanged');
    expect(archiveStudentFromRecurringSession(session(['student-a'], { active: false }), 'student-a').kind).toBe('unchanged');
  });
});
