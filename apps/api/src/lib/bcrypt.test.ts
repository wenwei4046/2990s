import { describe, it, expect } from 'vitest';
import { hashPin, verifyPin } from './bcrypt';

describe('bcrypt wrapper', () => {
  it('hashes a 6-digit PIN to a non-empty string distinct from the plaintext', async () => {
    const hash = await hashPin('482917');
    expect(hash).toBeTypeOf('string');
    expect(hash.length).toBeGreaterThan(20);
    expect(hash).not.toBe('482917');
  });

  it('verifyPin returns true for the matching PIN', async () => {
    const hash = await hashPin('482917');
    await expect(verifyPin('482917', hash)).resolves.toBe(true);
  });

  it('verifyPin returns false for a wrong PIN', async () => {
    const hash = await hashPin('482917');
    await expect(verifyPin('123456', hash)).resolves.toBe(false);
  });
});
