export function parseMoneyToPence(value: string | number): number | null {
  const raw = String(value).trim();

  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) {
    return null;
  }

  const [whole, fraction = ''] = raw.split('.');
  const pence = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));

  if (!Number.isSafeInteger(pence)) {
    return null;
  }

  return pence;
}

export function formatPence(pence: number, currency = 'ج'): string {
  if (!Number.isSafeInteger(pence)) {
    throw new Error('Pence must be a safe integer');
  }

  return `${(pence / 100).toFixed(2)} ${currency}`;
}
