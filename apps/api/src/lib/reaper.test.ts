import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reapOnce } from './reaper';
import type { SlipEnv } from './slip';

function makeEnv(deleteImpl?: any): SlipEnv {
  return {
    SLIPS: { delete: deleteImpl ?? vi.fn().mockResolvedValue(undefined) } as any,
    R2_ACCESS_KEY_ID: 'k',
    R2_SECRET_ACCESS_KEY: 's',
    R2_ENDPOINT: 'https://e',
    R2_BUCKET_NAME: 'b',
  };
}

describe('reapOnce', () => {
  let supabase: any;
  let updateEqMock: any;

  beforeEach(() => {
    updateEqMock = vi.fn().mockResolvedValue({ data: null, error: null });
    supabase = {
      rpc: vi.fn(),
      from: vi.fn().mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: updateEqMock,
        }),
      }),
    };
  });

  it('returns zero counts when no orphans found', async () => {
    supabase.rpc = vi.fn()
      .mockResolvedValueOnce({ data: [], error: null })       // lease_orphan_slips
      .mockResolvedValueOnce({ data: 0, error: null });        // count_orphan_slips

    const env = makeEnv();
    const result = await reapOnce(supabase, env, 'worker-1');
    expect(result).toEqual({ claimed: 0, deleted: 0, errors: 0, remaining: 0 });
  });

  it('claims rows then deletes R2 + updates status', async () => {
    supabase.rpc = vi.fn()
      .mockResolvedValueOnce({
        data: [
          { id: 'a', r2_key: 'slips/2026/05/a.jpg' },
          { id: 'b', r2_key: 'slips/2026/05/b.png' },
        ],
        error: null,
      })
      .mockResolvedValueOnce({ data: 0, error: null });

    const env = makeEnv();
    const result = await reapOnce(supabase, env, 'worker-1');
    expect(result.claimed).toBe(2);
    expect(result.deleted).toBe(2);
    expect(result.errors).toBe(0);
    expect(env.SLIPS.delete).toHaveBeenCalledTimes(2);
    expect(env.SLIPS.delete).toHaveBeenCalledWith('slips/2026/05/a.jpg');
    expect(env.SLIPS.delete).toHaveBeenCalledWith('slips/2026/05/b.png');
  });

  it('counts errors when R2 delete fails', async () => {
    supabase.rpc = vi.fn()
      .mockResolvedValueOnce({
        data: [{ id: 'a', r2_key: 'slips/2026/05/a.jpg' }],
        error: null,
      })
      .mockResolvedValueOnce({ data: 0, error: null });

    const env = makeEnv(vi.fn().mockRejectedValue(new Error('R2 down')));
    const result = await reapOnce(supabase, env, 'worker-1');
    expect(result.claimed).toBe(1);
    expect(result.deleted).toBe(0);
    expect(result.errors).toBe(1);
  });

  it('counts errors when DB status update fails', async () => {
    updateEqMock.mockResolvedValue({ data: null, error: { message: 'db down' } });
    supabase.rpc = vi.fn()
      .mockResolvedValueOnce({
        data: [{ id: 'a', r2_key: 'slips/2026/05/a.jpg' }],
        error: null,
      })
      .mockResolvedValueOnce({ data: 0, error: null });

    const env = makeEnv();
    const result = await reapOnce(supabase, env, 'worker-1');
    expect(result.claimed).toBe(1);
    expect(result.deleted).toBe(0);
    expect(result.errors).toBe(1);
  });

  it('returns errors=1 when claim RPC itself fails', async () => {
    supabase.rpc = vi.fn().mockResolvedValueOnce({ data: null, error: { message: 'rpc broke' } });
    const env = makeEnv();
    const result = await reapOnce(supabase, env, 'worker-1');
    expect(result).toEqual({ claimed: 0, deleted: 0, errors: 1, remaining: 0 });
  });
});
