// 2990's Backend Portal — main app shell

const { useState: useStateApp, useEffect: useEffectApp } = React;

const BE_TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "cream",
  "density": "calm"
}/*EDITMODE-END*/;

function VerifySlips({ orders, onOpenOrder }) {
  const [filter, setFilter] = useStateApp('pending');
  window.useLucideBE([orders.length, filter]);

  const list = orders.filter(o => filter === 'all' ? true : (o.slipVerify || 'none') === filter);

  return (
    <div className="be-page">
      <div className="be-rule-banner">
        <div className="be-rule-banner__icon"><i data-lucide="shield-check"></i></div>
        <div>
          <div className="be-rule-banner__title">Verify uploaded payment slips</div>
          <div className="be-rule-banner__sub">
            Cross-check each slip against the order — amount, name, reference. <strong>Verify only.</strong> Final approval &amp; reconciliation is handled by Finance once they sync the bank statement.
          </div>
        </div>
      </div>

      <div className="be-board-toolbar">
        <div className="be-tabs">
          {[
            { id: 'pending',  label: 'Awaiting check' },
            { id: 'verified', label: 'Verified' },
            { id: 'flagged',  label: 'Flagged' },
            { id: 'all',      label: 'All' },
          ].map(t => {
            const n = t.id === 'all' ? orders.length : orders.filter(o => (o.slipVerify || 'none') === t.id).length;
            return (
              <div key={t.id} className={`be-tab ${filter === t.id ? 'is-active' : ''}`} onClick={() => setFilter(t.id)}>
                {t.label}<span className="be-tab__count">{n}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="be-verify-card">
        {list.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--fg-muted)' }}>
            <i data-lucide="check-circle-2" style={{ width: 22, height: 22, marginBottom: 8 }}></i>
            <div>Nothing here.</div>
          </div>
        ) : list.map(o => {
          const slip = window.SLIP_VERIFY[o.slipVerify || 'none'];
          const method = window.PAYMENT_METHODS.find(m => m.id === o.paymentMethod);
          const firstItem = o.cart[0];
          const product = firstItem ? window.PRODUCTS.find(p => p.id === firstItem.id) : null;
          return (
            <div key={o.id} className="be-verify-row" onClick={() => onOpenOrder(o.id)}>
              <div className="be-verify-row__avatar" style={product?.img ? { backgroundImage: `url(${product.img})` } : null}></div>
              <div>
                <div className="be-verify-row__name">{o.customer?.name} <span style={{ color: 'var(--fg-muted)', fontWeight: 500, fontSize: 12 }}>· {o.id}</span></div>
                <div className="be-verify-row__sub">{window.pieceCount(o.cart)} pieces · {window.fmtTime(o.placedAt)} · {o.staff}</div>
              </div>
              <div className="be-verify-row__amount">
                <sup>RM</sup>{window.fmtMoney(o.paid)}
              </div>
              <div className="be-verify-row__method">
                <i data-lucide={method?.icon || 'credit-card'}></i>{method?.label || 'Bank transfer'}
              </div>
              <window.StatusPill tone={slip.tone} icon={slip.icon} label={slip.label} />
              <i data-lucide="chevron-right" style={{ width: 16, height: 16, color: 'var(--fg-muted)' }}></i>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BackendApp() {
  const [tweaks, setTweak] = window.useTweaks(BE_TWEAK_DEFAULTS);
  const [page, setPage] = useStateApp('dashboard');
  const [orders, setOrders] = useStateApp(() => {
    const live = window.readBridgeOrders ? window.readBridgeOrders() : [];
    return live.length ? live : window.seedBackendOrders();
  });

  // Live-subscribe to POS — new orders pushed via localStorage flow in here.
  useEffectApp(() => {
    if (!window.subscribeBridge) return;
    const unsub = window.subscribeBridge((list) => {
      setOrders(prev => {
        // Merge: new ids from bridge get appended; existing ids keep their
        // current lane/state so backend edits don't get overwritten.
        const byId = Object.fromEntries(prev.map(o => [o.id, o]));
        const merged = list.map(o => byId[o.id] ? byId[o.id] : o);
        // Append any backend-only orders (none today, but safe)
        prev.forEach(o => { if (!list.find(x => x.id === o.id)) merged.push(o); });
        return merged;
      });
      setToast('New order received from showroom');
    });
    return unsub;
  }, []);
  const [drivers, setDrivers] = useStateApp(() => window.SEED_DRIVERS.slice());
  const [activeOrderId, setActiveOrderId] = useStateApp(null);
  const [search, setSearch] = useStateApp('');
  const [toast, setToast] = useStateApp(null);

  useEffectApp(() => {
    document.body.dataset.theme = tweaks.theme || 'cream';
    document.body.dataset.density = tweaks.density || 'calm';
  }, [tweaks.theme, tweaks.density]);

  useEffectApp(() => { if (window.lucide) window.lucide.createIcons(); }, [page, orders, activeOrderId, toast]);

  useEffectApp(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const counts = {
    received: orders.filter(o => o.lane === 'received').length,
    proceed:  orders.filter(o => o.lane === 'proceed').length,
    toVerify: orders.filter(o => o.slipVerify === 'pending').length,
  };

  const activeOrder = orders.find(o => o.id === activeOrderId) || null;

  function updateOrder(updated) {
    setOrders(prev => prev.map(o => o.id === updated.id ? updated : o));
  }

  function jumpTo(p) { setPage(p); setActiveOrderId(null); }
  function openOrder(id) { setActiveOrderId(id); }

  const titles = {
    dashboard: { title: 'Today\u2019s desk', sub: 'Order Coordinator · Mei Lin Chua' },
    orders:    { title: 'Orders', sub: '01 received  →  06 delivered' },
    verify:    { title: 'Verify payment slips', sub: 'Verify only · Finance approves' },
    skus:      { title: 'SKU master', sub: 'Every piece · RM2,990' },
    addons:    { title: 'Add-on products', sub: 'Disposal, lift, assembly, extras' },
    customers: { title: 'Customers', sub: 'Read-only directory' },
    settings:  { title: 'Settings', sub: 'Workspace preferences' },
  };
  const tt = titles[page] || titles.dashboard;

  return (
    <div className="be-root" data-screen-label={`Backend / ${tt.title}`}>
      <window.Sidebar active={page} onChange={jumpTo} counts={counts} />

      <div className="be-main">
        <window.Topbar
          title={tt.title}
          sub={tt.sub}
          search={search}
          onSearch={page === 'orders' ? setSearch : null}
          right={<button className="be-pill"><i data-lucide="plus"></i>Quick action</button>}
        />

        {page === 'dashboard' && <window.Dashboard orders={orders} onJump={jumpTo} onOpenOrder={openOrder} />}
        {page === 'orders'    && <window.OrdersBoard orders={orders} onOpenOrder={(o) => openOrder(o.id)} />}
        {page === 'verify'    && <VerifySlips orders={orders} onOpenOrder={openOrder} />}
        {page === 'skus'      && <window.SkuMaster onToast={(t) => setToast(t)} />}
        {page === 'addons'    && <window.AddonsManager onToast={(t) => setToast(t)} />}
        {page === 'customers' && <window.CustomersStub />}
        {page === 'settings'  && <window.SettingsPage drivers={drivers} setDrivers={setDrivers} onToast={(t) => setToast(t)} />}
      </div>

      {activeOrder && (
        <window.OrderDrawer
          order={activeOrder}
          drivers={drivers}
          onClose={() => setActiveOrderId(null)}
          onUpdate={updateOrder}
          onToast={(t) => setToast(t)}
        />
      )}

      {toast && (
        <div className="be-toast">
          <i data-lucide="check-circle-2"></i>
          <span>{toast}</span>
        </div>
      )}

      {/* Tweaks */}
      <window.TweaksPanel title="Tweaks">
        <window.TweakSection title="Theme">
          <window.TweakRadio
            label="Surface"
            value={tweaks.theme}
            options={[
              { value: 'cream', label: 'Cream' },
              { value: 'paper', label: 'Paper' },
              { value: 'ink',   label: 'Ink' },
            ]}
            onChange={v => setTweak('theme', v)}
          />
        </window.TweakSection>
        <window.TweakSection title="Density">
          <window.TweakRadio
            label="Information density"
            value={tweaks.density}
            options={[
              { value: 'calm',    label: 'Calm' },
              { value: 'compact', label: 'Compact' },
            ]}
            onChange={v => setTweak('density', v)}
          />
        </window.TweakSection>
        <window.TweakSection title="Demo">
          <window.TweakButton onClick={() => {
            // bump a verify queue order to demonstrate flow
            setOrders(prev => prev.map(o => o.id === 'SO-2045' ? { ...o, slipVerify: 'verified', slipVerifiedBy: window.COORDINATOR.name, slipVerifiedAt: Date.now() } : o));
            setToast('SO-2045 marked verified');
          }}>
            <i data-lucide="shield-check" style={{ width: 14, height: 14, marginRight: 6, verticalAlign: '-2px' }}></i>
            Demo: verify one slip
          </window.TweakButton>
          <window.TweakButton onClick={() => {
            window.clearBridgeOrders && window.clearBridgeOrders();
            setOrders([]);
            setToast('All orders cleared');
          }}>
            <i data-lucide="trash-2" style={{ width: 14, height: 14, marginRight: 6, verticalAlign: '-2px' }}></i>
            Clear all orders
          </window.TweakButton>
        </window.TweakSection>
      </window.TweaksPanel>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<BackendApp />);
