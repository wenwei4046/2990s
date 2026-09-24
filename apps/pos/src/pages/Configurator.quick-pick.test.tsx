import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { BUNDLES } from '@2990s/shared';

// The view needs no backend; prevent API clients from initializing real sessions.
vi.mock('../lib/supabase', () => ({ supabase: {} }));
import { SofaQuickPick } from './Configurator';

afterEach(cleanup);

describe('Quick Pick card actions', () => {
  it('keeps saved layout selection, edit, mirror and remove as independent native buttons', () => {
    const item = { id: 'test-pick', source: 'personal' as const, label: 'Test layout', modules: [['1A(LHF)'], ['2A(RHF)']], depth: '24' };
    const select = vi.fn();
    const edit = vi.fn();
    const remove = vi.fn();
    const mirror = vi.fn();
    const { container } = render(
      <SofaQuickPick
        isLoading={false} rows={[]} picked={null} onPick={vi.fn()}
        quickFlip="R" onFlipChange={vi.fn()} depth="24" maxDepth="28"
        personalQuickPicks={[item]} pickedQuickPickId={item.id}
        onQuickPickSelect={select} onQuickPickEdit={edit}
        onQuickPickDelete={remove} onToggleQpMirror={mirror}
        priceForLayout={() => 2990}
      />,
    );
    expect(container.querySelector('button button')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Select Test layout' }));
    expect(select).toHaveBeenCalledExactlyOnceWith(item);
    fireEvent.click(screen.getByRole('button', { name: /Edit in Customize/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Mirror left to right' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Quick Pick' }));
    expect(edit).toHaveBeenCalledExactlyOnceWith(item);
    expect(remove).toHaveBeenCalledExactlyOnceWith(item);
    expect(mirror).toHaveBeenCalledOnce();
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('changes chaise orientation without selecting the preset again', () => {
    const bundle = BUNDLES.find((row) => row.id === '2+L')!;
    const select = vi.fn();
    const flip = vi.fn();
    const { container } = render(
      <SofaQuickPick
        isLoading={false} rows={[{ bundle, price: 2990, active: true }]}
        picked={bundle.id} onPick={select} quickFlip="R" onFlipChange={flip}
        depth="24" maxDepth="28"
      />,
    );
    expect(container.querySelector('button button')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'L' }));
    expect(flip).toHaveBeenCalledExactlyOnceWith('L');
    expect(select).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Select ' + bundle.label }));
    expect(select).toHaveBeenCalledExactlyOnceWith(bundle.id);
  });
});
