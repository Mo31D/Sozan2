import { describe, expect, it } from 'vitest';
import {
  PASSWORD_ITERATIONS,
  createPasswordHash,
  verifyPassword,
} from '../src/platform/auth/security';

describe('auth security', () => {
  it('uses the Cloudflare Workers PBKDF2 iteration ceiling', () => {
    expect(PASSWORD_ITERATIONS).toBe(100_000);
  });

  it('hashes and verifies a password with the supported iteration count', async () => {
    const password = 'strong-password-123';
    const record = await createPasswordHash(password);

    expect(record.iterations).toBe(100_000);
    await expect(
      verifyPassword(password, record.hash, record.salt, record.iterations),
    ).resolves.toBe(true);
    await expect(
      verifyPassword('wrong-password-123', record.hash, record.salt, record.iterations),
    ).resolves.toBe(false);
  });

  it('refuses an unsupported stored iteration count before calling WebCrypto', async () => {
    await expect(
      verifyPassword('strong-password-123', 'ignored', 'ignored', 210_000),
    ).resolves.toBe(false);
  });
});
