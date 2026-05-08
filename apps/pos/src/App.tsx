import { Plus, Settings } from 'lucide-react';
import { Button, IconButton, PriceTag } from '@2990s/design-system';
import { fmtRM } from '@2990s/shared/format';
import styles from './App.module.css';

// Phase 0 sanity-check screen. Verifies:
//   * tokens.css loaded (warm cream bg, ink text)
//   * design-system primitives import + render
//   * shared/format works
//   * Lucide icons load with stroke 1.75
// Real catalog screen ports from prototype/pos-catalog.jsx in Phase 1.
export const App = () => (
  <main className={styles.app}>
    <header className={styles.header}>
      <span className="t-eyebrow">POS · Showroom KL</span>
      <IconButton icon={<Settings />} aria-label="Settings" />
    </header>

    <h1 className="t-h1">Welcome to 2990's POS</h1>
    <p className="t-lede">Phase 0 scaffold — design system + tokens working.</p>

    <div className={styles.priceRow}>
      <PriceTag amount={2990} size="hero" />
      <span className={styles.priceCaption}>{fmtRM(990)} per recliner upgrade</span>
    </div>

    <div className={styles.buttons}>
      <Button>Place an order</Button>
      <Button variant="secondary">Browse catalog</Button>
      <Button variant="ghost">
        <Plus size={16} strokeWidth={1.75} />
        New quote
      </Button>
    </div>
  </main>
);
