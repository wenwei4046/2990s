// 2990's Backend Portal — Dashboard
const { useState: useStateD, useMemo: useMemoD } = React;

function Dashboard({ orders, onJump, onOpenOrder }) {
  window.useLucideBE([orders.length]);

  const counts = useMemoD(() => {
    const c = { received: 0, proceed: 0, logistics: 0, ready: 0, dispatched: 0, delivered: 0 };
    orders.forEach(o => { if (c[o.lane] != null) c[o.lane]++; });
    return c;
  }, [orders]);

  const today = new Date().setHours(0,0,0,0);
  const newToday   = orders.filter(o => o.placedAt >= today).length;
  const dispatchToday = orders.filter(o => o.lane === 'dispatched' && o.delivery?.date && new Date(o.delivery.date).setHours(0,0,0,0) === today).length;
  const toVerify   = orders.filter(o => o.slipVerify === 'pending').length;
  const flaggedAddr = orders.filter(o => !o.customer?.address).length;
  const collectedToday = orders.filter(o => o.placedAt >= today).reduce((s, o) => s + o.paid, 0);

  const pendingOrders = orders.filter(o => o.slipVerify === 'pending').slice(0, 4);

  return (
    <div className="be-page">
      {/* Hero + KPIs */}
      <div className="be-hero">
        <div className="be-hero__card">
          <div className="be-hero__eyebrow">Monday · 4 May 2026</div>
          <div className="be-hero__title">
            Good morning, Mei Lin. <span className="script">eight</span> orders need a careful look today.
          </div>
          <div className="be-hero__sub">
            Same price. Every piece. Always. The showroom passed {newToday} new orders overnight — verify slips first, then move stock.
          </div>
          <div className="be-hero__chips">
            <span className="be-hero__chip"><i data-lucide="inbox"></i>{counts.received} received</span>
            <span className="be-hero__chip"><i data-lucide="arrow-right-circle"></i>{counts.proceed} proceed</span>
            <span className="be-hero__chip"><i data-lucide="package-search"></i>{counts.logistics} logistics</span>
            <span className="be-hero__chip"><i data-lucide="truck"></i>{counts.dispatched} on the road</span>
          </div>
        </div>

        <div className="be-kpi-grid">
          <div className="be-kpi">
            <div className="be-kpi__head"><i data-lucide="sparkles"></i>New today</div>
            <div className="be-kpi__num">{newToday}</div>
            <div className="be-kpi__delta is-up"><i data-lucide="trending-up"></i>+2 vs. Sunday</div>
          </div>
          <div className="be-kpi">
            <div className="be-kpi__head"><i data-lucide="truck"></i>Dispatch today</div>
            <div className="be-kpi__num">{dispatchToday}</div>
            <div className="be-kpi__delta"><i data-lucide="map-pin"></i>3 in Klang Valley</div>
          </div>
          <div className="be-kpi">
            <div className="be-kpi__head"><i data-lucide="shield-check"></i>Slips to verify</div>
            <div className="be-kpi__num">{toVerify}</div>
            <div className="be-kpi__delta is-flag"><i data-lucide="alert-circle"></i>Verify only · Finance approves</div>
          </div>
          <div className="be-kpi">
            <div className="be-kpi__head"><i data-lucide="banknote"></i>Collected today</div>
            <div className="be-kpi__num"><sup>RM</sup>{fmtMoney(collectedToday)}</div>
            <div className="be-kpi__delta"><i data-lucide="circle-dot"></i>Across {newToday} orders</div>
          </div>
        </div>
      </div>

      {/* Lane summary */}
      <div className="be-section-title">
        <h2>Order pipeline</h2>
        <span className="be-section-title__sub">Click a lane to jump to the board</span>
        <div className="be-section-title__act">
          <button className="be-btn be-btn--ghost" onClick={() => onJump('orders')}>
            Open board<i data-lucide="arrow-right"></i>
          </button>
        </div>
      </div>

      <div className="be-lanes-strip">
        {window.LANES.map(l => (
          <div key={l.id} className="be-lane-tile" onClick={() => onJump('orders', l.id)}>
            <div className="be-lane-tile__icon"><i data-lucide={l.icon}></i></div>
            <div className="be-lane-tile__num">{l.num}</div>
            <div className="be-lane-tile__title">{l.title}</div>
            <div className="be-lane-tile__count">
              <span className="be-lane-tile__num-big">{counts[l.id] || 0}</span>
              <span className="be-lane-tile__lbl">{counts[l.id] === 1 ? 'order' : 'orders'}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Verify queue */}
      <div className="be-section-title">
        <h2>Awaiting payment slip check</h2>
        <span className="be-section-title__sub">You verify the slip matches — Finance approves</span>
        <div className="be-section-title__act">
          <button className="be-btn be-btn--ghost" onClick={() => onJump('verify')}>
            All slips<i data-lucide="arrow-right"></i>
          </button>
        </div>
      </div>

      <div className="be-verify-card">
        {pendingOrders.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--fg-muted)' }}>
            <i data-lucide="check-circle-2" style={{ width: 22, height: 22, marginBottom: 8 }}></i>
            <div>All slips checked. Nicely done.</div>
          </div>
        ) : pendingOrders.map(o => {
          const firstItem = o.cart[0];
          const product = firstItem ? window.PRODUCTS.find(p => p.id === firstItem.id) : null;
          const method = window.PAYMENT_METHODS.find(m => m.id === o.paymentMethod);
          return (
            <div key={o.id} className="be-verify-row" onClick={() => onOpenOrder(o.id)}>
              <div className="be-verify-row__avatar" style={product?.img ? { backgroundImage: `url(${product.img})` } : null}></div>
              <div>
                <div className="be-verify-row__name">{o.customer?.name} <span style={{ color: 'var(--fg-muted)', fontWeight: 500, fontSize: 12 }}>· {o.id}</span></div>
                <div className="be-verify-row__sub">{pieceCount(o.cart)} pieces · placed {fmtTime(o.placedAt)} by {o.staff}</div>
              </div>
              <div className="be-verify-row__amount">
                <sup>RM</sup>{fmtMoney(o.paid)}
              </div>
              <div className="be-verify-row__method">
                <i data-lucide={method?.icon || 'credit-card'}></i>{method?.label || 'Bank transfer'}
              </div>
              <window.StatusPill tone="warn" icon="clock" label="Awaiting check" />
              <i data-lucide="chevron-right" style={{ width: 16, height: 16, color: 'var(--fg-muted)' }}></i>
            </div>
          );
        })}
      </div>
    </div>
  );
}

window.Dashboard = Dashboard;
