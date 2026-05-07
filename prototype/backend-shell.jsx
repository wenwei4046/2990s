// 2990's Backend Portal — shared UI bits: sidebar, topbar, helpers
const { useState: useStateBE, useEffect: useEffectBE, useMemo: useMemoBE } = React;

function useLucideBE(deps) {
  React.useEffect(() => { if (window.lucide) window.lucide.createIcons(); }, deps);
}

function fmtMoney(n) { return Number(n).toLocaleString('en-MY'); }
function fmtDate(d) {
  if (!d) return '—';
  const x = d instanceof Date ? d : new Date(d);
  return x.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtTime(t) {
  const ms = typeof t === 'number' ? t : (t instanceof Date ? t.getTime() : new Date(t).getTime());
  const diff = Math.floor((Date.now() - ms) / 60000);
  if (diff < 1) return 'just now';
  if (diff < 60) return diff + 'm ago';
  if (diff < 24 * 60) return Math.floor(diff / 60) + 'h ago';
  return Math.floor(diff / (60 * 24)) + 'd ago';
}
function pieceCount(cart) { return cart.reduce((s, i) => s + i.qty, 0); }

function Wordmark() {
  return (
    <span className="be-side__mark">
      2990<span className="be-side__mark__ring">S</span>
    </span>
  );
}

function Sidebar({ active, onChange, counts }) {
  useLucideBE([active, counts]);
  const items = [
    { group: 'Workspace' },
    { id: 'dashboard',  label: 'Dashboard',         icon: 'layout-dashboard' },
    { id: 'orders',     label: 'Orders',            icon: 'inbox',  badge: counts.received + counts.proceed },
    { id: 'verify',     label: 'Verify slips',      icon: 'shield-check', badge: counts.toVerify, badgeMuted: counts.toVerify === 0 },
    { group: 'Catalog' },
    { id: 'skus',       label: 'SKU master',        icon: 'package' },
    { id: 'addons',     label: 'Add-on products',   icon: 'plus-circle' },
    { group: 'Reference' },
    { id: 'customers',  label: 'Customers',         icon: 'users-round' },
    { id: 'settings',   label: 'Settings',          icon: 'settings' },
  ];
  return (
    <aside className="be-side">
      <div className="be-side__brand">
        <Wordmark />
      </div>
      <div className="be-side__role">
        Backend portal
        <strong>Order Coordinator</strong>
      </div>

      <nav className="be-nav">
        {items.map((it, i) => it.group ? (
          <div key={'g' + i} className="be-nav__group">{it.group}</div>
        ) : (
          <div
            key={it.id}
            className={`be-nav__item ${active === it.id ? 'is-active' : ''}`}
            onClick={() => onChange(it.id)}
          >
            <i data-lucide={it.icon}></i>
            <span>{it.label}</span>
            {it.badge != null && it.badge > 0 && (
              <span className={`be-nav__badge ${it.badgeMuted ? 'be-nav__badge--ghost' : ''}`}>{it.badge}</span>
            )}
          </div>
        ))}
      </nav>

      <div className="be-side__foot">
        <div className="be-side__user">
          <div className="be-side__avatar" style={{ background: window.COORDINATOR.color }}>
            {window.COORDINATOR.initials}
          </div>
          <div>
            <div className="be-side__user__name">{window.COORDINATOR.name}</div>
            <div className="be-side__user__role">{window.COORDINATOR.role}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}

function Topbar({ title, sub, search, onSearch, right }) {
  useLucideBE([title, search]);
  return (
    <header className="be-top">
      <div className="be-top__left">
        <div>
          <div className="be-top__title">{title}</div>
          <div className="be-top__sub">{sub}</div>
        </div>
      </div>
      <div className="be-top__right">
        {onSearch && (
          <div className="be-search">
            <i data-lucide="search"></i>
            <input placeholder="Order ID, customer, SKU…" value={search || ''} onChange={e => onSearch(e.target.value)} />
          </div>
        )}
        {right}
        <button className="be-pill"><i data-lucide="bell"></i>Alerts</button>
        <button className="be-pill"><i data-lucide="help-circle"></i>Help</button>
      </div>
    </header>
  );
}

function StatusPill({ tone, icon, label }) {
  return (
    <span className={`be-status be-status--${tone}`}>
      <i data-lucide={icon}></i>{label}
    </span>
  );
}

Object.assign(window, {
  useLucideBE, fmtMoney, fmtDate, fmtTime, pieceCount,
  Sidebar, Topbar, Wordmark, StatusPill,
});
