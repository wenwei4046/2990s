import { NavLink } from 'react-router';
import { LayoutDashboard, ListOrdered, Boxes, FileCheck2, Plus, Users, Settings, LogOut } from 'lucide-react';
import { useAuth } from '../lib/auth';
import styles from './Sidebar.module.css';

const navItems = [
  { to: '/dashboard', icon: <LayoutDashboard size={20} strokeWidth={1.75} />, label: 'Dashboard' },
  { to: '/orders', icon: <ListOrdered size={20} strokeWidth={1.75} />, label: 'Orders' },
  { to: '/sku-master', icon: <Boxes size={20} strokeWidth={1.75} />, label: 'SKU master' },
  { to: '/verify-slips', icon: <FileCheck2 size={20} strokeWidth={1.75} />, label: 'Verify slips' },
  { to: '/addons', icon: <Plus size={20} strokeWidth={1.75} />, label: 'Add-ons' },
  { to: '/customers', icon: <Users size={20} strokeWidth={1.75} />, label: 'Customers' },
  { to: '/settings', icon: <Settings size={20} strokeWidth={1.75} />, label: 'Settings' },
];

export const Sidebar = () => {
  const { staff, signOut } = useAuth();
  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <span className="t-eyebrow">2990's · Backend</span>
      </div>

      <nav className={styles.nav}>
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => (isActive ? `${styles.navItem} ${styles.active}` : styles.navItem)}
          >
            {item.icon}
            <span className={styles.navLabel}>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className={styles.footer}>
        {staff && (
          <div className={styles.user}>
            <span className={styles.avatar} style={{ background: staff.color }}>{staff.initials}</span>
            <div className={styles.userMeta}>
              <strong className="t-body-sm">{staff.name}</strong>
              <small className="t-caption">{staff.role}</small>
            </div>
          </div>
        )}
        <button onClick={() => void signOut()} className={styles.signOut} type="button">
          <LogOut size={16} strokeWidth={1.75} />
          <span className={styles.navLabel}>Sign out</span>
        </button>
      </div>
    </aside>
  );
};
