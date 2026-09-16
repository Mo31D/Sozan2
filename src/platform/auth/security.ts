export const PASSWORD_ITERATIONS = 210_000;
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

const encoder = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return toBase64Url(new Uint8Array(digest));
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left[index] ^ right[index];
  }
  return mismatch === 0;
}

export function normalizeLoginName(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('en-US');
}

export function assertPasswordPolicy(password: string): void {
  if (password.length < 10 || password.length > 200) {
    throw new Error('PASSWORD_POLICY');
  }
}

export async function createPasswordHash(password: string): Promise<{
  hash: string;
  salt: string;
  iterations: number;
}> {
  assertPasswordPolicy(password);
  const salt = randomBytes(16);
  const hash = await pbkdf2(password, salt, PASSWORD_ITERATIONS);
  return { hash: toBase64(hash), salt: toBase64(salt), iterations: PASSWORD_ITERATIONS };
}

export async function verifyPassword(
  password: string,
  expectedHash: string,
  salt: string,
  iterations: number,
): Promise<boolean> {
  if (!password || iterations < 100_000) return false;
  const actual = await pbkdf2(password, fromBase64(salt), iterations);
  return equalBytes(actual, fromBase64(expectedHash));
}

export async function createRecoveryCode(): Promise<{ code: string; hash: string }> {
  const code = `S2-${toBase64Url(randomBytes(18))}`;
  return { code, hash: await sha256(code) };
}

export async function hashRecoveryCode(code: string): Promise<string> {
  return sha256(code.trim());
}

export async function createSessionToken(): Promise<{ token: string; hash: string }> {
  const token = toBase64Url(randomBytes(32));
  return { token, hash: await sha256(token) };
}

export async function hashSessionToken(token: string): Promise<string> {
  return sha256(token);
}
