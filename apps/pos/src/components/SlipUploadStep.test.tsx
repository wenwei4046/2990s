import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const upload = vi.fn();
vi.mock('../lib/slip', () => ({ uploadSlipFull: (...args: unknown[]) => upload(...args) }));
import { SlipUploadStep } from './SlipUploadStep';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('payment proof replacement', () => {
  it('clears the native picker so the same proof can be attached again after replacement', async () => {
    upload.mockResolvedValue({ uploadSessionId: 'local-proof' });
    const confirmed = vi.fn();
    const cleared = vi.fn();
    render(<SlipUploadStep onConfirmed={confirmed} onCleared={cleared} />);
    const picker = screen.getByLabelText('Attach payment proof');
    const proof = new File(['proof'], 'receipt.pdf', { type: 'application/pdf' });
    // Native file inputs retain this value after an upload. Clearing it is what
    // makes selecting the identical file dispatch change on iPhone/Android.
    Object.defineProperty(picker, 'value', { configurable: true, writable: true, value: 'C:\\fakepath\\receipt.pdf' });
    fireEvent.change(picker, { target: { files: [proof] } });
    await waitFor(() => expect(confirmed).toHaveBeenCalledWith('local-proof'));
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
    expect(picker).toHaveValue('');
    expect(cleared).toHaveBeenCalledOnce();
    fireEvent.change(picker, { target: { files: [proof] } });
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
  });

  it('shows an unsupported proof error without starting an upload', () => {
    render(<SlipUploadStep onConfirmed={vi.fn()} onCleared={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Attach payment proof'), {
      target: { files: [new File(['text'], 'receipt.txt', { type: 'text/plain' })] },
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Only JPG / PNG / WebP / PDF supported.');
    expect(upload).not.toHaveBeenCalled();
  });
});
