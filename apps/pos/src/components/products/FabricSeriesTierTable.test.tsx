import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { FabricLibraryRow } from '../../lib/queries';

const hooks = vi.hoisted(() => ({
  library: vi.fn(), colours: vi.fn(), names: vi.fn(), update: vi.fn(), mutate: vi.fn(),
}));
vi.mock('../../lib/queries', () => ({
  useFabricLibrary: hooks.library,
  useFabricColours: hooks.colours,
  useUpdateFabricLibraryTier: hooks.update,
}));
vi.mock('../../lib/fabric-series-queries', () => ({ useFabricSeriesNames: hooks.names }));

import { FabricSeriesTierTable } from './FabricSeriesTierTable';

const fabric = (id: string, patch: Partial<FabricLibraryRow> = {}): FabricLibraryRow => ({
  id, label: id, tier: 'standard', defaultSurcharge: 0, active: true, sortOrder: 0,
  sofaTier: 'PRICE_1', bedframeTier: 'PRICE_1', ...patch,
});
const colour = (fabricId: string, colourId = fabricId) => ({ fabricId, colourId, label: colourId });
const loaded = <T,>(data: T) => ({ data, isLoading: false, error: null });

beforeEach(() => {
  vi.clearAllMocks();
  hooks.library.mockReturnValue(loaded([]));
  hooks.colours.mockReturnValue(loaded([]));
  hooks.names.mockReturnValue(loaded([]));
  hooks.update.mockReturnValue({ mutate: hooks.mutate, isPending: false, isError: false, error: null });
});
afterEach(cleanup);

describe('FabricSeriesTierTable', () => {
  it('shows one MONZA and KN row and uses the saved HOMELY series name', () => {
    const ids = ['MONZA-HL', 'MONZA-HL-3588', 'MONZA-HL-B01', 'MONZA-FL', 'KN03', 'KN06', 'BROWNIE'];
    hooks.library.mockReturnValue(loaded(ids.map((id) => fabric(id))));
    hooks.colours.mockReturnValue(loaded([
      ...ids.slice(0, -1).map((id) => colour(id)), colour('BROWNIE', 'BROWNIE-01'), colour('BROWNIE', 'BROWNIE-02'),
    ]));
    hooks.names.mockReturnValue(loaded([
      { fabric_code: 'BROWNIE-01', series: 'HOMELY' }, { fabric_code: 'BROWNIE-02', series: 'HOMELY' },
    ]));
    render(<FabricSeriesTierTable canEdit />);

    expect(screen.getAllByRole('row')).toHaveLength(4);
    expect(screen.getByRole('cell', { name: 'MONZA' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'KN' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'HOMELY' })).toBeInTheDocument();
    expect(screen.queryByRole('cell', { name: 'BROWNIE' })).not.toBeInTheDocument();
    expect(hooks.mutate).not.toHaveBeenCalled();
  });

  it('keeps mixed tiers until an explicit click and updates all canonical IDs for only that context', () => {
    hooks.library.mockReturnValue(loaded([
      fabric('MONZA-HL', { sofaTier: 'PRICE_1', bedframeTier: 'PRICE_2' }),
      fabric('MONZA-FL', { sofaTier: 'PRICE_3', bedframeTier: 'PRICE_2' }),
    ]));
    hooks.colours.mockReturnValue(loaded([colour('MONZA-HL'), colour('MONZA-FL')]));
    render(<FabricSeriesTierTable canEdit />);

    const sofa = screen.getByRole('button', { name: 'MONZA sofa tier: Mixed' });
    expect(sofa).toHaveTextContent('Mixed');
    expect(hooks.mutate).not.toHaveBeenCalled();
    fireEvent.click(sofa);
    expect(hooks.mutate).toHaveBeenLastCalledWith({ ids: ['MONZA-HL', 'MONZA-FL'], field: 'sofaTier', tier: 'PRICE_1' });
    fireEvent.click(screen.getByRole('button', { name: 'MONZA bedframe tier: Price 2' }));
    expect(hooks.mutate).toHaveBeenLastCalledWith({ ids: ['MONZA-HL', 'MONZA-FL'], field: 'bedframeTier', tier: 'PRICE_3' });
  });

  it('uses one shared pricing control when a canonical ID spans saved series', () => {
    hooks.library.mockReturnValue(loaded([fabric('BROWNIE')]));
    hooks.colours.mockReturnValue(loaded([colour('BROWNIE', 'BROWNIE-01'), colour('BROWNIE', 'BROWNIE-02')]));
    hooks.names.mockReturnValue(loaded([
      { fabric_code: 'BROWNIE-01', series: 'HOMELY' }, { fabric_code: 'BROWNIE-02', series: 'OTHER' },
    ]));
    render(<FabricSeriesTierTable canEdit />);

    expect(screen.getAllByRole('row')).toHaveLength(2);
    const row = screen.getByText('Shared tier').closest('tr')!;
    expect(row).toHaveTextContent('HOMELY / OTHER');
    expect(within(row).getAllByRole('button')).toHaveLength(2);
    fireEvent.click(within(row).getByRole('button', { name: /sofa tier/ }));
    expect(hooks.mutate).toHaveBeenCalledWith({ ids: ['BROWNIE'], field: 'sofaTier', tier: 'PRICE_2' });
  });

  it('refreshes the displayed group after a saved series changes', () => {
    hooks.library.mockReturnValue(loaded([fabric('BROWNIE')]));
    hooks.colours.mockReturnValue(loaded([colour('BROWNIE', 'BROWNIE-01')]));
    const view = render(<FabricSeriesTierTable canEdit />);
    expect(screen.getByRole('cell', { name: 'BROWNIE' })).toBeInTheDocument();
    hooks.names.mockReturnValue(loaded([{ fabric_code: 'BROWNIE-01', series: 'HOMELY' }]));
    view.rerender(<FabricSeriesTierTable canEdit />);
    expect(screen.getByRole('cell', { name: 'HOMELY' })).toBeInTheDocument();
    expect(screen.queryByRole('cell', { name: 'BROWNIE' })).not.toBeInTheDocument();
  });

  it('prevents tier edits in read-only mode and while a group save is pending', () => {
    hooks.library.mockReturnValue(loaded([fabric('KN03')]));
    const view = render(<FabricSeriesTierTable canEdit={false} />);
    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(hooks.mutate).not.toHaveBeenCalled();
    hooks.update.mockReturnValue({ mutate: hooks.mutate, isPending: true, isError: false, error: null });
    view.rerender(<FabricSeriesTierTable canEdit />);
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
  });

  it('waits for saved names and exposes a failed metadata read without guessed tier controls', () => {
    hooks.library.mockReturnValue(loaded([fabric('BROWNIE')]));
    hooks.names.mockReturnValue({ data: undefined, isLoading: true, error: null });
    const view = render(<FabricSeriesTierTable canEdit />);
    expect(screen.getByText('Loading fabrics…')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    hooks.names.mockReturnValue({ data: undefined, isLoading: false, error: new Error('Series unavailable') });
    view.rerender(<FabricSeriesTierTable canEdit />);
    expect(screen.getByRole('alert')).toHaveTextContent('Series unavailable');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
