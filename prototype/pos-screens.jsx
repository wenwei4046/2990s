// 2990's POS — Screen components
// LoginScreen, CatalogScreen, HandoverScreen, ConfirmScreen, plus shared bits.

const { useState, useEffect, useRef, useMemo } = React;

// ============ Helpers ============
function Price({ value, sup = 'RM', className = '' }) {
  const formatted = (value || 0).toLocaleString('en-MY');
  return (
    <span className={className}>
      <sup>{sup}</sup>{formatted}
    </span>
  );
}

function Avatar({ initials, color, size = 32 }) {
  return (
    <span
      className="login__staff-avatar"
      style={{ width: size, height: size, fontSize: size * 0.36, background: color || '#A6471E' }}>
      {initials}
    </span>
  );
}

function useLucide(deps = []) {
  useEffect(() => {
    if (window.lucide) window.lucide.createIcons();
  }, deps);
}

// ============ Topbar ============
function Topbar({ step, staff, onLogout, onBack, cartCount, quotesCount, onShowQuotes, onOrderStatus, orderStatusUnlocked }) {
  useLucide([step, cartCount, quotesCount]);
  const steps = [
    { id: 'cart',     label: 'Cart' },
    { id: 'handover', label: 'Customer' },
    { id: 'confirm',  label: 'Confirmed' },
  ];
  return (
    <div className="pos-topbar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        {onBack && (
          <button className="icon-btn" onClick={onBack} aria-label="Back">
            <i data-lucide="arrow-left"></i>
          </button>
        )}
        <span className="pos-wordmark">
          2990
          <span className="pos-wordmark__ring">S</span>
        </span>
        <span style={{ fontFamily: 'var(--font-button)', fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--fg-muted)', borderLeft: '1px solid var(--line)', paddingLeft: 14, marginLeft: 4 }}>
          POS · Showroom KL
        </span>
      </div>

      <div className="pos-topbar__center">
        {step !== 'login' && steps.map((s, i) => (
          <span key={s.id} className={`pos-topbar__step ${step === s.id ? 'is-active' : ''}`}>
            <span style={{ opacity: 0.55, marginRight: 6 }}>0{i + 1}</span>{s.label}
          </span>
        ))}
      </div>

      <div className="pos-topbar__right">
        {staff && (
          <>
            {step === 'cart' && (
              <button className="topbar-pill" onClick={onShowQuotes} aria-label="Saved quotes">
                <i data-lucide="bookmark"></i>
                <span>Quotes</span>
                {quotesCount > 0 && <span className="topbar-pill__badge">{quotesCount}</span>}
              </button>
            )}
            {(step === 'cart' || step === 'order-status') && (
              <button
                className={`topbar-pill ${step === 'order-status' ? 'is-active' : ''}`}
                onClick={onOrderStatus}
                aria-label="Order status">
                <i data-lucide={orderStatusUnlocked ? 'lock-open' : 'lock'}></i>
                <span>Order Status</span>
              </button>
            )}
            {cartCount > 0 && step === 'cart' && (
              <span style={{ fontSize: 12, color: 'var(--fg-muted)', fontFamily: 'var(--font-button)', fontWeight: 600 }}>
                <i data-lucide="shopping-bag" style={{ width: 13, height: 13, verticalAlign: '-2px', marginRight: 4 }}></i>
                {cartCount} item{cartCount > 1 ? 's' : ''}
              </span>
            )}
            <span className="pos-staff-chip">
              <Avatar initials={staff.initials} color={staff.color} size={28} />
              <span>
                {staff.name}
                <span className="pos-staff-chip__role" style={{ display: 'block' }}>{staff.role}</span>
              </span>
            </span>
            <button className="icon-btn" onClick={onLogout} aria-label="Lock">
              <i data-lucide="log-out"></i>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ============ Login ============
function LoginScreen({ onLogin }) {
  const [selected, setSelected] = useState(null);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState(false);
  useLucide([selected, pin, err]);

  function press(k) {
    setErr(false);
    if (k === 'del') return setPin(p => p.slice(0, -1));
    if (k === 'clr') return setPin('');
    if (pin.length >= 4) return;
    setPin(p => p + k);
  }
  useEffect(() => {
    if (pin.length === 4 && selected) {
      if (selected.pin === pin) {
        setTimeout(() => onLogin(selected), 180);
      } else {
        setErr(true);
        setTimeout(() => { setPin(''); setErr(false); }, 700);
      }
    }
  }, [pin, selected]);

  return (
    <div className="login">
      <div className="login__photo">
        <div className="login__photo-mark">
          2990<span className="pos-wordmark__ring">S</span>
        </div>
        <p className="login__photo-quote">
          A beautiful space doesn't begin with luxury. It begins with clarity, honesty, and the feeling of truly being at home.
        </p>
      </div>
      <div className="login__panel">
        <div className="login__eyebrow">Showroom KL · Sales Floor</div>
        <h1 className="login__title">Welcome back.</h1>
        <p className="login__sub">Pick your name and enter your PIN to start a session.</p>

        <div className="login__staff-list">
          {window.STAFF.map(s => (
            <button key={s.id} className={`login__staff ${selected?.id === s.id ? 'is-selected' : ''}`} onClick={() => { setSelected(s); setPin(''); setErr(false); }}>
              <Avatar initials={s.initials} color={s.color} size={44} />
              <span>
                <div className="login__staff-name">{s.name}</div>
                <div className="login__staff-role">{s.role}</div>
              </span>
            </button>
          ))}
        </div>

        <div className="login__pin-row">
          <div className="login__pin">
            {[0,1,2,3].map(i => (
              <span key={i} className={`login__pin-dot ${err ? 'is-err' : pin.length > i ? 'is-on' : ''}`}></span>
            ))}
          </div>
          <span className="login__pin-hint">
            {selected ? `4-digit PIN · hint: ${selected.pin}` : 'Select a staff member first'}
          </span>
        </div>

        <div className="login__pad">
          {['1','2','3','4','5','6','7','8','9'].map(k => (
            <button key={k} className="login__pad-key" onClick={() => press(k)} disabled={!selected}>{k}</button>
          ))}
          <button className="login__pad-key login__pad-key--util" onClick={() => press('clr')} disabled={!selected}>Clear</button>
          <button className="login__pad-key" onClick={() => press('0')} disabled={!selected}>0</button>
          <button className="login__pad-key login__pad-key--util" onClick={() => press('del')} disabled={!selected}>
            <i data-lucide="delete"></i>
          </button>
        </div>

        <div className="login__footer">
          <span className="login__footer-dot"></span>
          Terminal #2 · synced · v2.6.0
        </div>
      </div>
    </div>
  );
}

// ============ Catalog Screen ============
function CatalogScreen({ cart, onAdd, onConfigure, onEditLine, onRemove, onSetQty, onGenerateOrder, onSaveQuote, customer, onClearCart, density }) {
  const [activeCat, setActiveCat] = useState('all');
  const [series, setSeries] = useState('All series');
  const [query, setQuery] = useState('');
  const [pulseId, setPulseId] = useState(null);
  const [toast, setToast] = useState(null);

  useLucide([activeCat, series, query, cart.length, pulseId, toast]);

  const counts = useMemo(() => {
    // Only count products in categories that are currently open. TBC ones
    // are intentionally excluded from "All" so the grid stays focused.
    const openIds = new Set(window.CATEGORIES.filter(c => !c.tbc && c.id !== 'all').map(c => c.id));
    const c = { all: window.PRODUCTS.filter(p => openIds.has(p.cat)).length };
    window.CATEGORIES.forEach(cat => {
      if (cat.id === 'all') return;
      c[cat.id] = window.PRODUCTS.filter(p => p.cat === cat.id).length;
    });
    return c;
  }, []);

  const filtered = useMemo(() => {
    const openIds = new Set(window.CATEGORIES.filter(c => !c.tbc && c.id !== 'all').map(c => c.id));
    return window.PRODUCTS.filter(p => {
      if (activeCat === 'all') {
        if (!openIds.has(p.cat)) return false;
      } else if (p.cat !== activeCat) {
        return false;
      }
      if (series !== 'All series' && p.series !== series) return false;
      if (query) {
        const q = query.toLowerCase();
        if (!p.name.toLowerCase().includes(q) && !p.sku.toLowerCase().includes(q) && !p.detail.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [activeCat, series, query]);

  const subtotal = cart.reduce((s, item) => s + item.qty * (item.config?.lineItem?.total ?? window.PRICE), 0);

  function handleAdd(p) {
    // Sofas and bed frames go through the Configurator before joining the cart.
    if (onConfigure && (p.cat === 'sofa' || p.cat === 'bedframe' || p.cat === 'mattress')) {
      onConfigure(p);
      return;
    }
    onAdd(p);
    setPulseId(p.id);
    setTimeout(() => setPulseId(null), 280);
    setToast(`Added · ${p.name}`);
    setTimeout(() => setToast(null), 1600);
  }

  function handleSaveQuote() {
    if (cart.length === 0) return;
    // App's saveQuote owns the toast (it knows whether the quote was created vs. updated,
    // and whether the customer-name modal is required first). Don't double-toast.
    onSaveQuote && onSaveQuote();
  }

  return (
    <div className="catalog">
      {/* Sidebar */}
      <aside className="cat-side">
        <div className="cat-side__heading">Categories</div>
        {window.CATEGORIES.filter(c => !c.tbc).map(cat => (
          <button key={cat.id} className={`cat-side__item ${activeCat === cat.id ? 'is-active' : ''}`} onClick={() => setActiveCat(cat.id)}>
            <i data-lucide={cat.icon}></i>
            <span>{cat.label}</span>
            <span className="cat-side__count">{counts[cat.id]}</span>
          </button>
        ))}

        <div className="cat-side__heading" style={{ marginTop: 16 }}>To be confirmed</div>
        {window.CATEGORIES.filter(c => c.tbc).map(cat => (
          <button
            key={cat.id}
            className="cat-side__item cat-side__item--tbc"
            disabled
            aria-disabled="true"
            title="This range is being finalised — opening soon."
          >
            <i data-lucide={cat.icon}></i>
            <span>{cat.label}</span>
            <span className="cat-side__pill">Soon</span>
          </button>
        ))}

        <div className="cat-side__heading" style={{ marginTop: 16 }}>Quick</div>
        <button className="cat-side__item" onClick={() => { setQuery(''); setSeries('All series'); setActiveCat('all'); }}>
          <i data-lucide="rotate-ccw"></i>
          <span>Reset filters</span>
        </button>
        <button className="cat-side__item" onClick={() => setActiveCat('mattress')}>
          <i data-lucide="sparkles"></i>
          <span>Bestsellers</span>
        </button>

        <div style={{ marginTop: 'auto', padding: '12px', fontSize: 11, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
          <div style={{ fontFamily: 'var(--font-button)', fontWeight: 700, letterSpacing: '0.16em', fontSize: 9, textTransform: 'uppercase', color: 'var(--c-burnt)', marginBottom: 4 }}>
            Same price. Always.
          </div>
          Every piece in the catalog is RM2,990. No upsells, no comparison.
        </div>
      </aside>

      {/* Main */}
      <main className="cat-main">
        <div className="cat-toolbar">
          <div className="cat-search">
            <i data-lucide="search"></i>
            <input
              type="text"
              placeholder="Search by name, SKU, or detail…"
              value={query}
              onChange={e => setQuery(e.target.value)} />
          </div>
          <select className="cat-select" value={series} onChange={e => setSeries(e.target.value)}>
            {window.SERIES_OPTIONS.map(s => <option key={s}>{s}</option>)}
          </select>
          <span style={{ alignSelf: 'center', fontSize: 12, color: 'var(--fg-muted)', fontFamily: 'var(--font-button)', fontWeight: 600 }}>
            {filtered.length} pieces
          </span>
        </div>

        <div className="cat-grid-wrap">
          {filtered.length === 0 ? (
            <div className="cat-empty">
              <h4>No pieces match.</h4>
              <p>Try clearing the search or pick a different category.</p>
            </div>
          ) : (
            <div className={`cat-grid ${density === 'compact' ? 'cat-grid--compact' : ''}`}>
              {filtered.map(p => {
                const inCart = cart.some(i => i.id === p.id);
                const lowStock = p.stock <= 5;
                return (
                  <div key={p.id} className={`prod-card ${inCart ? 'is-in-cart' : ''}`} onClick={() => handleAdd(p)}>
                    <div className="prod-card__photo" style={{ backgroundImage: `url(${p.img})` }}>
                      <span className="prod-card__badge">{p.series}</span>
                      <span className={`prod-card__stock ${lowStock ? 'is-low' : ''}`}>
                        <i data-lucide={lowStock ? 'alert-triangle' : 'check'}></i>
                        {p.stock} in stock
                      </span>
                      <button className={`prod-card__add ${pulseId === p.id ? 'is-pulsing' : ''}`} onClick={(e) => { e.stopPropagation(); handleAdd(p); }}>
                        <i data-lucide={(p.cat === 'sofa' || p.cat === 'bedframe' || p.cat === 'mattress') ? 'sliders-horizontal' : (inCart ? 'check' : 'plus')}></i>
                      </button>
                    </div>
                    <div className="prod-card__body">
                      <div className="prod-card__series">{p.size}</div>
                      <div className="prod-card__name">{p.name}</div>
                      <div className="prod-card__detail">{p.detail}</div>
                      <div className="prod-card__row">
                        <span className="prod-card__sku">{p.sku}</span>
                        <span className="prod-card__price"><sup>RM</sup>2,990</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* Cart */}
      <CartPanel cart={cart} onRemove={onRemove} onSetQty={onSetQty} onGenerateOrder={onGenerateOrder} onSaveQuote={handleSaveQuote} onEditLine={onEditLine} customer={customer} onClearCart={onClearCart} subtotal={subtotal} />

      {toast && (
        <div className="toast">
          <i data-lucide="check-circle-2"></i>
          {toast}
        </div>
      )}
    </div>
  );
}

// ============ Cart Panel (collapsed FAB + popup) ============
function CartPanel({ cart, onRemove, onSetQty, onGenerateOrder, onSaveQuote, onEditLine, customer, onClearCart, subtotal }) {
  const [open, setOpen] = useState(false);
  useLucide([cart.length, open]);
  const itemCount = cart.reduce((s, i) => s + i.qty, 0);

  // Floating card-style icon (always visible)
  const fab = (
    <button className={`cart-fab ${itemCount > 0 ? 'has-items' : ''}`} onClick={() => setOpen(true)} aria-label="Open customer order">
      <span className="cart-fab__icon"><i data-lucide="shopping-bag"></i></span>
      <span className="cart-fab__meta">
        <span className="cart-fab__label">Customer order</span>
        <span className="cart-fab__amount">RM{subtotal.toLocaleString('en-MY')}</span>
      </span>
      {itemCount > 0 && <span className="cart-fab__badge">{itemCount}</span>}
    </button>
  );

  if (!open) return fab;

  return (
    <React.Fragment>
      {fab}
      <div className="cart-pop-backdrop" onClick={() => setOpen(false)}>
      <aside className="cart cart--pop" onClick={e => e.stopPropagation()}>
      <div className="cart__head">
        <div className="cart__title-row">
          <span className="cart__title">Customer order</span>
          <span className="cart__count">{itemCount} {itemCount === 1 ? 'piece' : 'pieces'}</span>
          <button className="cart__close" onClick={() => setOpen(false)} aria-label="Close"><i data-lucide="x"></i></button>
        </div>
        <div className="cart__customer">
          <i data-lucide="user-round"></i>
          {customer.name ? <span>{customer.name}</span> : <span style={{ fontStyle: 'italic' }}>Walk-in customer · details captured at handover</span>}
        </div>
      </div>

      <div className="cart__body">
        {cart.length === 0 ? (
          <div className="cart__empty">
            <i data-lucide="shopping-bag"></i>
            <h5>Cart is empty</h5>
            <p>Tap any piece on the catalog to add it. Same price, every time.</p>
          </div>
        ) : (
          cart.map(item => {
            const p = window.PRODUCTS.find(x => x.id === item.id);
            const cfg = item.config;
            const lineTotal = item.qty * (cfg?.lineItem?.total ?? window.PRICE);
            const photo = p?.img;
            const name = cfg?.lineItem?.title || p?.name || 'Item';
            const detail = cfg?.lineItem?.sub || (p ? `${p.size} · ${p.sku}` : '');
            // Sofas, bed frames, and mattresses can be re-configured from the cart.
            const editable = !!onEditLine && (cfg || ['sofa','bedframe','mattress'].includes(p?.cat));
            return (
              <div key={item.key} className={`cart-item fade-in ${cfg ? 'cart-item--configured' : ''} ${editable ? 'cart-item--editable' : ''}`}>
                <div className="cart-item__photo" style={photo ? { backgroundImage: `url(${photo})` } : { background: 'var(--bg-tan, #E3D0A6)' }}></div>
                <div>
                  <div className="cart-item__name">
                    {name}
                    {editable && (
                      <button
                        className="cart-item__edit"
                        onClick={() => onEditLine(item)}
                        aria-label="Edit options"
                        title="Edit size & options"
                      ><i data-lucide="settings-2"></i>Edit</button>
                    )}
                  </div>
                  <div className="cart-item__detail">{detail}</div>
                  <div className="cart-item__qty">
                    <button onClick={() => onSetQty(item.key, item.qty - 1)} aria-label="Decrease"><i data-lucide="minus"></i></button>
                    <span>{item.qty}</span>
                    <button onClick={() => onSetQty(item.key, item.qty + 1)} aria-label="Increase"><i data-lucide="plus"></i></button>
                  </div>
                </div>
                <div className="cart-item__right">
                  <button className="cart-item__remove" onClick={() => onRemove(item.key)} aria-label="Remove">
                    <i data-lucide="x"></i>
                  </button>
                  <span className="cart-item__price"><sup>RM</sup>{lineTotal.toLocaleString('en-MY')}</span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {cart.length > 0 && (
        <div className="cart__foot">
          <div className="same-price-note">Same price · Every piece · RM2,990</div>
          <div className="cart__line"><span>Subtotal</span><span>RM{subtotal.toLocaleString('en-MY')}.00</span></div>
          <div className="cart__line"><span>Delivery</span><span>Set at handover</span></div>
          <div className="cart__line cart__line--total">
            <span>Total</span>
            <span className="cart__total-num"><sup>RM</sup>{subtotal.toLocaleString('en-MY')}</span>
          </div>
          <div className="cart__cta">
            <button className="btn btn--ghost btn--sm" onClick={onClearCart}>
              <i data-lucide="trash-2"></i>Clear
            </button>
            <button className="btn btn--ghost" onClick={() => { onSaveQuote && onSaveQuote(); setOpen(false); }}>
              <i data-lucide="bookmark-plus"></i>Save Quote
            </button>
            <button className="btn btn--primary" onClick={onGenerateOrder}>
              Convert to Sales Order<i data-lucide="arrow-right"></i>
            </button>
          </div>
        </div>
      )}
    </aside>
      </div>
    </React.Fragment>
  );
}

Object.assign(window, { Topbar, LoginScreen, CatalogScreen, CartPanel, QuotesDrawer, Avatar, Price, useLucide });

// ============ Quotes Drawer ============
function QuotesDrawer({ quotes, onClose, onLoad, onDelete }) {
  useLucide([quotes.length]);
  return (
    <div className="quotes-overlay" onClick={onClose}>
      <aside className="quotes-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="quotes-drawer__head">
          <div>
            <div style={{ fontFamily: 'var(--font-button)', fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--c-burnt)' }}>Saved quotes</div>
            <div className="quotes-drawer__title">Pick up where you left off</div>
          </div>
          <button className="icon-btn" onClick={onClose}><i data-lucide="x"></i></button>
        </div>
        <div className="quotes-drawer__body">
          {quotes.length === 0 ? (
            <div className="quotes-empty">
              <i data-lucide="bookmark"></i>
              <h5>No saved quotes</h5>
              <p>Build a cart and tap <strong>Save Quote</strong> to keep it for the customer's next visit.</p>
            </div>
          ) : (
            quotes.map(q => (
              <div key={q.id} className="quote-row">
                <div className="quote-row__photos">
                  {q.cart.slice(0, 3).map((it, i) => {
                    const p = window.PRODUCTS.find(x => x.id === it.id);
                    return <div key={i} className="quote-row__photo" style={{ backgroundImage: `url(${p?.img})` }}></div>;
                  })}
                  {q.cart.length > 3 && <div className="quote-row__more">+{q.cart.length - 3}</div>}
                </div>
                <div className="quote-row__body">
                  <div className="quote-row__id">{q.id}</div>
                  <div className="quote-row__name">{q.customer?.name || 'Walk-in customer'}</div>
                  <div className="quote-row__meta">
                    {q.cart.reduce((s,i)=>s+i.qty,0)} pieces · saved {new Date(q.savedAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })} by {q.staff || '—'}
                  </div>
                </div>
                <div className="quote-row__right">
                  <span className="quote-row__total"><sup>RM</sup>{q.subtotal.toLocaleString('en-MY')}</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="icon-btn" onClick={() => onDelete(q.id)} aria-label="Delete"><i data-lucide="trash-2"></i></button>
                    <button className="btn btn--primary btn--sm" onClick={() => onLoad(q)}>Load<i data-lucide="arrow-right"></i></button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}
window.QuotesDrawer = QuotesDrawer;
