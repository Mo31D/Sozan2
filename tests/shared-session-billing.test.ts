import { describe, expect, it } from 'vitest';
import {
  billingOwnerStudentId,
  billingStudentIdsForOccurrence,
  type RecurringSession,
} from '../src/modules/tutoring/domain/session';

function session(overrides: Partial<RecurringSession> = {}): RecurringSession {
  return {
    id: 'session-1',
    workspaceId: 'workspace-1',
    title: 'أروى وسفيان',
    sessionType: 'private_student_home',
    scheduleStatus: 'confirmed',
    weekday: 0,
    startTime: '14:00',
    durationMinutes: 90,
    travelMinutes: 30,
    location: null,
    priceBasis: 'total_session',
    defaultPricePence: 0,
    expectedStudentCount: 2,
    centerCutBps: 0,
    active: true,
    studentIds: ['arwa', 'sofyan'],
    payerStudentId: 'arwa',
    ...overrides,
  };
}

describe('shared session billing ownership', () => {
  it('counts a total-session sibling lesson once on the household payer', () => {
    const shared = session();

    expect(billingStudentIdsForOccurrence(shared, ['arwa', 'sofyan'])).toEqual(['arwa']);
    expect(billingOwnerStudentId(shared)).toBe('arwa');
  });

  it('still advances the shared package when only the non-payer sibling attends', () => {
    const shared = session();

    expect(billingStudentIdsForOccurrence(shared, ['sofyan'])).toEqual(['arwa']);
  });

  it('keeps per-student billing tied to actual attendance', () => {
    const perStudent = session({
      priceBasis: 'per_student',
      payerStudentId: null,
    });

    expect(billingStudentIdsForOccurrence(perStudent, ['sofyan'])).toEqual(['sofyan']);
    expect(billingOwnerStudentId(perStudent)).toBeNull();
  });

  it('does not guess an owner for ambiguous legacy group lessons', () => {
    const legacy = session({ payerStudentId: null });

    expect(billingStudentIdsForOccurrence(legacy, ['arwa', 'sofyan'])).toEqual(['arwa', 'sofyan']);
    expect(billingOwnerStudentId(legacy)).toBeNull();
  });
});
