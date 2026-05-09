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

