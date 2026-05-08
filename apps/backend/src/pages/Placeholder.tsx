import styles from './Dashboard.module.css';

interface PlaceholderProps {
  title: string;
  phase: string;
  hint?: string;
}

// Used for nav-mounted pages whose real implementation lands in a later phase.
// Once the page ships, swap the route element away from this.
export const Placeholder = ({ title, phase, hint }: PlaceholderProps) => (
  <div className={styles.page}>
    <header className={styles.header}>
      <h2 className="t-h2">{title}</h2>
      <p className="t-body fg-muted">Coming in {phase}.</p>
    </header>
    {hint && <p className="t-body">{hint}</p>}
  </div>
);

export const Orders = () => (
  <Placeholder
    title="Orders"
    phase="Phase 3"
    hint="6-lane board (Received → Proceed → Logistics → Ready → Dispatched → Delivered) with drawer + history audit. Ports from prototype/backend-orders.jsx + backend-drawer.jsx."
  />
);

export const VerifySlips = () => (
  <Placeholder
    title="Verify slips"
    phase="Phase 4"
    hint="Coordinator queue. Inspect uploaded payment slips, verify/flag/replace. Driver assignment + DO upload → delivery dispatched."
  />
);

export const Addons = () => (
  <Placeholder
    title="Add-ons"
    phase="Phase 1"
    hint="Manage the 6 seeded add-ons (dispose-mattress, lift, assemble, wrap, pillow-set, dispose-bedframe). Edit pricing, toggle enabled."
  />
);

export const Customers = () => (
  <Placeholder
    title="Customers"
    phase="Phase 5"
    hint="Read-only directory. Look up by phone, see order history. Sales staff cannot delete (RLS blocks)."
  />
);

export const Settings = () => (
  <Placeholder
    title="Settings"
    phase="Phase 1+"
    hint="Showrooms, staff, drivers, app_config (owner_email, pricing_version)."
  />
);
