// 2990's POS — Main app shell. Owns state, routes screens, hosts Tweaks.

const { useState: useStateA, useEffect: useEffectA } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "cream",
  "density": "calm",
  "demoSeed": "fresh"
}/*EDITMODE-END*/;

const EMPTY_CUSTOMER = { name: '', phone: '', email: '', type: 'New', address: '', postcode: '', city: '', state: 'Selangor', bldg: 'Condo', addressLater: false, billingSameAsDelivery: true, billingAddress: '', billingPostcode: '', billingCity: '', billingState: 'Selangor' };
const EMPTY_EMERGENCY = { name: '', phone: '', relation: 'Spouse' };
const EMPTY_DELIVERY = { date: null, slot: null, notes: '' };

function App() {
  const [tweaks, setTweak] = window.useTweaks(TWEAK_DEFAULTS);
  // Login is temporarily skipped — kept stand-alone in login.html while we
  // iterate on the rest of the flow. Re-enable by switching the initial
  // step back to 'login' and the initial staff back to null.
  const [step, setStep] = useStateA('cart');
  const [activeQuote, setActiveQuote] = useStateA(null); // the quote being configured
  const [staff, setStaff] = useStateA(window.STAFF[0]);
  const [cart, setCart] = useStateA([]);
  const [customer, setCustomer] = useStateA(EMPTY_CUSTOMER);
  const [emergency, setEmergency] = useStateA(EMPTY_EMERGENCY);
  const [payment, setPayment] = useStateA(null);
  const [delivery, setDelivery] = useStateA(EMPTY_DELIVERY);
  const [addons, setAddons] = useStateA([]);
  const [quotes, setQuotes] = useStateA([]);
  const [showQuotes, setShowQuotes] = useStateA(false);
  const [toast, setToast] = useStateA(null);
  const [orders, setOrders] = useStateA(() => window.seedSampleOrders ? window.seedSampleOrders() : []);
  const [orderStatusUnlocked, setOrderStatusUnlocked] = useStateA(false);
  const [showPinGate, setShowPinGate] = useStateA(false);
  const [needCustomerName, setNeedCustomerName] = useStateA(false);
  const [pendingCustomerName, setPendingCustomerName] = useStateA('');

  // Apply theme to body
  useEffectA(() => {
    document.body.dataset.theme = tweaks.theme || 'cream';
  }, [tweaks.theme]);

  // Lucide icons
  useEffectA(() => {
    if (window.lucide) window.lucide.createIcons();
  }, [step, staff, cart.length, showQuotes, toast]);

  // Toast auto-dismiss
  useEffectA(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  function add(p) {
    setCart(prev => {
      const i = prev.find(x => x.key === p.id && !x.config);
      if (i) return prev.map(x => x.key === p.id && !x.config ? { ...x, qty: x.qty + 1 } : x);
      return [...prev, { key: p.id, id: p.id, qty: 1 }];
    });
  }
  function remove(key) { setCart(prev => prev.filter(x => x.key !== key)); }
  function setQty(key, q) {
    if (q < 1) return remove(key);
    setCart(prev => prev.map(x => x.key === key ? { ...x, qty: q } : x));
  }
  function clearCart() { setCart([]); }

  // Open configurator scoped to a single product (sofa or bedframe)
  function configureProduct(product) {
    setActiveQuote({
      id: 'NEW',
      customerName: customer?.name || 'Walk-in',
      productContext: product,        // the product being configured
      activeTab: product.cat === 'bedframe' ? 'bed' : product.cat === 'mattress' ? 'mattress' : 'sofa',
      lockTab: true,                  // hide tab switcher when scoped
    });
    setStep('configure');
  }

  // Push a configured line into the cart, then return to the catalog.
  // If `editingKey` is set on activeQuote, update that existing line instead of appending.
  function addConfiguredToCart(snapshot) {
    const ctx = activeQuote?.productContext;
    const editingKey = activeQuote?.editingKey;
    if (editingKey) {
      setCart(prev => prev.map(x =>
        x.key === editingKey
          ? { ...x, config: snapshot, id: ctx?.id || x.id }
          : x
      ));
      setToast({ kind: 'ok', text: `Updated · ${snapshot.lineItem.title}` });
    } else {
      const key = 'cfg-' + Math.random().toString(36).slice(2, 9);
      setCart(prev => [
        ...prev,
        {
          key,
          id: ctx?.id || (snapshot.activeTab === 'bed' ? 'b-custom' : 's-custom'),
          qty: 1,
          config: snapshot,
        },
      ]);
      setToast({ kind: 'ok', text: `Added · ${snapshot.lineItem.title}` });
    }
    setActiveQuote(null);
    setStep('cart');
  }

  // Open Configurator scoped to an existing cart line so the salesperson can
  // change Size/options for that piece without re-adding it.
  function editCartLine(item) {
    const product = window.PRODUCTS.find(p => p.id === item.id);
    const cfg = item.config;
    const cat = product?.cat || (cfg?.activeTab === 'bed' ? 'bedframe' : cfg?.activeTab === 'mattress' ? 'mattress' : 'sofa');
    setActiveQuote({
      id: activeQuote?.id || 'NEW',
      customerName: customer?.name || 'Walk-in',
      productContext: product,
      editingKey: item.key,
      activeTab: cat === 'bedframe' ? 'bed' : cat === 'mattress' ? 'mattress' : 'sofa',
      lockTab: true,
      // hydrate prior selections
      sofa:     cfg?.activeTab === 'sofa'     ? cfg : undefined,
      bed:      cfg?.activeTab === 'bed'      ? cfg : undefined,
      mattress: cfg?.activeTab === 'mattress' ? cfg : undefined,
    });
    setStep('configure');
  }

  function newOrder() {
    setCart([]);
    setCustomer(EMPTY_CUSTOMER);
    setEmergency(EMPTY_EMERGENCY);
    setPayment(null);
    setDelivery(EMPTY_DELIVERY);
    setAddons([]);
    setStep('cart');
  }

  function saveQuote(overrideName) {
    if (cart.length === 0) return;
    // Customer name is required so quotes are findable later
    const name = (overrideName ?? customer?.name ?? '').trim();
    if (!name) {
      setNeedCustomerName(true);
      return;
    }
    const subtotal = cart.reduce((s, i) => s + i.qty * (i.config?.lineItem?.total ?? window.PRICE), 0);
    const cust = { ...customer, name };
    // Decide whether this Save UPDATES an existing quote or CREATES a new one.
    // Match priority:
    //   1. activeQuote.id is a real saved quote → that one
    //   2. otherwise, the most-recent quote saved for this customer name → update it
    //      (so pressing Save twice in the same session never duplicates)
    let existingId = null;
    if (activeQuote && activeQuote.id !== 'NEW' && quotes.some(x => x.id === activeQuote.id)) {
      existingId = activeQuote.id;
    } else {
      const lc = name.toLowerCase();
      const same = quotes.find(q => (q.customer?.name || '').trim().toLowerCase() === lc);
      if (same) existingId = same.id;
    }
    if (existingId) {
      setQuotes(prev => prev.map(x => x.id === existingId
        ? { ...x, cart: [...cart], customer: cust, subtotal, updatedAt: Date.now() }
        : x
      ));
      setToast({ kind: 'ok', text: `Quote ${existingId} updated · sent to Quotes` });
    } else {
      const id = 'Q-' + (1000 + quotes.length + 1);
      const q = { id, cart: [...cart], customer: cust, subtotal, savedAt: Date.now(), staff: staff?.name };
      setQuotes(prev => [q, ...prev]);
      setToast({ kind: 'ok', text: `Quote ${id} saved · ready for next customer` });
    }
    // Saving a quote archives this customer's order. Reset the workspace
    // so the salesperson can immediately help the next customer.
    setCart([]);
    setCustomer(EMPTY_CUSTOMER);
    setEmergency(EMPTY_EMERGENCY);
    setPayment(null);
    setDelivery(EMPTY_DELIVERY);
    setAddons([]);
    setActiveQuote(null);
  }

  function loadQuote(q) {
    // Tapping a saved quote returns to the Cart screen so the salesperson
    // can see exactly what was saved before deciding to re-configure.
    setCart(q.cart);
    setCustomer({ ...EMPTY_CUSTOMER, ...q.customer });
    setActiveQuote({
      ...q,
      customerName: q.customer?.name || 'Walk-in',
      // keep saved config available if they choose to reopen the configurator
      activeTab: q.config?.activeTab,
      sofa: q.config?.sofa,
      bed:  q.config?.bed,
    });
    setShowQuotes(false);
    setStep('cart');
    setToast({ kind: 'ok', text: `Opened ${q.id}` });
  }

  function configureNew() {
    // Allow opening the configurator for the current cart (no saved quote yet)
    setActiveQuote({
      id: 'NEW',
      customerName: customer?.name || 'Walk-in',
    });
    setStep('configure');
  }

  function onConfiguratorSave(snapshot) {
    // Persist the configuration onto the active quote (or create one)
    if (activeQuote && activeQuote.id !== 'NEW') {
      setQuotes(prev => prev.map(q => q.id === activeQuote.id ? { ...q, config: snapshot, total: snapshot.lineItem.total } : q));
      setToast({ kind: 'ok', text: `${activeQuote.id} updated` });
    } else {
      const id = 'Q-' + (1000 + quotes.length + 1);
      setQuotes(prev => [{
        id, cart: [...cart], customer: { ...customer },
        subtotal: snapshot.lineItem.total, total: snapshot.lineItem.total,
        config: snapshot, savedAt: Date.now(), staff: staff?.name,
      }, ...prev]);
      setToast({ kind: 'ok', text: `Quote ${id} saved` });
    }
    setActiveQuote(null);
    setStep('cart');
  }

  function onConfiguratorConvert(snapshot) {
    // Convert a configured quote into a Sales Order (proceed to handover).
    // We keep the quote.id on activeQuote so handover's onComplete can purge
    // the source quote once the order is finalised.
    if (activeQuote && activeQuote.id !== 'NEW') {
      setQuotes(prev => prev.map(q => q.id === activeQuote.id ? { ...q, config: snapshot, total: snapshot.lineItem.total, status: 'converting' } : q));
    }
    setStep('handover');
  }

  function deleteQuote(id) {
    setQuotes(prev => prev.filter(q => q.id !== id));
  }

  function generateOrder() {
    if (cart.length === 0) return;
    setStep('handover');
  }

  // Called when the handover flow finishes (signature → ConfirmScreen).
  // If this customer journey originated from a saved quote, retire that quote
  // so it doesn't linger in the Quotes drawer.
  function onHandoverComplete(payload = {}) {
    const sourceQuoteId = activeQuote && activeQuote.id !== 'NEW' && quotes.some(x => x.id === activeQuote.id)
      ? activeQuote.id
      : null;
    // Also catch the case where the user loaded a quote into the cart and went
    // straight to handover (no Configurator step) — match by customer name.
    let matchedId = sourceQuoteId;
    if (!matchedId && customer?.name) {
      const lc = customer.name.trim().toLowerCase();
      const same = quotes.find(q => (q.customer?.name || '').trim().toLowerCase() === lc);
      if (same) matchedId = same.id;
    }
    if (matchedId) setQuotes(prev => prev.filter(q => q.id !== matchedId));

    // Push the finished order to the Backend portal via the localStorage
    // bridge so the Order Coordinator sees it land in 01 · Order received.
    if (window.pushOrderToBackend) {
      try {
        window.pushOrderToBackend({
          cart, customer, emergency, delivery, payment, addons, staff,
          paidAmount: payload.paidAmount,
          approvalCode: payload.approvalCode,
          slipDataUrl: payload.slipDataUrl,
          total: payload.total,
          addonTotal: payload.addonTotal,
          subtotal: payload.subtotal,
        });
        setToast({ kind: 'ok', text: 'Order sent to backend coordinator' });
      } catch (e) { /* ignore */ }
    }

    setStep('confirm');
  }

  const subtotal = cart.reduce((s, i) => s + i.qty * (i.config?.lineItem?.total ?? window.PRICE), 0);
  const addonTotal = addons.reduce((s, id) => s + (window.ADDONS.find(a => a.id === id)?.price || 0), 0);
  const total = subtotal + addonTotal;

  return (
    <div className="pos-root">
      <window.Topbar
        step={step}
        staff={staff}
        cartCount={cart.reduce((s,i)=>s+i.qty,0)}
        quotesCount={quotes.length}
        onShowQuotes={() => setShowQuotes(true)}
        orderStatusUnlocked={orderStatusUnlocked}
        onOrderStatus={() => {
          if (step === 'order-status') { setStep('cart'); return; }
          if (orderStatusUnlocked) { setStep('order-status'); }
          else { setShowPinGate(true); }
        }}
        onLogout={() => { window.location.href = 'login.html'; }}
        onBack={step === 'handover' ? () => setStep(activeQuote ? 'configure' : 'cart') : null}
      />

      {step === 'login' && (
        <div className="page-shell" key="login">
          <window.LoginScreen onLogin={(s) => { setStaff(s); setStep('cart'); }} />
        </div>
      )}

      {step === 'cart' && (
        <div className="page-shell" key="cart">
          <window.CatalogScreen
            cart={cart}
            customer={customer}
            density={tweaks.density}
            onAdd={add}
            onConfigure={configureProduct}
            onEditLine={editCartLine}
            onRemove={remove}
            onSetQty={setQty}
            onClearCart={clearCart}
            onSaveQuote={saveQuote}
            onGenerateOrder={generateOrder}
          />
        </div>
      )}

      {step === 'configure' && (
        <div className="page-shell" key="configure">
          <window.ConfiguratorScreen
            quote={activeQuote}
            onBack={() => { setActiveQuote(null); setStep('cart'); }}
            onAddToCart={addConfiguredToCart}
            onSaveAndClose={onConfiguratorSave}
            onConvertToOrder={onConfiguratorConvert}
          />
        </div>
      )}

      {step === 'handover' && (
        <div className="page-shell" key="handover">
          <window.HandoverScreen
            cart={cart}
            staff={staff}
            customer={customer}
            onCustomerChange={setCustomer}
            emergency={emergency}
            onEmergencyChange={setEmergency}
            payment={payment}
            onPaymentChange={setPayment}
            delivery={delivery}
            onDeliveryChange={setDelivery}
            addons={addons}
            onAddonsChange={setAddons}
            onComplete={(payload) => onHandoverComplete(payload)}
            onBack={() => setStep('cart')}
          />
        </div>
      )}

      {step === 'confirm' && (
        <div className="page-shell" key="confirm">
          <window.ConfirmScreen
            cart={cart}
            customer={customer}
            delivery={delivery}
            payment={payment}
            total={total}
            staff={staff}
            addons={addons}
            onNew={newOrder}
          />
        </div>
      )}

      {step === 'order-status' && (
        <div className="page-shell" key="order-status">
          <window.OrderStatusScreen
            orders={orders}
            staff={staff}
            onUpdate={(o) => setOrders(prev => prev.map(x => x.id === o.id ? o : x))}
            onBack={() => setStep('cart')}
          />
        </div>
      )}

      {showPinGate && (
        <window.PinGate
          onUnlock={() => { setOrderStatusUnlocked(true); setShowPinGate(false); setStep('order-status'); }}
          onCancel={() => setShowPinGate(false)}
        />
      )}

      {needCustomerName && (
        <div className="cn-modal__backdrop" onClick={() => setNeedCustomerName(false)}>
          <div className="cn-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label="Customer name">
            <div className="cn-modal__eyebrow">Save quote</div>
            <h3 className="cn-modal__title">Who is this quote for?</h3>
            <p className="cn-modal__sub">A customer name is required so you can find this quote later.</p>
            <input
              className="cn-modal__input"
              autoFocus
              placeholder="Customer name"
              value={pendingCustomerName}
              onChange={e => setPendingCustomerName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && pendingCustomerName.trim()) {
                  const n = pendingCustomerName.trim();
                  setCustomer(c => ({ ...c, name: n }));
                  setNeedCustomerName(false);
                  setPendingCustomerName('');
                  setTimeout(() => saveQuote(n), 0);
                }
                if (e.key === 'Escape') setNeedCustomerName(false);
              }}
            />
            <div className="cn-modal__cta">
              <button className="btn btn--ghost" onClick={() => { setNeedCustomerName(false); setPendingCustomerName(''); }}>Cancel</button>
              <button
                className="btn btn--primary"
                disabled={!pendingCustomerName.trim()}
                onClick={() => {
                  const n = pendingCustomerName.trim();
                  if (!n) return;
                  setCustomer(c => ({ ...c, name: n }));
                  setNeedCustomerName(false);
                  setPendingCustomerName('');
                  setTimeout(() => saveQuote(n), 0);
                }}
              >Save quote</button>
            </div>
          </div>
        </div>
      )}

      {showQuotes && (
        <window.QuotesDrawer
          quotes={quotes}
          onClose={() => setShowQuotes(false)}
          onLoad={loadQuote}
          onDelete={deleteQuote}
        />
      )}

      {toast && (
        <div className={`toast toast--${toast.kind}`}>
          <i data-lucide={toast.kind === 'ok' ? 'check-circle-2' : 'info'}></i>
          <span>{toast.text}</span>
        </div>
      )}

      {/* Tweaks Panel */}
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
        <window.TweakSection title="Catalog">
          <window.TweakRadio
            label="Card density"
            value={tweaks.density}
            options={[
              { value: 'calm',    label: 'Calm' },
              { value: 'compact', label: 'Compact' },
            ]}
            onChange={v => setTweak('density', v)}
          />
        </window.TweakSection>
        <window.TweakSection title="Backend testimony">
          <window.TweakButton onClick={() => {
            // Push a fully-fleshed sample order straight into the backend bridge
            if (!window.pushOrderToBackend) return;
            const sampleStaff = staff || window.STAFF[0];
            const sampleCart = [
              { id: 's-noor', qty: 1 },
              { id: 'm-cloud', qty: 1 },
              { id: 'a-rug', qty: 1 },
            ];
            window.pushOrderToBackend({
              cart: sampleCart,
              customer: { name: 'Lim Wei Ling', phone: '+60 12 345 6789', email: 'weiling@example.com', address: 'A-12-3, Mont Kiara Aman', postcode: '50480', city: 'Kuala Lumpur', state: 'KL' },
              emergency: { name: 'Lim Mei Hua', phone: '+60 19 222 3344', relation: 'Spouse' },
              delivery: { date: new Date(2026, 4, 11), slot: '12:00 – 15:00', notes: 'Lift available, call on arrival.' },
              payment: 'credit',
              addons: [{ id: 'dispose-mattress', qty: 1 }, { id: 'lift', floors: 5, items: 2 }],
              staff: sampleStaff,
              paidAmount: 4485, approvalCode: 'AC-' + Math.floor(1000000 + Math.random() * 9000000),
              total: 8970 + 270, addonTotal: 270, subtotal: 8970,
            });
            setToast({ kind: 'ok', text: 'Sample order sent to backend' });
          }}>
            <i data-lucide="send" style={{ width: 14, height: 14, marginRight: 6, verticalAlign: '-2px' }}></i>
            Send sample order
          </window.TweakButton>
          <window.TweakButton onClick={() => {
            window.clearBridgeOrders && window.clearBridgeOrders();
            setToast({ kind: 'ok', text: 'Backend orders cleared' });
          }}>
            <i data-lucide="trash-2" style={{ width: 14, height: 14, marginRight: 6, verticalAlign: '-2px' }}></i>
            Clear backend orders
          </window.TweakButton>
          <window.TweakButton onClick={() => { window.open('backend.html', '_blank'); }}>
            <i data-lucide="external-link" style={{ width: 14, height: 14, marginRight: 6, verticalAlign: '-2px' }}></i>
            Open backend portal
          </window.TweakButton>
        </window.TweakSection>
        <window.TweakSection title="Demo">
          <window.TweakButton onClick={() => {
            setCart([
              { key: 's-noor', id: 's-noor', qty: 1 },
              { key: 'm-cloud', id: 'm-cloud', qty: 1 },
              { key: 'a-rug', id: 'a-rug', qty: 1 },
            ]);
            setCustomer({ ...EMPTY_CUSTOMER, name: 'Lim Wei Ling', phone: '+60 12 345 6789', email: 'weiling@example.com', address: 'A-12-3, Mont Kiara Aman, Jalan Kiara 3', postcode: '50480', city: 'Kuala Lumpur', state: 'Kuala Lumpur' });
            setEmergency({ name: 'Lim Mei Hua', phone: '+60 19 222 3344', relation: 'Spouse' });
            setDelivery({ date: new Date(2026, 4, 11), slot: '12:00 – 15:00', notes: 'Lift available, call on arrival.' });
            setPayment('credit');
            setAddons([{ id: 'dispose-mattress', qty: 1 }, { id: 'dispose-bedframe', qty: 1 }, { id: 'lift', floors: 5, items: 2 }]);
            if (!staff) setStaff(window.STAFF[0]);
            setStep('cart');
          }}>
            <i data-lucide="wand-2" style={{ width: 14, height: 14, marginRight: 6, verticalAlign: '-2px' }}></i>
            Pre-fill demo order
          </window.TweakButton>
          <window.TweakButton onClick={() => {
            const id = 'Q-' + (1000 + quotes.length + 1);
            setQuotes(prev => [
              { id, cart: [{ key: 's-tanah', id: 's-tanah', qty: 1 }, { key: 'a-coffee', id: 'a-coffee', qty: 1 }], customer: { ...EMPTY_CUSTOMER, name: 'Daniel Chong', phone: '+60 16 778 1212' }, subtotal: 2 * window.PRICE, savedAt: Date.now() - 86400000, staff: 'Aisyah Wong', config: { activeTab: 'sofa', sofa: { mode: 'custom', partIds: ['arm-l', 'seat-2', 'corner', 'seat-1', 'arm-r'], cushions: 4, fabricId: 'forest' }, bed: { sizeId: 'queen', styleId: 'panel', colourId: 'oak' } } },
              { id: 'Q-' + (1000 + quotes.length + 2), cart: [{ key: 'b-tenun', id: 'b-tenun', qty: 1 }, { key: 'm-oak', id: 'm-oak', qty: 1 }, { key: 'a-throw', id: 'a-throw', qty: 2 }], config: { activeTab: 'bed', sofa: { mode: 'display', partIds: ['arm-l','seat-2','corner','arm-r'], cushions: 3, fabricId: 'oat' }, bed: { sizeId: 'king', styleId: 'wing', colourId: 'walnut' } }, customer: { ...EMPTY_CUSTOMER, name: 'Priya Naidu', phone: '+60 12 901 5544' }, subtotal: 4 * window.PRICE, savedAt: Date.now() - 172800000, staff: 'Jia Ming Tan' },
              ...prev,
            ]);
            setToast({ kind: 'ok', text: 'Seeded 2 demo quotes' });
          }}>
            <i data-lucide="bookmark-plus" style={{ width: 14, height: 14, marginRight: 6, verticalAlign: '-2px' }}></i>
            Seed demo quotes
          </window.TweakButton>
          <window.TweakButton onClick={() => {
            setStaff(window.STAFF[0]);
            setStep('cart');
            clearCart();
          }}>
            <i data-lucide="key" style={{ width: 14, height: 14, marginRight: 6, verticalAlign: '-2px' }}></i>
            Skip login
          </window.TweakButton>
        </window.TweakSection>
      </window.TweaksPanel>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
