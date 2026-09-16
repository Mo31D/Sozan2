import { describe, expect, it } from 'vitest';
import { formatPence, parseMoneyToPence } from '../src/domain/money';

describe('money', () => {
  it('parses pounds without floating point arithmetic', () => {
    expect(parseMoneyToPence('12.34')).toBe(1234);
    expect(parseMoneyToPence('12.3')).toBe(1230);
    expect(parseMoneyToPence(12)).toBe(1200);
  });

  it('rejects invalid precision and negative values', () => {
    expect(parseMoneyToPence('12.345')).toBeNull();
    expect(parseMoneyToPence('-2')).toBeNull();
    expect(parseMoneyToPence('abc')).toBeNull();
  });

  it('formats integer pence', () => {
    expect(formatPence(1234, 'ج')).toBe('12.34 ج');
  });
});
