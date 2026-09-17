import { describe, expect, it } from 'vitest';
import { lessonTimeDefaults } from '../src/client/simple/v2/session-defaults';
import {
  formatArabicDate,
  formatClockTime,
  formatDurationArabic,
} from '../src/client/simple/v2/utils';

describe('Arabic schedule presentation', () => {
  it('formats clock values as Arabic 12-hour times without redundant zero minutes', () => {
    expect(formatClockTime('09:00')).toBe('٩ صباحًا');
    expect(formatClockTime('14:30')).toBe('٢:٣٠ مساءً');
    expect(formatClockTime('00:00')).toBe('١٢ صباحًا');
    expect(formatClockTime('12:05')).toBe('١٢:٠٥ مساءً');
    expect(formatClockTime(null)).toBe('غير محدد');
  });

  it('formats free-slot durations for quick reading', () => {
    expect(formatDurationArabic(30)).toBe('٣٠ دقيقة');
    expect(formatDurationArabic(60)).toBe('ساعة');
    expect(formatDurationArabic(80)).toBe('ساعة و٢٠ دقيقة');
    expect(formatDurationArabic(120)).toBe('ساعتين');
    expect(formatDurationArabic(150)).toBe('ساعتين و٣٠ دقيقة');
    expect(formatDurationArabic(660)).toBe('١١ ساعة');
  });

  it('uses realistic tutoring defaults for one or multiple linked students', () => {
    expect(lessonTimeDefaults(1)).toEqual({ durationMinutes: 90, travelMinutes: 30, expectedStudentCount: 1 });
    expect(lessonTimeDefaults(2)).toEqual({ durationMinutes: 180, travelMinutes: 0, expectedStudentCount: 2 });
    expect(lessonTimeDefaults(3)).toEqual({ durationMinutes: 270, travelMinutes: 0, expectedStudentCount: 3 });
    expect(lessonTimeDefaults(10)).toEqual({ durationMinutes: 360, travelMinutes: 0, expectedStudentCount: 10 });
  });

  it('forces Arabic date words and numerals', () => {
    const value = formatArabicDate('2026-09-17');
    expect(value).toContain('الخميس');
    expect(value).toContain('سبتمبر');
    expect(value).toContain('١٧');
  });
});
