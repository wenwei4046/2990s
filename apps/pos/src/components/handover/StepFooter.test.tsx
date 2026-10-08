import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
// Re-import here for tsc: the runtime setup (test/setup.ts) loads the
// matchers, but its type augmentation isn't in this tsconfig's program.
import '@testing-library/jest-dom/vitest';

// vitest runs with globals:false, so RTL's automatic cleanup never registers.
afterEach(cleanup);
import { StepFooter } from './StepFooter';

type Key = Parameters<typeof StepFooter>[0]['currentKey'];

const renderFooter = (currentKey: Key, orderBlocked?: boolean) => {
  const onNext = vi.fn();
  render(
    <StepFooter
      isFirst={false}
      currentKey={currentKey}
      valid
      submitting={false}
      paymentRecorded
      blockers={[]}
      attempted={false}
      onPrev={() => {}}
      onNext={onNext}
      onRecordPayment={() => {}}
      orderBlocked={orderBlocked}
    />,
  );
  return { onNext };
};

describe('StepFooter — the marketing account (orderBlocked)', () => {
  it('disables Complete order on the signature step and says why', () => {
    const { onNext } = renderFooter('sign', true);
    const btn = screen.getByRole('button', { name: /Complete order/ });
    expect(btn).toBeDisabled();
    expect(screen.getByRole('note')).toHaveTextContent('This account cannot place orders.');
    fireEvent.click(btn);
    expect(onNext).not.toHaveBeenCalled();
  });

  it('leaves every earlier step alone, so the handover can still be walked', () => {
    const { onNext } = renderFooter('confirm', true);
    const btn = screen.getByRole('button', { name: /Continue to signature/ });
    expect(btn).toBeEnabled();
    expect(screen.queryByRole('note')).toBeNull();
    fireEvent.click(btn);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('places the order as before for everyone else', () => {
    const { onNext } = renderFooter('sign');
    const btn = screen.getByRole('button', { name: /Complete order/ });
    expect(btn).toBeEnabled();
    expect(screen.queryByRole('note')).toBeNull();
    fireEvent.click(btn);
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});
