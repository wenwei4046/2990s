// 2990's POS — Order Status page
// PIN-gated (6-digit) screen with three lanes:
//   1. Place Order   — placed, but delivery date / address still TBD
//   2. Proceed Order — fully confirmed (info complete, ≥50% paid, address + date set)
//   3. Delivered     — handled by the backend portal (read-only callout)
//
// The PIN gate exists because this view exposes customer details and pricing,
// which can be visible to walk-in customers if a salesperson leaves the
// tablet on the showroom counter.

const { useState: useStateOS, useEffect: useEffectOS, useMemo: useMemoOS } = React;

const ORDER_STATUS_PIN = '299000'; // demo

// ---------- Sample order seed ----------
function seedSampleOrders() {
  const today = new Date();
  const d = (offset) => { const x = new Date(today); x.setDate(x.getDate() + offset); return x; };
  return [
    {
      id: 'SO-2041',
      placedAt: d(-12).getTime(),
      staff: 'Aisyah Wong',
      lane: 'place',
      customer: { name: 'Tan Wei Han', phone: '+60 12 345 6789', email: 'weihan@example.com', address: '', postcode: '', city: '', state: 'Selangor' },
      cart: [{ id: 's-noor', qty: 1 }, { id: 'a-rug', qty: 1 }],
      subtotal: 5980,
      paid: 2990,
      delivery: { date: null, slot: null, tbd: true, addressLater: true },
      flags: ['Further notice for delivery date', 'Further notice for delivery address'],
    },
    {
      id: 'SO-2042',
      placedAt: d(-9).getTime(),
      staff: 'Jia Ming Tan',
      lane: 'place',
      customer: { name: 'Priya Naidu', phone: '+60 19 876 5432', email: '', address: 'Lot 14, Jalan Damansara', postcode: '50490', city: 'Kuala Lumpur', state: 'KL' },
      cart: [{ id: 'b-tenun', qty: 1 }, { id: 'm-oak', qty: 1 }],
      subtotal: 5980,
      paid: 1500,
      delivery: { date: null, slot: null, tbd: true },
      flags: ['Further notice for delivery date'],
    },
    {
      id: 'SO-2038',
      placedAt: d(-21).getTime(),
      staff: 'Aisyah Wong',
      lane: 'proceed',
      customer: { name: 'Lim Wei Ling', phone: '+60 12 222 3344', email: 'weiling@example.com', address: 'A-12-3, Mont Kiara Aman, Jalan Kiara 3', postcode: '50480', city: 'Kuala Lumpur', state: 'KL' },
      cart: [{ id: 's-tanah', qty: 1 }, { id: 'a-coffee', qty: 1 }, { id: 'a-cushion', qty: 1 }],
      subtotal: 8970,
      paid: 8970,
      delivery: { date: d(7), slot: '12:00 – 15:00' },
      flags: [],
    },
    {
      id: 'SO-2039',
      placedAt: d(-18).getTime(),
      staff: 'Rafiq Lim',
      lane: 'proceed',
      customer: { name: 'Daniel Chong', phone: '+60 16 778 1212', email: 'daniel@example.com', address: '8, Jalan SS2/24, Petaling Jaya', postcode: '47300', city: 'Petaling Jaya', state: 'Selangor' },
      cart: [{ id: 'b-kayu', qty: 1 }, { id: 'm-cloud', qty: 1 }],
      subtotal: 5980,
      paid: 4500,
      delivery: { date: d(3), slot: '09:00 – 12:00' },
      flags: [],
    },
    {
      id: 'SO-2031',
      placedAt: d(-40).getTime(),
      staff: 'Sarah Nurul',
      lane: 'delivered',
      customer: { name: 'Aaron Yeo', phone: '+60 13 555 1010' },
      cart: [{ id: 'm-linen', qty: 2 }],
      subtotal: 5980,
      paid: 5980,
      delivery: { date: d(-2), slot: '15:00 – 18:00' },
      flags: [],
      deliveredAt: d(-2).getTime(),
    },
  ];
}

// ---------- PIN Gate ----------
function PinGate({ onUnlock, onCancel }) {
  const [pin, setPin] = useStateOS('');
  const [err, setErr] = useStateOS(false);
  window.useLucide([pin, err]);

  function press(k) {
    setErr(false);
    if (k === 'del') return setPin(p => p.slice(0, -1));
    if (k === 'clr') return setPin('');
    if (pin.length >= 6) return;
    setPin(p => p + k);
  }

  useEffectOS(() => {
    if (pin.length === 6) {
      if (pin === ORDER_STATUS_PIN) {
        setTimeout(() => onUnlock(), 200);
      } else {
        setErr(true);
        setTimeout(() => { setPin(''); setErr(false); }, 700);
      }
    }
  }, [pin]);

  return (
    <div className="pin-gate">
      <div className="pin-gate__card">
        <button className="icon-btn pin-gate__close" onClick={onCancel} aria-label="Close">
          <i data-lucide="x"></i>
        </button>
        <div className="pin-gate__icon">
          <i data-lucide="lock"></i>
        </div>
        <div className="pin-gate__eyebrow">Restricted view</div>
        <h2 className="pin-gate__title">Enter passcode</h2>
        <p className="pin-gate__sub">
          Order Status contains customer details and pricing. Enter the 6-digit
          showroom passcode to continue.
        </p>

        <div className={`pin-gate__dots ${err ? 'is-err' : ''}`}>
          {[0,1,2,3,4,5].map(i => (
            <span key={i} className={`pin-gate__dot ${err ? 'is-err' : pin.length > i ? 'is-on' : ''}`}></span>
          ))}
        </div>

        <div className="pin-gate__pad">
          {['1','2','3','4','5','6','7','8','9'].map(k => (
            <button key={k} className="pin-gate__key" onClick={() => press(k)}>{k}</button>
          ))}
          <button className="pin-gate__key pin-gate__key--util" onClick={() => press('clr')}>Clear</button>
          <button className="pin-gate__key" onClick={() => press('0')}>0</button>
          <button className="pin-gate__key pin-gate__key--util" onClick={() => press('del')}>
            <i data-lucide="delete"></i>
          </button>
        </div>

        <div className="pin-gate__hint">Hint · 299000</div>
      </div>
    </div>
  );
}

// ---------- Helpers ----------
function fmtDate(d) {
  if (!d) return '—';
  const x = d instanceof Date ? d : new Date(d);
  return x.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
}
function daysAgo(ms) {
  const diff = Math.floor((Date.now() - ms) / 86400000);
  if (diff <= 0) return 'today';
  if (diff === 1) return '1 day ago';
  return `${diff} days ago`;
}
function pieceCount(cart) { return cart.reduce((s, i) => s + i.qty, 0); }
function paidPct(o) { return Math.min(100, Math.round((o.paid / o.subtotal) * 100)); }

// Conditions to be eligible for Proceed lane
function checkConditions(o) {
  const c = o.customer || {};
  const customerInfoOk = !!(c.name && c.phone && c.email);
  const addressOk = !!(c.address && c.postcode);
  const paidOk = o.paid / o.subtotal >= 0.5;
  const dateOk = !!(o.delivery && o.delivery.date);
  return {
    customerInfoOk, addressOk, paidOk, dateOk,
    allOk: customerInfoOk && addressOk && paidOk && dateOk,
  };
}

// ---------- Order Card ----------
function OrderCard({ order, onOpen }) {
  const cond = checkConditions(order);
  const pct = paidPct(order);
  const pieces = pieceCount(order.cart);
  const firstItem = order.cart[0];
  const product = firstItem ? window.PRODUCTS.find(p => p.id === firstItem.id) : null;

  return (
    <button className={`os-card os-card--${order.lane}`} onClick={() => onOpen(order)}>
      <div className="os-card__head">
        <div>
          <div className="os-card__id">{order.id}</div>
          <div className="os-card__name">{order.customer?.name || 'Walk-in'}</div>
        </div>
        <div className="os-card__photo" style={product?.img ? { backgroundImage: `url(${product.img})` } : null}>
          {pieces > 1 && <span className="os-card__count">×{pieces}</span>}
        </div>
      </div>

      <div className="os-card__total">
        <span className="os-card__total-num"><sup>RM</sup>{order.subtotal.toLocaleString('en-MY')}</span>
        <span className="os-card__total-paid">{pct}% paid</span>
      </div>
      <div className="os-card__bar">
        <span className="os-card__bar-fill" style={{ width: pct + '%', background: pct >= 50 ? 'var(--c-orange)' : '#C5806B' }}></span>
      </div>

      <div className="os-card__rows">
        <div className="os-card__row">
          <i data-lucide="calendar"></i>
          <span>{order.delivery?.date ? fmtDate(order.delivery.date) : 'Date TBD'}</span>
        </div>
        <div className="os-card__row">
          <i data-lucide="map-pin"></i>
          <span>{order.customer?.address ? (order.customer.city || order.customer.address.slice(0, 28)) : 'Address TBD'}</span>
        </div>
      </div>

      {order.flags && order.flags.length > 0 && (
        <div className="os-card__flags">
          {order.flags.map((f, i) => (
            <span key={i} className="os-card__flag">
              <i data-lucide="alert-circle"></i>{f}
            </span>
          ))}
        </div>
      )}

      {order.lane === 'place' && (
        <div className={`os-card__readiness ${cond.allOk ? 'is-ready' : ''}`}>
          {cond.allOk ? (
            <><i data-lucide="check-circle-2"></i>Ready to proceed</>
          ) : (
            <><i data-lucide="circle-dashed"></i>Awaiting info</>
          )}
        </div>
      )}

      <div className="os-card__foot">
        <span>{order.staff}</span>
        <span>{daysAgo(order.placedAt)}</span>
      </div>
    </button>
  );
}

// ---------- Order Detail Drawer ----------
function OrderDetail({ order, onClose, onProceed, onUpdate }) {
  const [edited, setEdited] = useStateOS(order);
  useEffectOS(() => setEdited(order), [order?.id]);
  window.useLucide([edited, order?.id]);
  if (!order) return null;
  const cond = checkConditions(edited);
  const pct = paidPct(edited);

  function set(path, value) {
    setEdited(prev => {
      const next = { ...prev };
      const keys = path.split('.');
      let cur = next;
      for (let i = 0; i < keys.length - 1; i++) {
        cur[keys[i]] = { ...cur[keys[i]] };
        cur = cur[keys[i]];
      }
      cur[keys[keys.length - 1]] = value;
      return next;
    });
  }

  function save() {
    onUpdate(edited);
  }

  function tryProceed() {
    if (!cond.allOk) return;
    onUpdate({ ...edited, lane: 'proceed', flags: [] });
    onProceed && onProceed(edited.id);
  }

  return (
    <div className="os-detail-overlay" onClick={onClose}>
      <aside className="os-detail" onClick={e => e.stopPropagation()}>
        <div className="os-detail__head">
          <div>
            <div className="os-detail__eyebrow">Order · {edited.lane === 'place' ? 'Place' : edited.lane === 'proceed' ? 'Proceed' : 'Delivered'}</div>
            <div className="os-detail__title">{edited.id}</div>
            <div className="os-detail__sub">{edited.customer?.name} · placed {daysAgo(edited.placedAt)} by {edited.staff}</div>
          </div>
          <button className="icon-btn" onClick={onClose}><i data-lucide="x"></i></button>
        </div>

        <div className="os-detail__body">
          {/* Items */}
          <section className="os-section">
            <h4 className="os-section__title">Items <span>{pieceCount(edited.cart)} pieces</span></h4>
            <div className="os-items">
              {edited.cart.map((it, i) => {
                const p = window.PRODUCTS.find(x => x.id === it.id);
                if (!p) return null;
                return (
                  <div key={i} className="os-item">
                    <div className="os-item__photo" style={{ backgroundImage: `url(${p.img})` }}></div>
                    <div className="os-item__body">
                      <div className="os-item__name">{p.name}</div>
                      <div className="os-item__detail">{p.size} · {p.sku}</div>
                    </div>
                    <div className="os-item__qty">×{it.qty}</div>
                    <div className="os-item__price"><sup>RM</sup>{(it.qty * window.PRICE).toLocaleString('en-MY')}</div>
                  </div>
                );
              })}
            </div>
            <div className="os-items__total">
              <span>Subtotal</span>
              <span><sup>RM</sup>{edited.subtotal.toLocaleString('en-MY')}</span>
            </div>
          </section>

          {/* Customer */}
          <section className="os-section">
            <h4 className="os-section__title">
              Customer
              {cond.customerInfoOk
                ? <span className="os-tick"><i data-lucide="check"></i>Complete</span>
                : <span className="os-tick is-bad"><i data-lucide="alert-triangle"></i>Incomplete</span>}
            </h4>
            <div className="os-grid">
              <label className="os-field"><span>Full name</span>
                <input value={edited.customer?.name || ''} onChange={e => set('customer.name', e.target.value)} disabled={edited.lane !== 'place'} />
              </label>
              <label className="os-field"><span>Phone</span>
                <input value={edited.customer?.phone || ''} onChange={e => set('customer.phone', e.target.value)} disabled={edited.lane !== 'place'} />
              </label>
              <label className="os-field os-field--span"><span>Email</span>
                <input value={edited.customer?.email || ''} onChange={e => set('customer.email', e.target.value)} placeholder="customer@example.com" disabled={edited.lane !== 'place'} />
              </label>
            </div>
          </section>

          {/* Delivery */}
          <section className="os-section">
            <h4 className="os-section__title">
              Delivery
              {cond.addressOk && cond.dateOk
                ? <span className="os-tick"><i data-lucide="check"></i>Set</span>
                : <span className="os-tick is-bad"><i data-lucide="alert-triangle"></i>Missing</span>}
            </h4>
            <div className="os-grid">
              <label className="os-field os-field--span"><span>Delivery address</span>
                <textarea value={edited.customer?.address || ''} onChange={e => set('customer.address', e.target.value)} placeholder="Unit, street, area" disabled={edited.lane !== 'place'} />
              </label>
              <label className="os-field"><span>Postcode</span>
                <input value={edited.customer?.postcode || ''} onChange={e => set('customer.postcode', e.target.value)} disabled={edited.lane !== 'place'} />
              </label>
              <label className="os-field"><span>City</span>
                <input value={edited.customer?.city || ''} onChange={e => set('customer.city', e.target.value)} disabled={edited.lane !== 'place'} />
              </label>
              <label className="os-field os-field--span"><span>Delivery date</span>
                <input
                  type="date"
                  value={edited.delivery?.date ? new Date(edited.delivery.date).toISOString().slice(0,10) : ''}
                  onChange={e => set('delivery', { ...edited.delivery, date: e.target.value ? new Date(e.target.value) : null, tbd: !e.target.value })}
                  disabled={edited.lane !== 'place'}
                />
              </label>
            </div>
          </section>

          {/* Payment */}
          <section className="os-section">
            <h4 className="os-section__title">
              Payment
              {cond.paidOk
                ? <span className="os-tick"><i data-lucide="check"></i>≥ 50% paid</span>
                : <span className="os-tick is-bad"><i data-lucide="alert-triangle"></i>Below 50%</span>}
            </h4>
            <div className="os-pay">
              <div className="os-pay__row">
                <span>Paid so far</span>
                <span><sup>RM</sup>{edited.paid.toLocaleString('en-MY')} <em>/ {edited.subtotal.toLocaleString('en-MY')}</em></span>
              </div>
              <div className="os-pay__bar">
                <span className="os-pay__bar-fill" style={{ width: pct + '%' }}></span>
                <span className="os-pay__bar-mark" title="50% threshold"></span>
              </div>
              <div className="os-pay__legend">
                <span>{pct}% collected</span>
                <span>Threshold · 50%</span>
              </div>
              {edited.lane === 'place' && (
                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <label className="os-field">
                    <span>Record additional payment (RM)</span>
                    <input
                      type="number"
                      placeholder="0"
                      onChange={e => {
                        const v = parseFloat(e.target.value) || 0;
                        set('paid', Math.min(edited.subtotal, edited.paid + v));
                      }}
                    />
                  </label>
                  <label className="os-field">
                    <span>Approval code</span>
                    <input
                      type="text"
                      placeholder="e.g. AC-7821934"
                      value={edited.approvalCode || ''}
                      onChange={e => set('approvalCode', e.target.value)}
                    />
                  </label>
                  <div className="os-field">
                    <span>Payment slip</span>
                    {edited.slipPhoto ? (
                      <div className="os-slip">
                        <img src={edited.slipPhoto} alt="Payment slip" />
                        <button className="os-slip__remove" onClick={() => set('slipPhoto', null)} aria-label="Remove">
                          <i data-lucide="x"></i>
                        </button>
                        <span className="os-slip__badge">
                          <i data-lucide="check-circle-2"></i>Attached
                        </span>
                      </div>
                    ) : (
                      <div className="os-slip__actions">
                        <label className="os-slip__btn">
                          <i data-lucide="paperclip"></i>
                          <span>Attach file</span>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={e => {
                              const f = e.target.files?.[0];
                              if (!f) return;
                              const r = new FileReader();
                              r.onload = ev => set('slipPhoto', ev.target.result);
                              r.readAsDataURL(f);
                            }}
                          />
                        </label>
                        <label className="os-slip__btn os-slip__btn--cam">
                          <i data-lucide="camera"></i>
                          <span>Open camera</span>
                          <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            onChange={e => {
                              const f = e.target.files?.[0];
                              if (!f) return;
                              const r = new FileReader();
                              r.onload = ev => set('slipPhoto', ev.target.result);
                              r.readAsDataURL(f);
                            }}
                          />
                        </label>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Footer — Proceed action with condition checklist */}
        {edited.lane === 'place' && (
          <div className="os-detail__foot">
            <div className="os-checklist">
              <span className={`os-check ${cond.customerInfoOk ? 'is-ok' : ''}`}>
                <i data-lucide={cond.customerInfoOk ? 'check' : 'circle'}></i>Customer info
              </span>
              <span className={`os-check ${cond.addressOk ? 'is-ok' : ''}`}>
                <i data-lucide={cond.addressOk ? 'check' : 'circle'}></i>Delivery address
              </span>
              <span className={`os-check ${cond.dateOk ? 'is-ok' : ''}`}>
                <i data-lucide={cond.dateOk ? 'check' : 'circle'}></i>Delivery date
              </span>
              <span className={`os-check ${cond.paidOk ? 'is-ok' : ''}`}>
                <i data-lucide={cond.paidOk ? 'check' : 'circle'}></i>≥ 50% paid
              </span>
            </div>
            <div className="os-detail__cta">
              <button className="btn btn--ghost" onClick={save}>
                <i data-lucide="save"></i>Save changes
              </button>
              <button className="btn btn--primary" disabled={!cond.allOk} onClick={tryProceed}>
                Move to Proceed<i data-lucide="arrow-right"></i>
              </button>
            </div>
          </div>
        )}

        {edited.lane === 'proceed' && (
          <div className="os-detail__foot os-detail__foot--info">
            <i data-lucide="info"></i>
            Order is locked. Delivery is being scheduled — backend portal will pick this up on dispatch day.
          </div>
        )}

        {edited.lane === 'delivered' && (
          <div className="os-detail__foot os-detail__foot--info">
            <i data-lucide="package-check"></i>
            Delivered {fmtDate(edited.deliveredAt)}. Managed in backend portal.
          </div>
        )}
      </aside>
    </div>
  );
}

// ---------- Order Status Screen ----------
function OrderStatusScreen({ orders, onUpdate, onBack, staff }) {
  const [active, setActive] = useStateOS(null);
  const [query, setQuery] = useStateOS('');
  window.useLucide([orders.length, active?.id, query]);

  const lanes = useMemoOS(() => {
    const q = query.toLowerCase();
    const match = (o) => !q || o.id.toLowerCase().includes(q) || (o.customer?.name || '').toLowerCase().includes(q);
    return {
      place:     orders.filter(o => o.lane === 'place' && match(o)),
      proceed:   orders.filter(o => o.lane === 'proceed' && match(o)),
      delivered: orders.filter(o => o.lane === 'delivered' && match(o)),
    };
  }, [orders, query]);

  // Keep the active drawer in sync with updates flowing through onUpdate
  useEffectOS(() => {
    if (!active) return;
    const fresh = orders.find(o => o.id === active.id);
    if (fresh && fresh !== active) setActive(fresh);
  }, [orders]);

  const totalValue = orders.reduce((s, o) => s + o.subtotal, 0);
  const collected  = orders.reduce((s, o) => s + o.paid, 0);

  return (
    <div className="os-page">
      <div className="os-toolbar">
        <div className="os-toolbar__left">
          <button className="icon-btn" onClick={onBack} aria-label="Back">
            <i data-lucide="arrow-left"></i>
          </button>
          <div>
            <div className="os-toolbar__eyebrow">
              <i data-lucide="lock-open"></i>Restricted · unlocked by {staff?.name || 'staff'}
            </div>
            <h1 className="os-toolbar__title">Order Status</h1>
          </div>
        </div>
        <div className="os-toolbar__right">
          <div className="os-search">
            <i data-lucide="search"></i>
            <input placeholder="Order ID or customer…" value={query} onChange={e => setQuery(e.target.value)} />
          </div>
          <div className="os-stat">
            <div className="os-stat__num">{orders.length}</div>
            <div className="os-stat__lbl">orders</div>
          </div>
          <div className="os-stat">
            <div className="os-stat__num"><sup>RM</sup>{totalValue.toLocaleString('en-MY')}</div>
            <div className="os-stat__lbl">value</div>
          </div>
          <div className="os-stat">
            <div className="os-stat__num"><sup>RM</sup>{collected.toLocaleString('en-MY')}</div>
            <div className="os-stat__lbl">collected</div>
          </div>
        </div>
      </div>

      <div className="os-board">
        {/* Place Order */}
        <div className="os-lane os-lane--place">
          <div className="os-lane__head">
            <div className="os-lane__num">01</div>
            <div>
              <div className="os-lane__title">Place Order</div>
              <div className="os-lane__sub">Paid, but timing or address still being confirmed</div>
            </div>
            <span className="os-lane__count">{lanes.place.length}</span>
          </div>
          <div className="os-lane__body">
            {lanes.place.length === 0 ? (
              <div className="os-empty">
                <i data-lucide="inbox"></i>
                <p>No pending orders. New sales will appear here.</p>
              </div>
            ) : lanes.place.map(o => <OrderCard key={o.id} order={o} onOpen={setActive} />)}
          </div>
        </div>

        {/* Proceed Order */}
        <div className="os-lane os-lane--proceed">
          <div className="os-lane__head">
            <div className="os-lane__num">02</div>
            <div>
              <div className="os-lane__title">Proceed Order</div>
              <div className="os-lane__sub">All info captured, ≥50% paid, delivery date locked</div>
            </div>
            <span className="os-lane__count">{lanes.proceed.length}</span>
          </div>
          <div className="os-lane__body">
            {lanes.proceed.length === 0 ? (
              <div className="os-empty">
                <i data-lucide="package-2"></i>
                <p>Move an order from Place once details are confirmed.</p>
              </div>
            ) : lanes.proceed.map(o => <OrderCard key={o.id} order={o} onOpen={setActive} />)}
          </div>
        </div>

        {/* Delivered */}
        <div className="os-lane os-lane--delivered">
          <div className="os-lane__head">
            <div className="os-lane__num">03</div>
            <div>
              <div className="os-lane__title">Delivered</div>
              <div className="os-lane__sub">Handled by backend · read-only here</div>
            </div>
            <span className="os-lane__count">{lanes.delivered.length}</span>
          </div>
          <div className="os-lane__backend">
            <i data-lucide="external-link"></i>
            <div>
              <strong>Managed in backend portal</strong>
              <span>Dispatch, logistics & post-delivery follow-up live there. We mirror a snapshot below.</span>
            </div>
          </div>
          <div className="os-lane__body">
            {lanes.delivered.length === 0 ? (
              <div className="os-empty">
                <i data-lucide="truck"></i>
                <p>Delivered orders will mirror here after dispatch.</p>
              </div>
            ) : lanes.delivered.map(o => <OrderCard key={o.id} order={o} onOpen={setActive} />)}
          </div>
        </div>
      </div>

      {active && (
        <OrderDetail
          order={active}
          onClose={() => setActive(null)}
          onUpdate={(o) => onUpdate(o)}
          onProceed={() => setActive(null)}
        />
      )}
    </div>
  );
}

Object.assign(window, { OrderStatusScreen, PinGate, seedSampleOrders });
