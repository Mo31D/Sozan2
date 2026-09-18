export function calendarDateInTimeZone(
  timeZone: string,
  now: Date = new Date(),
): string {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
  } catch {
    throw new Error('WORKSPACE_TIMEZONE_INVALID');
  }

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type === 'year' || part.type === 'month' || part.type === 'day')
      .map((part) => [part.type, part.value]),
  ) as Partial<Record<'year' | 'month' | 'day', string>>;

  if (!values.year || !values.month || !values.day) {
    throw new Error('WORKSPACE_TIMEZONE_INVALID');
  }
  return `${values.year}-${values.month}-${values.day}`;
}
