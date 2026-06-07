// Snapshot + structure tests for the Skeleton primitives.
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Skeleton, SkeletonText, SkeletonRows } from './Skeleton';

describe('Skeleton primitives', () => {
  it('Skeleton renders a single sized shimmer bar (snapshot)', () => {
    const { container } = render(<Skeleton w={120} h={12} />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it('SkeletonText renders the requested number of bars', () => {
    const { container } = render(<SkeletonText lines={4} />);
    // 4 shimmer <span> bars inside the stack.
    expect(container.querySelectorAll('span').length).toBe(4);
  });

  it('SkeletonRows renders rows × cols placeholder cells inside a tbody', () => {
    const { container } = render(
      <table><tbody><SkeletonRows cols={5} rows={3} /></tbody></table>,
    );
    expect(container.querySelectorAll('tr').length).toBe(3);
    expect(container.querySelectorAll('td').length).toBe(15);
  });
});
