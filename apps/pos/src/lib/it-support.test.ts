import { describe, expect, it, vi } from 'vitest';
vi.mock('./apiClient', () => ({ authedFetchRaw: vi.fn(), houzsApiRoot: () => undefined, IS_HOUZS: true }));
import { itAddFiles, itStatusText, IT_MAX_FILES } from './it-support';

const f = (name: string, type: string, size = 10) => new File([new Uint8Array(size)], name, { type });

describe('it-support', () => {
  it('accepts pictures, pdf and zip', () => {
    const r = itAddFiles([], [f('a.png', 'image/png'), f('b.pdf', 'application/pdf'), f('c.zip', '')]);
    expect('files' in r && r.files.length).toBe(3);
  });
  it('refuses other types, big files and a sixth file', () => {
    expect(itAddFiles([], [f('a.exe', 'application/x-msdownload')])).toHaveProperty('refused');
    expect(itAddFiles([], [f('a.png', 'image/png', 10 * 1024 * 1024 + 1)])).toHaveProperty('refused');
    const five = Array.from({ length: IT_MAX_FILES }, (_, i) => f(`${i}.png`, 'image/png'));
    expect(itAddFiles(five, [f('x.png', 'image/png')])).toHaveProperty('refused');
  });
  it('shows an unknown hub state as spelled', () => {
    expect(itStatusText('resolved')).toBe('Done, please confirm');
    expect(itStatusText('brand_new')).toBe('brand_new');
  });
});
