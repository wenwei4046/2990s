import { Profiler } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cell } from '@2990s/shared';
import type { ArtBbox } from '../lib/sofa-art';

const art = vi.hoisted(() => ({
  cache: new Map<string, { l: number; t: number; r: number; b: number }>(),
  measure: vi.fn<(src: string) => Promise<{ l: number; t: number; r: number; b: number }>>(),
}));

vi.mock('../lib/sofa-art', () => ({
  ART_BBOX_FALLBACK: { l: 0.1, t: 0.2, r: 0.9, b: 0.8 },
  getCachedArtBbox: (src: string) => art.cache.get(src),
  measureArtBbox: (src: string) => art.measure(src),
}));

import { SofaCellsPreview } from './SofaCellsPreview';

const SRC = '/sofa-modules/1A(LHF).png';
const cells = (): Cell[] => [{ id: 'seat', moduleId: '1A(LHF)', x: 0, y: 0, rot: 0 }];
const BOUNDS: ArtBbox = { l: 0.25, t: 0.25, r: 0.75, b: 0.75 };

beforeEach(() => {
  art.cache.clear();
  art.measure.mockReset();
});
afterEach(cleanup);

describe('SofaCellsPreview image geometry', () => {
  it('does not repaint cached previews after each parent update', async () => {
    art.cache.set(SRC, BOUNDS);
    const commits = vi.fn();
    const view = () => (
      <Profiler id="preview" onRender={commits}>
        <SofaCellsPreview cells={cells()} depth="24" />
      </Profiler>
    );
    const { rerender } = render(view());
    await act(async () => {});
    expect(commits).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('img').style.width).toBe('200%');

    rerender(view()); // Same layout, new array (as Quick Pick supplies it).
    await act(async () => {});
    expect(commits).toHaveBeenCalledTimes(2);
    expect(art.measure).not.toHaveBeenCalled();
  });

  it('still applies a pending measurement after the parent replaces its cells array', async () => {
    let finish!: (bounds: ArtBbox) => void;
    const pending = new Promise<ArtBbox>((resolve) => { finish = resolve; });
    // measureArtBbox shares one in-flight promise for this image.
    art.measure.mockReturnValue(pending);
    const { rerender } = render(<SofaCellsPreview cells={cells()} depth="24" />);
    expect(screen.getByRole('img').style.width).toBe('125%');

    rerender(<SofaCellsPreview cells={cells()} depth="24" />);
    await act(async () => {
      art.cache.set(SRC, BOUNDS);
      finish(BOUNDS);
      await pending;
    });
    expect(screen.getByRole('img').style.width).toBe('200%');
    expect(screen.getByRole('img').style.left).toBe('-50%');
  });
});
