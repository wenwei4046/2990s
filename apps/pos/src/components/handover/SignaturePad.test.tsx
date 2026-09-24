import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SignaturePad, type SignaturePadHandle } from './SignaturePad';

const ctx = { clearRect: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn() };
beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.stubGlobal('PointerEvent', MouseEvent);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,signature');
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 320, height: 160 } as DOMRect);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('phone signature bitmap', () => {
  it('maps phone touches to the taller bitmap and clears acknowledgement with the ink', () => {
    const handle = createRef<SignaturePadHandle>();
    const changed = vi.fn();
    render(<SignaturePad ref={handle} onChange={changed} />);
    const canvas = screen.getByLabelText('Customer signature pad');
    expect(canvas).toHaveAttribute('width', '800');
    expect(canvas).toHaveAttribute('height', '400');
    expect(handle.current?.getDataUrl()).toBeNull();
    fireEvent.pointerDown(canvas, { clientX: 160, clientY: 80, buttons: 1 });
    expect(ctx.arc).toHaveBeenCalledWith(400, 200, 1.1, 0, Math.PI * 2);
    expect(changed).toHaveBeenLastCalledWith(true);
    expect(handle.current?.getDataUrl()).toBe('data:image/png;base64,signature');
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(changed).toHaveBeenLastCalledWith(false);
    expect(handle.current?.getDataUrl()).toBeNull();
  });

  it('does not reset a signed bitmap when the viewport changes', () => {
    const changed = vi.fn();
    const { rerender } = render(<SignaturePad onChange={changed} />);
    const canvas = screen.getByLabelText('Customer signature pad');
    fireEvent.pointerDown(canvas, { clientX: 160, clientY: 80, buttons: 1 });
    ctx.clearRect.mockClear();
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    rerender(<SignaturePad onChange={changed} />);
    expect(canvas).toHaveAttribute('height', '400');
    expect(ctx.clearRect).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeEnabled();
  });
});
