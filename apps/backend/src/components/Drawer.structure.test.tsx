// Contract tests for the shared <Drawer> (UI-KIT §1.5).
//
// These lock the ONE thing the card makes non-negotiable: a module cannot
// choose its own region order, and the content region is the only scroller.
// The assertions read `data-drawer-region` rather than CSS-module class names
// so they hold whether or not vitest processes the stylesheet.
//
// The component lives in packages/design-system (per CLAUDE.md, design
// primitives belong there); the test lives here because the backend app is the
// workspace that has vitest + Testing Library wired up, and every consumer of
// the drawer is in this app.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Drawer } from '@2990s/design-system';

const regionsOf = (): string[] =>
  Array.from(document.querySelectorAll('[data-drawer-region]')).map(
    (el) => el.getAttribute('data-drawer-region') ?? '',
  );

describe('Drawer — region order', () => {
  it('renders header → identity → current action → content → footer', () => {
    render(
      <Drawer
        title='SO-2990'
        subtitle='Tan Mei Ling'
        onClose={() => {}}
        identity={<span>identity block</span>}
        currentAction={<span>current action block</span>}
        footer={<button type='button'>Confirm</button>}
      >
        <p>scrollable content</p>
      </Drawer>,
    );

    expect(regionsOf()).toEqual([
      'header',
      'identity',
      'current-action',
      'content',
      'footer',
    ]);
  });

  it('keeps that order no matter which order the slots are passed in', () => {
    render(
      <Drawer
        footer={<button type='button'>Confirm</button>}
        currentAction={<span>current action block</span>}
        identity={<span>identity block</span>}
        onClose={() => {}}
        title='SO-2990'
      >
        <p>scrollable content</p>
      </Drawer>,
    );

    expect(regionsOf()).toEqual([
      'header',
      'identity',
      'current-action',
      'content',
      'footer',
    ]);
  });

  it('renders nothing at all for an omitted slot — no empty strip, no "None"', () => {
    render(
      <Drawer title="New Warehouse" onClose={() => {}}>
        <p>form fields</p>
      </Drawer>,
    );

    expect(regionsOf()).toEqual(['header', 'content']);
    expect(
      document.querySelector('[data-drawer-region="identity"]'),
    ).toBeNull();
    expect(
      document.querySelector('[data-drawer-region="current-action"]'),
    ).toBeNull();
    expect(document.querySelector('[data-drawer-region="footer"]')).toBeNull();
  });
});

describe('Drawer — sticky contract', () => {
  it('puts the chrome regions OUTSIDE the scrolling content region', () => {
    render(
      <Drawer
        title='SO-2990'
        onClose={() => {}}
        identity={<span>identity block</span>}
        currentAction={<span>current action block</span>}
        footer={<button type='button'>Confirm</button>}
      >
        <p>scrollable content</p>
      </Drawer>,
    );

    const content = document.querySelector('[data-drawer-region="content"]')!;
    for (const region of ['header', 'identity', 'current-action', 'footer']) {
      const el = document.querySelector(`[data-drawer-region="${region}"]`)!;
      expect(content.contains(el)).toBe(false);
    }
  });

  it('makes every chrome region a direct child of the panel, so flex pins them', () => {
    render(
      <Drawer
        title='SO-2990'
        onClose={() => {}}
        identity={<span>identity block</span>}
        currentAction={<span>current action block</span>}
        footer={<button type='button'>Confirm</button>}
      >
        <p>scrollable content</p>
      </Drawer>,
    );

    const panel = screen.getByRole('dialog');
    for (const region of [
      'header',
      'identity',
      'current-action',
      'content',
      'footer',
    ]) {
      const el = document.querySelector(`[data-drawer-region="${region}"]`)!;
      expect(el.parentElement).toBe(panel);
    }
  });

  it('locks the page behind the drawer while it is open, and restores on close', () => {
    const { unmount } = render(
      <Drawer title='SO-2990' onClose={() => {}}>
        <p>content</p>
      </Drawer>,
    );
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });
});

describe('Drawer — header + dismissal', () => {
  it('shows the order number, the customer name and a close button', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Drawer title='SO-2990' subtitle='Tan Mei Ling' onClose={onClose}>
        <p>content</p>
      </Drawer>,
    );

    expect(
      screen.getByRole('heading', { name: 'SO-2990' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Tan Mei Ling')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('names the dialog by its title for screen readers', () => {
    render(
      <Drawer title='SO-2990' onClose={() => {}}>
        <p>content</p>
      </Drawer>,
    );
    expect(screen.getByRole('dialog', { name: 'SO-2990' })).toBeInTheDocument();
  });

  it('closes on scrim click and on Escape', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Drawer title='SO-2990' onClose={onClose}>
        <p>content</p>
      </Drawer>,
    );

    await user.click(document.querySelector('[data-drawer-scrim]')!);
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('does not close on scrim click or Escape while dismissible is false', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Drawer title='SO-2990' onClose={onClose} dismissible={false}>
        <p>content</p>
      </Drawer>,
    );

    await user.click(document.querySelector('[data-drawer-scrim]')!);
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();

    // The explicit close button always works — a saving drawer must still be
    // escapable deliberately.
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when the click lands inside the panel', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Drawer title='SO-2990' onClose={onClose}>
        <p>content</p>
      </Drawer>,
    );

    await user.click(screen.getByText('content'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
