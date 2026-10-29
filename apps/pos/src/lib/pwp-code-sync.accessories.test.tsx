import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  reserve: vi.fn(), free: vi.fn(),
  rules: [{ triggerCategory: 'SOFA', triggerComboIds: ['combo'], triggerEligibleModelIds: [], type: 'pwp' }],
  reserved: [],
}));
vi.mock('./auth', () => ({ useAuth: () => ({ user: { id: 'staff' } }) }));
vi.mock('./quotes', () => ({ useQuotes: () => ({ data: undefined, isSuccess: false, isFetching: false }) }));
vi.mock('./products/pwp-queries', () => ({
  usePwpRules: () => ({ data: state.rules }),
  useMyReservedPwpCodes: () => ({ data: state.reserved }),
  useReservePwpCodes: () => ({ mutateAsync: state.reserve }),
  useFreePwpCodes: () => ({ mutateAsync: state.free }),
  validatePwpCode: vi.fn(),
}));

import { PwpCodeSync } from './pwp-code-sync';
import { useCart, type CartLine, type SofaConfigSnapshot } from '../state/cart';

const piece = (id: string) => ({ id, modelId: 'cushion', cellId: 'base', slot: 0 });
const sofa = (count: number): CartLine => ({
  key: 'sofa-key', qty: 1,
  config: {
    kind: 'sofa', productId: 'sofa-product', productName: 'Sofa', total: 1000, summary: '',
    cells: [{ id: 'base', moduleId: '2NA', x: 0, y: 0, rot: 0 }],
    accessories: Array.from({ length: count }, (_, i) => piece(`piece-${i}`)),
  } satisfies SofaConfigSnapshot,
});

beforeEach(() => {
  vi.useFakeTimers();
  state.reserve.mockReset().mockResolvedValue({ codes: [] });
  state.free.mockReset().mockResolvedValue({ ok: true });
  useCart.setState({ lines: [sofa(2)] });
});
afterEach(() => {
  cleanup();
  useCart.setState({ lines: [] });
  vi.useRealTimers();
});

it('revalidates a sofa trigger when pieces change while modules and quantity stay the same', async () => {
  render(<PwpCodeSync />);
  await act(async () => { await vi.advanceTimersByTimeAsync(650); });
  expect(state.reserve).toHaveBeenCalledWith(expect.objectContaining({
    cartLineKey: 'sofa-key', sofaModules: ['2NA'], sofaCellIds: ['base'],
    sofaAccessories: [
      { id: 'piece-0', modelId: 'cushion', cellId: 'base' },
      { id: 'piece-1', modelId: 'cushion', cellId: 'base' },
    ],
  }));
  await act(async () => { useCart.setState({ lines: [sofa(1)] }); });
  await act(async () => { await vi.advanceTimersByTimeAsync(650); });
  expect(state.reserve).toHaveBeenCalledTimes(2);
  expect(state.reserve.mock.calls[1]![0].sofaAccessories).toEqual([
    { id: 'piece-0', modelId: 'cushion', cellId: 'base' },
  ]);
  await act(async () => { useCart.setState({ lines: [sofa(1)] }); });
  await act(async () => { await vi.advanceTimersByTimeAsync(650); });
  expect(state.reserve).toHaveBeenCalledTimes(2);
});
