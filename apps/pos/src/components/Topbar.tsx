import { useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, Bookmark, KeyRound, LifeBuoy, ListOrdered, LogOut, ShoppingBag, Menu } from 'lucide-react';
import { fmtRM } from '@2990s/shared';
import { useAuth } from '../lib/auth';
import { useStaff } from '../lib/staff';
import { useCanChangePin, useMarketingAccess } from '../lib/houzs-perms';
import { useCart, cartItemCount, cartSubtotal } from '../state/cart';
import { HouzsSsoMenu } from './HouzsSsoMenu';
import { IS_HOUZS } from '../lib/apiClient';
import { IS_SIMULATION } from '../lib/simulation-mode';
import { usesAndroidSofaLayout } from '../lib/android-sofa-layout';
import styles from './Topbar.module.css';

export type StepId = 'cart' | 'customer' | 'confirm';

const STEPS: { id: StepId; label: string }[] = [
  { id: 'cart', label: 'Cart' },
  { id: 'customer', label: 'Customer' },
  { id: 'confirm', label: 'Confirmed' },
];

interface TopbarProps {
  /** Product details/actions get their own row on Android tablets. */
  productConfigurator?: boolean;
  /** Android sofa controls need their own density rules; keep Apple unchanged. */
  sofaConfigurator?: boolean;
  mobileActionsInPage?: boolean;
  mobileCenterInPage?: boolean;
  /** Give the center content its own full-width row below the phone navigation. */
  centerBelowOnMobile?: boolean;
  /** Page-specific actions/filters shown inside the phone Sales menu. */
  mobileMenuSlot?: ReactNode;
  step?: StepId;
  /**
   * When provided, replaces the default Quotes / My orders / Cart pills
   * (used by Configurator to inject product info + LIVE TOTAL + Cancel +
   * Add to Cart). Avatar + logout still render after the slot.
   */
  rightSlot?: ReactNode;
  /**
   * When provided, replaces the CART / CUSTOMER / CONFIRMED step pills in
   * the topbar's center area. Used by Configurator to inject back arrow,
   * depth toggle, and mode tabs — step pills don't make sense while staff
   * is mid-build of a single SKU.
   */
  centerSlot?: ReactNode;
  /** When set, render a chevron-left "Back" pill in the left section linking here. */
  backTo?: string;
  /** Label for the back pill; defaults to "Back". */
  backLabel?: string;
}

export function Topbar({ step, rightSlot, centerSlot, backTo, backLabel, mobileActionsInPage, mobileCenterInPage, mobileMenuSlot, centerBelowOnMobile, sofaConfigurator, productConfigurator }: TopbarProps) {
  const { user, signOut } = useAuth();
  const { data: staff } = useStaff();
  const canChangePin = useCanChangePin();
  // The marketing account derives the plain `sales` POS role from Houzs; show
  // it as what it is (owner 2026-10-08).
  const { isMarketing } = useMarketingAccess();
  const lines = useCart((s) => s.lines);
  const count = cartItemCount(lines);
  const subtotal = cartSubtotal(lines);

  // Display name fallbacks: staff → email local part → "Staff".
  const initials = staff?.initials ?? user?.email?.slice(0, 2).toUpperCase() ?? '··';
  const name = staff?.name ?? user?.email?.split('@')[0] ?? 'Staff';
  const role = isMarketing ? 'marketing' : staff?.role ?? 'Staff';
  const avatarColor = staff?.color ?? '#A6471E';
  const androidProduct = (sofaConfigurator || productConfigurator) && usesAndroidSofaLayout(navigator.userAgent, IS_SIMULATION, window.location.search, navigator.maxTouchPoints);
  const androidSofa = sofaConfigurator && androidProduct;
  const headerRef = useRef<HTMLElement>(null);

  // Android actions may occupy another row. Keep fixed configurator notices
  // below the actual sticky header, including the local simulation banner.
  useEffect(() => {
    const header = headerRef.current;
    if (!androidProduct || !header) return;
    const root = document.documentElement;
    const banner = header.previousElementSibling?.classList.contains(styles.simulationBanner!) ? header.previousElementSibling : null;
    const measure = () => {
      const bounds = header.getBoundingClientRect();
      root.style.setProperty('--android-sofa-topbar-bottom', `${bounds.bottom}px`);
      root.style.setProperty('--android-sofa-chrome-height', `${Math.ceil(bounds.height + (banner?.getBoundingClientRect().height ?? 0))}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    if (banner) observer.observe(banner);
    window.addEventListener('scroll', measure, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', measure);
      root.style.removeProperty('--android-sofa-topbar-bottom');
      root.style.removeProperty('--android-sofa-chrome-height');
    };
  }, [androidProduct]);

  return (
    <>
    {IS_SIMULATION && <div className={styles.simulationBanner}>Local simulation · No live orders or payments</div>}
    <header ref={headerRef} data-android-configurator={androidProduct ? '' : undefined} data-android-sofa={androidSofa ? '' : undefined} className={`${styles.topbar} ${centerBelowOnMobile ? styles.centerBelowOnMobile : ''}`}>
      <div className={styles.left}>
        {backTo && (
          <Link to={backTo} className={styles.iconBtn} aria-label={backLabel ?? 'Back'}>
            <ArrowLeft size={20} strokeWidth={1.75} />
          </Link>
        )}
        <Link to="/catalog" className={styles.wordmark} aria-label="2990's POS home">
          2990
          <span className={styles.wordmarkRing}>S</span>
        </Link>
        <span className={styles.crumb}>POS · Showroom KL</span>
      </div>

      <div className={`${styles.center} ${mobileCenterInPage ? styles.mobileHidden : ''}`}>
        {centerSlot ?? STEPS.map((s, i) => (
          <span
            key={s.id}
            className={`${styles.step} ${step === s.id ? styles.stepActive : ''}`}
          >
            <span className={styles.stepIdx}>0{i + 1}</span>
            {s.label}
          </span>
        ))}
      </div>

      <div className={`${styles.right} ${mobileActionsInPage ? styles.mobileHidden : ''}`}>
        <div className={styles.actionSlot}>
        {rightSlot ?? (
          <>
            <Link to="/quotes" className={styles.pill} aria-label="Saved quotes">
              <Bookmark size={13} strokeWidth={1.75} />
              <span>Quotes</span>
            </Link>
            <Link to="/my-orders" className={styles.pill} aria-label="My orders">
              <ListOrdered size={13} strokeWidth={1.75} />
              <span>My orders</span>
            </Link>
            {/* Houzs SSO menu — Manual SO / Service Case / My Service Cases.
                Hidden on the 2990-target build; only shows when IS_HOUZS. */}
            <HouzsSsoMenu />
            {/* Products + SO Maintenance moved to the Catalog left sidebar
                (Commander 2026-05-28 "搬过去左边左下角那一边"). Removed from
                the topbar to keep selling-flow chrome focused on Quotes /
                My orders / Cart. Links live in pages/Catalog.tsx's sidebar
                under the "Maintain" heading. */}
            {count > 0 && (
              <Link to="/cart" className={styles.cartChip} aria-label="Cart">
                <ShoppingBag size={13} strokeWidth={1.75} />
                {count} item{count > 1 ? 's' : ''} · {fmtRM(subtotal)}
              </Link>
            )}
          </>
        )}
        </div>
        <div className={styles.accountActions}>
        {user && (
          <span className={styles.staffChip}>
            <span className={styles.avatar} style={{ background: avatarColor }}>
              {initials}
            </span>
            <span className={styles.staffMeta}>
              <span className={styles.staffName}>{name}</span>
              <span className={styles.staffRole}>{role.replace(/_/g, ' ')}</span>
            </span>
          </span>
        )}
        {IS_HOUZS && (
          <Link to="/it-support" className={styles.iconBtn} aria-label="IT Support" title="IT Support">
            <LifeBuoy size={18} strokeWidth={1.75} />
          </Link>
        )}
        {canChangePin && (
          <Link to="/change-pin" className={styles.iconBtn} aria-label="Change PIN" title="Change PIN">
            <KeyRound size={18} strokeWidth={1.75} />
          </Link>
        )}
        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => void signOut()}
          aria-label="Switch user"
          title="Switch user"
        >
          <LogOut size={18} strokeWidth={1.75} />
        </button>
        </div>
      </div>
      <div className={styles.mobileNav}>
        <Link to="/cart" className={styles.mobileCart} aria-label={`Cart, ${count} items`}>
          <ShoppingBag size={20} strokeWidth={1.75} />
          <span>{count}</span>
        </Link>
        <details className={styles.mobileMenu} onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.currentTarget.open = false;
            event.currentTarget.querySelector('summary')?.focus();
          }
        }}>
          <summary aria-label="Sales menu"><Menu size={22} strokeWidth={1.75} /></summary>
          <nav aria-label="Sales navigation" onClick={(event) => {
            const action = (event.target as Element).closest('a, button');
            // Nested menus own their expansion. Closing on the Houzs trigger
            // would hide its actions before the salesperson could select one.
            if (action?.parentElement === event.currentTarget || action?.closest('.' + styles.mobileMenuExtras)) {
              event.currentTarget.closest('details')?.removeAttribute('open');
            }
          }}>
            <div className={styles.mobileStaff}>{name}<small>{role.replace(/_/g, ' ')}</small></div>
            <Link to="/catalog">Products</Link>
            <Link to="/quotes"><Bookmark size={18} />Saved quotes</Link>
            <Link to="/my-orders"><ListOrdered size={18} />My orders</Link>
            {mobileMenuSlot && <div className={styles.mobileMenuExtras}>{mobileMenuSlot}</div>}
            {!IS_SIMULATION && <div className={styles.mobileServiceMenu}><HouzsSsoMenu /></div>}
            {IS_HOUZS && <Link to="/it-support"><LifeBuoy size={18} />IT Support</Link>}
            {canChangePin && <Link to="/change-pin"><KeyRound size={18} />Change PIN</Link>}
            <button type="button" onClick={() => void signOut()}><LogOut size={18} />Switch user</button>
          </nav>
        </details>
      </div>
    </header>
    </>
  );
}
