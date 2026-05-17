import styles from './Hero.module.css';

const FALLBACK_HERO = '/imagery/bedroom-warm.jpg';

export const Hero = ({
  imageKey, firstName, orderId, eta, email,
}: {
  imageKey: string | null;
  firstName: string;
  orderId: string;
  eta: string;
  email: string | null;
}) => {
  // TODO Task 18: wire VITE_R2_PUBLIC_URL so per-category hero images from the
  // category-heroes/ bucket override the static fallback. For now we ignore
  // imageKey entirely until the public R2 binding lands.
  void imageKey;
  const src = FALLBACK_HERO;

  return (
    <section className={styles.hero} style={{ backgroundImage: `url(${src})` }}>
      <div className={styles.tint} />
      <div className={styles.content}>
        <div className={styles.checkBubble} aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <span className={styles.eyebrow}>ORDER CONFIRMED · {orderId}</span>
        <h1 className={styles.title}>
          Welcome <span className={styles.italic}>home</span>, {firstName}.
        </h1>
        <p className={styles.body}>
          Your order will arrive on <strong>{eta}</strong>.
          {email ? <> A copy of the receipt has been sent to <strong>{email}</strong>.</> : null}
        </p>
      </div>
    </section>
  );
};
