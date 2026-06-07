import { describe, it, expect, vi } from 'vitest';
import { verifiedSave, computeSaveDiffs, type Fetcher } from './verified-save';

const okRes = (status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => '', json: async () => ({}) }) as unknown as Response;
const errRes = (status: number, body = 'nope') => ({ ok: false, status, text: async () => body }) as unknown as Response;

describe('computeSaveDiffs', () => {
  it('no diffs when every expected field matches', () => {
    expect(computeSaveDiffs({ a: 1, b: 'x' }, { a: 1, b: 'x' })).toEqual([]);
  });
  it('reports a diff when a field did not persist', () => {
    expect(computeSaveDiffs({ status: 'DRAFT' }, { status: 'CONFIRMED' }))
      .toEqual([{ field: 'status', expected: 'CONFIRMED', actual: 'DRAFT' }]);
  });
  it('deep-compares objects/arrays', () => {
    expect(computeSaveDiffs({ v: { a: 1 } }, { v: { a: 1 } })).toEqual([]);
    expect(computeSaveDiffs({ v: [1, 2] }, { v: [1, 3] })).toHaveLength(1);
  });
  it('treats null/undefined honestly', () => {
    expect(computeSaveDiffs({ x: null }, { x: null })).toEqual([]);
    expect(computeSaveDiffs({}, { x: 'y' })).toEqual([{ field: 'x', expected: 'y', actual: undefined }]);
  });
  it('supports a custom accessor', () => {
    const data = { jobCards: [{ pic: 'A' }] };
    const acc = (d: typeof data, f: string) => (f === 'pic1' ? d.jobCards[0]!.pic : undefined);
    expect(computeSaveDiffs(data, { pic1: 'A' }, acc)).toEqual([]);
    expect(computeSaveDiffs(data, { pic1: 'B' }, acc)).toHaveLength(1);
  });
});

describe('verifiedSave', () => {
  const base = { endpoint: '/x/1', method: 'PATCH' as const, body: { status: 'CONFIRMED' }, expect: { status: 'CONFIRMED' } };

  it('ok when write succeeds and readback matches', async () => {
    const fetcher: Fetcher = vi.fn().mockResolvedValue(okRes());
    const r = await verifiedSave({ ...base, fetcher, readback: async () => ({ status: 'CONFIRMED' }) });
    expect(r).toEqual({ ok: true, data: { status: 'CONFIRMED' } });
  });

  it('MISMATCH when server returns 200 but the value did not stick', async () => {
    const fetcher: Fetcher = vi.fn().mockResolvedValue(okRes());
    const r = await verifiedSave({ ...base, fetcher, readback: async () => ({ status: 'DRAFT' }) });
    expect(r.ok).toBe(false);
    if (!r.ok && r.reason === 'mismatch') {
      expect(r.diffs).toEqual([{ field: 'status', expected: 'CONFIRMED', actual: 'DRAFT' }]);
    } else { throw new Error('expected mismatch'); }
  });

  it('http when the server rejects', async () => {
    const fetcher: Fetcher = vi.fn().mockResolvedValue(errRes(409, 'locked'));
    const r = await verifiedSave({ ...base, fetcher, readback: async () => ({ status: 'CONFIRMED' }) });
    expect(r).toEqual({ ok: false, reason: 'http', status: 409, body: 'locked' });
  });

  it('network when the mutation throws', async () => {
    const fetcher: Fetcher = vi.fn().mockRejectedValue(new Error('offline'));
    const r = await verifiedSave({ ...base, fetcher, readback: async () => ({ status: 'CONFIRMED' }) });
    expect(r).toMatchObject({ ok: false, reason: 'network' });
  });

  it('network when readback returns null (save state unknown)', async () => {
    const fetcher: Fetcher = vi.fn().mockResolvedValue(okRes());
    const r = await verifiedSave({ ...base, fetcher, readback: async () => null });
    expect(r).toMatchObject({ ok: false, reason: 'network' });
  });

  it('does NOT read back when the mutation already failed', async () => {
    const fetcher: Fetcher = vi.fn().mockResolvedValue(errRes(500));
    const readback = vi.fn();
    await verifiedSave({ ...base, fetcher, readback });
    expect(readback).not.toHaveBeenCalled();
  });
});
