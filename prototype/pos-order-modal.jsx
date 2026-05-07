// 2990's POS — New-order modal
//
// Walks the salesperson through 3 steps after they've built a Quote and hit
// "Generate Order". Pre-fills everything from the quote. Steps:
//   1. Customer & delivery (per-screenshot layout)
//   2. Add-ons & payment
//   3. Signature → success
//
// Closes back to the Quote tab on success.

const NEW_ORDER_STEPS = [
  { id: 'customer', label: 'Customer & delivery' },
  { id: 'payment',  label: 'Add-ons & payment' },
  { id: 'sign',     label: 'Sign & confirm' },
];

const SALESPERSON = { name: 'Aisha Rahman', outlet: 'BedHouse KL — Bangsar' };

const ORDER_ADDONS = [
  { id: 'a-protector', name: 'Mattress protector',  price: 290 },
  { id: 'a-pillows',   name: 'Two memory pillows',  price: 290 },
  { id: 'a-bedset',    name: 'Linen bedset (Q/K)',  price: 590 },
  { id: 'a-throw',     name: 'Wool throw blanket',  price: 390 },
  { id: 'a-removal',   name: 'Old-mattress removal',price: 90 },
  { id: 'a-assembly',  name: 'White-glove assembly',price: 0 },
];

// ─── helpers ────────────────────────────────────────────
function NoLabel({ children, hint }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="pos-field__label" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>{children}</span>
        {hint && <span style={{ color: 'var(--fg-muted)', textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>{hint}</span>}
      </div>
    </div>
  );
}

// ─── Step 1: Customer & delivery ────────────────────────
function CustomerStepModal({ form, setForm }) {
  const stateObj = MY_STATES.find(s => s.code === form.state);
  const cityObj = stateObj?.cities.find(c => c.name === form.city);

  // When state changes, clear city + postcode
  function setState(code) {
    setForm(f => ({ ...f, state: code, city: '', postcode: '' }));
  }
  function setCity(name) {
    setForm(f => ({ ...f, city: name, postcode: '' }));
  }

  return (
    <div className="pos-modal__body">
      {/* Sale info */}
      <h3 className="pos-modal__sectionTitle">Sale info</h3>
      <div className="pos-modal__row" style={{ position: 'relative' }}>
        <div className="pos-field" style={{ flex: 1 }}>
          <label className="pos-field__label">Outlet</label>
          <div className="pos-locked-input">
            <span>{SALESPERSON.outlet}</span>
            <span className="pos-locked-input__tag">Locked</span>
          </div>
        </div>
        <div className="pos-field" style={{ flex: 1 }}>
          <label className="pos-field__label" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Salesperson</span>
            <span style={{ color: 'var(--fg-soft)', textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>Logged in — auto-filled</span>
          </label>
          <div className="pos-locked-input">
            <span>{SALESPERSON.name}</span>
            <span className="pos-locked-input__tag pos-locked-input__tag--you">You</span>
          </div>
        </div>
      </div>

      {/* Customer details */}
      <h3 className="pos-modal__sectionTitle" style={{ marginTop: 28 }}>
        Customer details
        <span className="pos-modal__sectionHint">Use English, Chinese, or Malay characters</span>
      </h3>
      <div className="pos-modal__row">
        <div className="pos-field" style={{ flex: 1 }}>
          <label className="pos-field__label">Full name <span className="pos-req">*</span></label>
          <input className="pos-input" placeholder="As on IC / passport"
            value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        </div>
        <div className="pos-field" style={{ flex: 1 }}>
          <label className="pos-field__label">Phone <span className="pos-req">*</span></label>
          <input className="pos-input" placeholder="+60 12-345 6789"
            value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
        </div>
      </div>

      {/* Delivery address */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 24, marginBottom: 12 }}>
        <h3 className="pos-modal__sectionTitle" style={{ margin: 0 }}>Delivery address</h3>
        <label className="pos-checkbox">
          <input type="checkbox" checked={form.noAddress} onChange={e => setForm(f => ({ ...f, noAddress: e.target.checked }))} />
          <span>Customer hasn't provided yet</span>
        </label>
      </div>

      {!form.noAddress && (
        <React.Fragment>
          <div className="pos-field">
            <label className="pos-field__label">Address line 1 <span className="pos-req">*</span></label>
            <input className="pos-input" placeholder="Building, unit, street (e.g. 12-3, Jalan Telawi 5, Bangsar Baru)"
              value={form.address1} onChange={e => setForm(f => ({ ...f, address1: e.target.value }))} />
          </div>
          <div className="pos-modal__row" style={{ marginTop: 14 }}>
            <div className="pos-field" style={{ flex: 1 }}>
              <label className="pos-field__label">State <span className="pos-req">*</span></label>
              <select className="pos-select" value={form.state} onChange={e => setState(e.target.value)}>
                <option value="">— select state —</option>
                {MY_STATES.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
              </select>
            </div>
            <div className="pos-field" style={{ flex: 1 }}>
              <label className="pos-field__label">City / town <span className="pos-req">*</span></label>
              <select className="pos-select" value={form.city} onChange={e => setCity(e.target.value)} disabled={!stateObj}>
                <option value="">{stateObj ? '— select city —' : 'Select state first'}</option>
                {stateObj?.cities.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
            </div>
          </div>
          <div className="pos-modal__row" style={{ marginTop: 14 }}>
            <div className="pos-field" style={{ flex: 1 }}>
              <label className="pos-field__label">Postcode <span className="pos-req">*</span></label>
              <select className="pos-select" value={form.postcode} onChange={e => setForm(f => ({ ...f, postcode: e.target.value }))} disabled={!cityObj}>
                <option value="">{cityObj ? '— select postcode —' : 'Select state first'}</option>
                {cityObj?.postcodes.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }} />
          </div>
        </React.Fragment>
      )}

      {/* Emergency contact */}
      <h3 className="pos-modal__sectionTitle" style={{ marginTop: 24 }}>
        Emergency contact <span className="pos-req">*</span>
      </h3>
      <div className="pos-modal__row pos-modal__row--3">
        <input className="pos-input" placeholder="Name"
          value={form.emName} onChange={e => setForm(f => ({ ...f, emName: e.target.value }))} />
        <input className="pos-input" placeholder="012-9988776"
          value={form.emPhone} onChange={e => setForm(f => ({ ...f, emPhone: e.target.value }))} />
        <select className="pos-select" value={form.emRel} onChange={e => setForm(f => ({ ...f, emRel: e.target.value }))}>
          <option value="">— Relationship —</option>
          {RELATIONSHIPS.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      {/* Billing */}
      <h3 className="pos-modal__sectionTitle" style={{ marginTop: 28 }}>Billing address</h3>
      <label className="pos-checkbox">
        <input type="checkbox" checked={form.billingSame} onChange={e => setForm(f => ({ ...f, billingSame: e.target.checked }))} />
        <span>Same as delivery address</span>
      </label>
      {!form.billingSame && (
        <div className="pos-field" style={{ marginTop: 12 }}>
          <input className="pos-input" placeholder="Billing address (full)"
            value={form.billingAddress} onChange={e => setForm(f => ({ ...f, billingAddress: e.target.value }))} />
        </div>
      )}

      {/* Delivery date */}
      <h3 className="pos-modal__sectionTitle" style={{ marginTop: 28 }}>Delivery date</h3>
      <div className="pos-modal__row" style={{ alignItems: 'flex-end' }}>
        <div className="pos-field" style={{ flex: 1 }}>
          <label className="pos-field__label">Delivery date <span className="pos-req">*</span></label>
          <input className="pos-input" type="date" value={form.deliveryDate} disabled={form.deliveryConfirmLater}
            onChange={e => setForm(f => ({ ...f, deliveryDate: e.target.value }))} />
        </div>
        <label className="pos-checkbox" style={{ paddingBottom: 12, whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={form.deliveryConfirmLater} onChange={e => setForm(f => ({ ...f, deliveryConfirmLater: e.target.checked }))} />
          <span>Confirm further notice</span>
        </label>
      </div>
    </div>
  );
}

// ─── Step 2: Add-ons & payment ─────────────────────────
function PaymentStepModal({ form, setForm, quote }) {
  const baseTotal = quote.total;
  const addonTotal = (form.addons || []).reduce((s, id) => s + (ORDER_ADDONS.find(a => a.id === id)?.price || 0), 0);
  const grandTotal = baseTotal + addonTotal;

  const presets = [
    { id: 'p50', label: 'Deposit 50%', value: Math.round(grandTotal * 0.5) },
    { id: 'p100', label: 'Pay in full',  value: grandTotal },
    { id: 'pcustom', label: 'Custom',    value: form.paymentCustom ?? Math.round(grandTotal * 0.3) },
  ];
  const methods = [
    { id: 'card',  label: 'Card · contactless' },
    { id: 'qr',    label: 'DuitNow QR' },
    { id: 'transfer', label: 'Bank transfer' },
    { id: 'cash',  label: 'Cash' },
  ];

  function toggleAddon(id) {
    setForm(f => ({ ...f, addons: f.addons?.includes(id) ? f.addons.filter(x => x !== id) : [...(f.addons || []), id] }));
  }

  const payAmount = form.paymentPreset === 'pcustom' ? (form.paymentCustom ?? 0) : (presets.find(p => p.id === form.paymentPreset)?.value || 0);

  return (
    <div className="pos-modal__body">
      <h3 className="pos-modal__sectionTitle">Add-ons</h3>
      <p style={{ marginTop: -2, marginBottom: 12, fontSize: 13, color: 'var(--fg-muted)' }}>Optional. They tap on what they want — pricing flows into the total below.</p>
      <div className="pos-modal__addons">
        {ORDER_ADDONS.map(a => {
          const sel = (form.addons || []).includes(a.id);
          return (
            <button key={a.id} className={`pos-modal-addon ${sel ? 'is-selected' : ''}`} onClick={() => toggleAddon(a.id)}>
              <div className="pos-modal-addon__name">{a.name}</div>
              <div className="pos-modal-addon__price">{a.price === 0 ? 'Included' : '+ ' + posFmt(a.price)}</div>
              <span className="pos-modal-addon__check">{sel && <Icon name="check" size={11} stroke={3} />}</span>
            </button>
          );
        })}
      </div>

      <h3 className="pos-modal__sectionTitle" style={{ marginTop: 28 }}>Today's payment</h3>
      <div className="pos-modal__presets">
        {presets.map(p => (
          <button key={p.id} className={`pos-modal-preset ${form.paymentPreset === p.id ? 'is-selected' : ''}`} onClick={() => setForm(f => ({ ...f, paymentPreset: p.id }))}>
            <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', opacity: 0.8 }}>{p.label}</div>
            <div style={{ fontFamily: 'var(--font-mark)', fontWeight: 900, fontStretch: '80%', fontSize: 28, letterSpacing: '-0.02em', marginTop: 4 }}>{posPrice(p.value, 9)}</div>
            {p.id === 'p50' && <div style={{ fontSize: 11, color: 'inherit', opacity: 0.7, marginTop: 2 }}>Balance on delivery</div>}
            {p.id === 'p100' && <div style={{ fontSize: 11, color: 'inherit', opacity: 0.7, marginTop: 2 }}>Settled today</div>}
          </button>
        ))}
      </div>
      {form.paymentPreset === 'pcustom' && (
        <div className="pos-field" style={{ marginTop: 12, maxWidth: 280 }}>
          <label className="pos-field__label">Custom amount (RM)</label>
          <input className="pos-input" type="number" min="0" max={grandTotal}
            value={form.paymentCustom ?? ''}
            onChange={e => setForm(f => ({ ...f, paymentCustom: Number(e.target.value) }))} />
        </div>
      )}

      <h3 className="pos-modal__sectionTitle" style={{ marginTop: 24 }}>Method</h3>
      <div className="pos-modal__methods">
        {methods.map(m => (
          <button key={m.id} className={`pos-modal-method ${form.paymentMethod === m.id ? 'is-selected' : ''}`} onClick={() => setForm(f => ({ ...f, paymentMethod: m.id }))}>
            {m.label}
          </button>
        ))}
      </div>

      <div className="pos-modal__totals">
        <div className="pos-modal__totalsRow">
          <span>Order subtotal</span>
          <span>{posFmt(baseTotal)}</span>
        </div>
        <div className="pos-modal__totalsRow">
          <span>Add-ons</span>
          <span>{addonTotal ? posFmt(addonTotal) : '—'}</span>
        </div>
        <div className="pos-modal__totalsRow">
          <span>Delivery & assembly</span>
          <span style={{ color: 'var(--c-burnt)', fontWeight: 600 }}>Included</span>
        </div>
        <div className="pos-modal__totalsRow pos-modal__totalsRow--total">
          <span>Order total</span>
          <span className="pos-modal__totalNum">{posPrice(grandTotal, 12)}</span>
        </div>
        <div className="pos-modal__totalsRow" style={{ paddingTop: 8, borderTop: '1px dashed var(--line)' }}>
          <span style={{ color: 'var(--c-burnt)' }}>Charging now</span>
          <span style={{ color: 'var(--c-burnt)', fontFamily: 'var(--font-mark)', fontWeight: 900, fontStretch: '80%', fontSize: 22, letterSpacing: '-0.02em' }}>{posFmt(payAmount)}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Step 3: Sign + success ────────────────────────────
function SignStepModal({ form, setForm, quote, onPlace, placed }) {
  const canvasRef = React.useRef(null);
  const drawingRef = React.useRef(false);

  React.useEffect(() => {
    if (placed) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.strokeStyle = '#221F20';

    function pos(e) {
      const r = canvas.getBoundingClientRect();
      const t = e.touches ? e.touches[0] : e;
      return { x: t.clientX - r.left, y: t.clientY - r.top };
    }
    function start(e) {
      e.preventDefault();
      drawingRef.current = true;
      const p = pos(e);
      ctx.beginPath(); ctx.moveTo(p.x, p.y);
      setForm(f => ({ ...f, signed: true }));
    }
    function move(e) {
      if (!drawingRef.current) return;
      e.preventDefault();
      const p = pos(e);
      ctx.lineTo(p.x, p.y); ctx.stroke();
    }
    function end() { drawingRef.current = false; }

    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end);
    return () => {
      canvas.removeEventListener('mousedown', start);
      canvas.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', end);
      canvas.removeEventListener('touchstart', start);
      canvas.removeEventListener('touchmove', move);
      canvas.removeEventListener('touchend', end);
    };
  }, [placed]);

  function clearSig() {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
      setForm(f => ({ ...f, signed: false }));
    }
  }

  if (placed) {
    return (
      <div className="pos-modal__body" style={{ textAlign: 'center', padding: '20px 0 12px' }}>
        <div style={{ width: 80, height: 80, borderRadius: 999, background: 'var(--c-burnt)', color: 'var(--c-cream)', margin: '0 auto 18px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="check" size={42} stroke={2.5} />
        </div>
        <div className="pos-eyebrow" style={{ color: 'var(--c-burnt)', justifyContent: 'center' }}>Order placed · 20260503-0142</div>
        <h2 style={{ fontFamily: 'var(--font-title)', fontWeight: 700, fontSize: 32, letterSpacing: '-0.01em', margin: '6px 0 8px' }}>Thanks, {form.name?.split(' ')[0] || 'we'}.</h2>
        <p style={{ color: 'var(--fg-muted)', fontSize: 14, maxWidth: 380, margin: '0 auto', lineHeight: 1.55 }}>
          A confirmation goes to <strong style={{ color: 'var(--c-ink)' }}>{form.phone || '—'}</strong>. The team will message {form.deliveryConfirmLater ? 'closer to the date once the slot is confirmed' : 'on ' + form.deliveryDate + ' to confirm a 2-hour window'}.
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 22 }}>
          <button className="pos-btn pos-btn--ghost"><Icon name="receipt" size={14} /> Print receipt</button>
          <button className="pos-btn pos-btn--ghost"><Icon name="mail" size={14} /> Email receipt</button>
        </div>
      </div>
    );
  }

  return (
    <div className="pos-modal__body">
      <h3 className="pos-modal__sectionTitle">Final confirmation & signature</h3>
      <p style={{ marginTop: -2, marginBottom: 16, fontSize: 13, color: 'var(--fg-muted)' }}>
        Have the customer review the summary, then sign below to authorise the charge.
      </p>

      <div className="pos-modal__summary">
        <div className="pos-modal__summaryRow"><span>Customer</span><strong>{form.name || '—'}</strong></div>
        <div className="pos-modal__summaryRow"><span>Phone</span><strong>{form.phone || '—'}</strong></div>
        <div className="pos-modal__summaryRow"><span>Delivery to</span><strong>{form.noAddress ? 'Customer to confirm' : [form.address1, form.city, form.postcode].filter(Boolean).join(', ')}</strong></div>
        <div className="pos-modal__summaryRow"><span>Delivery date</span><strong>{form.deliveryConfirmLater ? 'Confirm further notice' : (form.deliveryDate || '—')}</strong></div>
        <div className="pos-modal__summaryRow"><span>Order</span><strong>{quote.summary}</strong></div>
        <div className="pos-modal__summaryRow"><span>Charging now</span><strong style={{ color: 'var(--c-burnt)' }}>{posFmt(form.chargeAmount || 0)}</strong></div>
      </div>

      <div className="pos-modal__sigPad">
        <canvas ref={canvasRef} width={760} height={200} style={{ width: '100%', height: 200, display: 'block', cursor: 'crosshair', touchAction: 'none' }} />
        <div className="pos-modal__sigPadLine">
          <span>Customer signature</span>
          <button className="pos-btn pos-btn--ghost pos-btn--sm" onClick={clearSig}>Clear</button>
        </div>
      </div>

      <button className="pos-btn pos-btn--primary pos-btn--block" style={{ marginTop: 20, justifyContent: 'center', height: 52 }}
        disabled={!form.signed} onClick={onPlace}>
        <Icon name="check" size={16} stroke={2.5} /> Confirm & place order — {posFmt(form.chargeAmount || 0)}
      </button>
    </div>
  );
}

// ─── Master modal ──────────────────────────────────────
function NewOrderModal({ quote, onClose, onComplete }) {
  const [step, setStep] = React.useState(0);
  const [placed, setPlaced] = React.useState(false);
  const [form, setForm] = React.useState({
    name: '', phone: '',
    noAddress: false,
    address1: '', state: '', city: '', postcode: '',
    emName: '', emPhone: '', emRel: '',
    billingSame: true, billingAddress: '',
    deliveryDate: '', deliveryConfirmLater: false,
    addons: [],
    paymentPreset: 'p50', paymentMethod: 'card', paymentCustom: null,
    signed: false,
  });

  const baseTotal = quote.total;
  const addonTotal = form.addons.reduce((s, id) => s + (ORDER_ADDONS.find(a => a.id === id)?.price || 0), 0);
  const grandTotal = baseTotal + addonTotal;
  const chargeAmount = form.paymentPreset === 'pcustom'
    ? (form.paymentCustom ?? 0)
    : form.paymentPreset === 'p100' ? grandTotal : Math.round(grandTotal * 0.5);

  React.useEffect(() => {
    setForm(f => ({ ...f, chargeAmount }));
  }, [chargeAmount]);

  function canAdvance() {
    if (placed) return false;
    if (step === 0) {
      if (!form.name || !form.phone) return false;
      if (!form.noAddress && (!form.address1 || !form.state || !form.city || !form.postcode)) return false;
      if (!form.emName || !form.emPhone || !form.emRel) return false;
      if (!form.deliveryConfirmLater && !form.deliveryDate) return false;
      return true;
    }
    if (step === 1) return !!form.paymentPreset && !!form.paymentMethod;
    return true;
  }

  function next() {
    if (!canAdvance()) return;
    setStep(s => Math.min(NEW_ORDER_STEPS.length - 1, s + 1));
  }
  function back() { setStep(s => Math.max(0, s - 1)); }

  function handlePlace() {
    setPlaced(true);
  }

  return (
    <div className="pos-modal-backdrop" onClick={onClose}>
      <div className="pos-modal" onClick={e => e.stopPropagation()}>
        <div className="pos-modal__head">
          <div>
            <span className="pos-eyebrow" style={{ color: 'var(--c-burnt)' }}>
              {placed ? 'Order placed' : `New order · Step ${step + 1} of ${NEW_ORDER_STEPS.length}`}
            </span>
            <h2 className="pos-modal__title">{placed ? 'Success' : NEW_ORDER_STEPS[step].label}</h2>
          </div>
          <button className="pos-modal__close" onClick={onClose} aria-label="Close">
            <Icon name="x" size={18} stroke={2} />
          </button>
        </div>

        {!placed && (
          <div className="pos-modal__progress">
            {NEW_ORDER_STEPS.map((_, i) => (
              <div key={i} className={`pos-modal__progressBar ${i <= step ? 'is-active' : ''}`} />
            ))}
          </div>
        )}

        {step === 0 && !placed && <CustomerStepModal form={form} setForm={setForm} />}
        {step === 1 && !placed && <PaymentStepModal form={form} setForm={setForm} quote={quote} />}
        {step === 2 && <SignStepModal form={form} setForm={setForm} quote={quote} onPlace={handlePlace} placed={placed} />}

        <div className="pos-modal__foot">
          {placed ? (
            <React.Fragment>
              <div style={{ flex: 1 }} />
              <button className="pos-btn pos-btn--primary" onClick={() => { onComplete?.(); onClose(); }}>
                Done — start a new order
              </button>
            </React.Fragment>
          ) : (
            <React.Fragment>
              <button className="pos-modal__cancel" onClick={step === 0 ? onClose : back}>
                {step === 0 ? 'Cancel' : 'Back'}
              </button>
              <div style={{ flex: 1 }} />
              {step < NEW_ORDER_STEPS.length - 1 && (
                <button className="pos-btn pos-btn--primary" onClick={next} disabled={!canAdvance()}>
                  Continue <Icon name="arrow-right" size={14} />
                </button>
              )}
            </React.Fragment>
          )}
        </div>
      </div>
    </div>
  );
}

window.NewOrderModal = NewOrderModal;
