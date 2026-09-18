import { describe, expect, it } from 'vitest';
import { completedSessionFinancials } from '../src/modules/tutoring/domain/session-finance';

describe('completedSessionFinancials', () => {
  it('charges per-student sessions from observed participants, not planned headcount', () => {
    const result = completedSessionFinancials({
      priceBasis: 'per_student',
      defaultPricePence: 1000,
      centerCutBps: 0,
    }, 3);

    expect(result).toEqual({
      grossPence: 3000,
      centerCutPence: 0,
      earnedPence: 3000,
    });
  });

  it('keeps total-session price independent from participant count', () => {
    const result = completedSessionFinancials({
      priceBasis: 'total_session',
      defaultPricePence: 4500,
      centerCutBps: 2000,
    }, 4);

    expect(result).toEqual({
      grossPence: 4500,
      centerCutPence: 900,
      earnedPence: 3600,
    });
  });

  it('rejects invalid participant counts at the domain boundary', () => {
    expect(() => completedSessionFinancials({
      priceBasis: 'per_student',
      defaultPricePence: 1000,
      centerCutBps: 0,
    }, -1)).toThrow('SESSION_PARTICIPANT_COUNT_INVALID');
  });
});
