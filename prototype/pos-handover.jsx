// 2990's POS — Handover (Phase 1: Additional info → Phase 2: Confirm & pay), Confirmation, SignaturePad

const { useState: useStateH, useEffect: useEffectH, useRef: useRefH, useMemo: useMemoH } = React;

// Inline SVG icon helper — used in places where the icon swaps between renders.
// Lucide.createIcons() replaces <i data-lucide="..."> nodes with <svg>; when React
// later unmounts those nodes (e.g. on back navigation), it can't find the original
// <i> child and throws "removeChild ... not a child of this node". Inline SVG keeps
// React in full control of the node tree.
function hIcon(name, size = 14, stroke = 2) {
  const paths = {
    'arrow-left':  <><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></>,
    'arrow-right': <><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></>,
    'check':       <path d="M20 6L9 17l-5-5"/>,
    'minus':       <path d="M5 12h14"/>,
    'plus':        <><path d="M12 5v14"/><path d="M5 12h14"/></>,
    'upload':      <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></>,
    'camera':      <><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></>,
    'file':        <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></>,
    'x':           <><path d="M18 6L6 18"/><path d="M6 6l12 12"/></>,
    'alert':       <><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></>,
  };
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"
      style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      {paths[name]}
    </svg>
  );
}

// ============ Camera Capture (modal) ============
function CameraCapture({ onCapture, onCancel }) {
  const videoRef = useRefH(null);
  const [error, setError] = useStateH(null);
  const [streamObj, setStreamObj] = useStateH(null);

  useEffectH(() => {
    let active = true;
    let stream = null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (!active) { stream.getTracks().forEach(t => t.stop()); return; }
        setStreamObj(stream);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      } catch (e) {
        setError(e.message || 'Camera unavailable');
      }
    })();
    return () => {
      active = false;
      if (stream) stream.getTracks().forEach(t => t.stop());
    };
  }, []);

  function snap() {
    const v = videoRef.current; if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(v, 0, 0);
    onCapture(c.toDataURL('image/jpeg', 0.85));
  }

  return (
    <div className="cam-modal" onClick={onCancel}>
      <div className="cam-modal__inner" onClick={e => e.stopPropagation()}>
        <div className="cam-modal__head">
          <span style={{ fontFamily: 'var(--font-button)', fontSize: 13, fontWeight: 600 }}>Take photo of payment slip</span>
          <button className="btn btn--ghost btn--sm" onClick={onCancel}>{hIcon('x', 14, 2.4)}Close</button>
        </div>
        <div className="cam-modal__body">
          {error ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--fg-muted)' }}>
              {hIcon('alert', 32, 1.6)}
              <div style={{ marginTop: 10, fontFamily: 'var(--font-button)', fontWeight: 600, color: 'var(--fg)' }}>Camera unavailable</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>{error}</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>Use "Upload file" instead.</div>
            </div>
          ) : (
            <video ref={videoRef} playsInline muted style={{ width: '100%', maxHeight: 420, background: '#000', borderRadius: 12 }}></video>
          )}
        </div>
        {!error && (
          <div className="cam-modal__foot">
            <button className="btn btn--primary btn--lg" onClick={snap} disabled={!streamObj}>
              {hIcon('camera', 14, 2.2)}Capture
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ============ Signature Pad ============
function SignaturePad({ onChange, signed }) {
  const canvasRef = useRefH(null);
  const [drawing, setDrawing] = useStateH(false);
  const lastPt = useRefH(null);

  useEffectH(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    c.width = rect.width * dpr;
    c.height = rect.height * dpr;
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#221F20';
    ctx.lineWidth = 2;
  }, []);

  function getPos(e) {
    const c = canvasRef.current;
    const rect = c.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX - rect.left, y: t.clientY - rect.top };
  }
  function start(e) { e.preventDefault(); setDrawing(true); lastPt.current = getPos(e); }
  function move(e) {
    if (!drawing) return;
    e.preventDefault();
    const p = getPos(e);
    const ctx = canvasRef.current.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(lastPt.current.x, lastPt.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastPt.current = p;
    if (!signed) onChange(true);
  }
  function end() { setDrawing(false); }
  function clear() {
    const c = canvasRef.current;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    onChange(false);
  }

  return (
    <div className={`sig ${signed ? 'is-signed' : ''}`}>
      <canvas ref={canvasRef} className="sig__canvas"
        onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
        onTouchStart={start} onTouchMove={move} onTouchEnd={end}>
      </canvas>
      {!signed && <span className="sig__hint">Sign here</span>}
      <div className="sig__line">
        <span>Customer signature</span>
        <button onClick={clear} style={{ fontSize: 11, color: 'var(--c-burnt)', fontWeight: 600 }}>Clear</button>
      </div>
    </div>
  );
}

// ============ Date picker ============
function DatePicker({ value, onChange }) {
  const [month, setMonth] = useStateH(() => new Date(2026, 4, 1));
  const monthName = month.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const startDow = first.getDay();
  const daysIn = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const today = new Date(2026, 4, 1);
  window.useLucide([month, value]);

  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysIn; d++) cells.push(d);
  const expressDays = new Set([4, 7, 11, 14, 18, 21, 25, 28]);

  function selectDay(d) {
    const dt = new Date(month.getFullYear(), month.getMonth(), d);
    if (dt < new Date(today.getFullYear(), today.getMonth(), today.getDate())) return;
    onChange(dt);
  }
  function isSel(d) {
    if (!value) return false;
    return value.getFullYear() === month.getFullYear() && value.getMonth() === month.getMonth() && value.getDate() === d;
  }
  function isPast(d) {
    const dt = new Date(month.getFullYear(), month.getMonth(), d);
    return dt < new Date(today.getFullYear(), today.getMonth(), today.getDate());
  }

  return (
    <div className="datepick">
      <div className="datepick__head">
        <span className="datepick__title">{monthName}</span>
        <span className="datepick__nav">
          <button className="icon-btn" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><i data-lucide="chevron-left"></i></button>
          <button className="icon-btn" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><i data-lucide="chevron-right"></i></button>
        </span>
      </div>
      {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => <span key={d} className="datepick__dow">{d.slice(0,2)}</span>)}
      {cells.map((d, i) => {
        if (d === null) return <span key={i} className="datepick__day is-empty"></span>;
        const past = isPast(d);
        const isToday = today.getMonth() === month.getMonth() && today.getDate() === d;
        const exp = expressDays.has(d);
        return (
          <button key={i}
            className={`datepick__day ${isSel(d) ? 'is-selected' : ''} ${isToday ? 'is-today' : ''}`}
            onClick={() => selectDay(d)} disabled={past}>
            {d}
            {exp && !past && <span className="datepick__day-tag">EXP</span>}
          </button>
        );
      })}
      <div className="datepick__legend">
        <span><span className="datepick__legend-dot" style={{ background: 'var(--c-orange)' }}></span>Selected</span>
        <span><span className="datepick__legend-dot" style={{ background: 'var(--c-burnt)' }}></span>Express slots</span>
        <span style={{ marginLeft: 'auto' }}>3–5 working days standard</span>
      </div>
    </div>
  );
}

// ============ Handover Screen ============
// Phase 1: Additional info — customer details, delivery address, emergency contact, target date
// Phase 2: Confirm & pay  — payment + add-ons → confirm payment → final signature → success
function HandoverScreen({ cart, customer, onCustomerChange, onComplete, onBack, payment, onPaymentChange, delivery, onDeliveryChange, addons, onAddonsChange, emergency, onEmergencyChange, staff }) {
  // Steps: 0 customer, 1 delivery addr, 2 emergency, 3 target date, 4 addons, 5 confirm payment, 6 final signature
  const [stepIdx, setStepIdx] = useStateH(0);
  const [signed, setSigned] = useStateH(false);
  const [paying, setPaying] = useStateH(false);
  const [paid, setPaid] = useStateH(false);
  // Payment details captured on the Confirm Payment step
  const [payAmount, setPayAmount] = useStateH(null); // RM amount entered by user
  const [approvalCode, setApprovalCode] = useStateH('');
  const [attachment, setAttachment] = useStateH(null); // { name, dataUrl, source: 'file'|'camera' }
  const [showCamera, setShowCamera] = useStateH(false);

  const PHASE1_STEPS = ['Customer', 'Address', 'Emergency', 'Target date'];
  const PHASE2_STEPS = ['Add-ons & payment', 'Confirm payment', 'Sign & confirm'];
  const phase = stepIdx < 4 ? 1 : 2;
  const phaseSteps = phase === 1 ? PHASE1_STEPS : PHASE2_STEPS;
  const phaseStepIdx = phase === 1 ? stepIdx : stepIdx - 4;

  window.useLucide([stepIdx, customer, payment, delivery, signed, addons, emergency, paying, paid]);

  const subtotal = cart.reduce((s, i) => s + i.qty * (i.config?.lineItem?.total ?? window.PRICE), 0);
  // Addons can be either a plain string id (simple toggle) or { id, qty, floors, items } for parametric add-ons
  function addonEntry(id) { return addons.find(a => (typeof a === 'string' ? a : a.id) === id); }
  function addonId(a) { return typeof a === 'string' ? a : a.id; }
  function addonPrice(entry, def) {
    if (def.kind === 'qty') {
      const qty = (typeof entry === 'object' ? entry.qty : null) ?? def.defaultQty ?? 1;
      return qty * def.perItemPrice;
    }
    if (def.kind === 'floors') {
      const f = (typeof entry === 'object' ? entry.floors : null) ?? def.defaultFloors;
      const it = (typeof entry === 'object' ? entry.items : null) ?? def.defaultItems;
      const billable = Math.max(0, f - 2); // 3rd floor and above; floor 1+2 free
      return billable * it * def.perFloorItem;
    }
    return def.price;
  }
  const addonTotal = addons.reduce((s, a) => {
    const def = window.ADDONS.find(d => d.id === addonId(a));
    return def ? s + addonPrice(a, def) : s;
  }, 0);
  const total = subtotal + addonTotal;
  const minDeposit = Math.ceil(total * 0.5); // 50% minimum
  const defaultAmount = total; // default to full payment
  const currentAmount = payAmount ?? defaultAmount;
  const amountValid = currentAmount >= minDeposit && currentAmount <= total;

  const TIME_SLOTS = ['09:00 – 12:00', '12:00 – 15:00', '15:00 – 18:00', '18:00 – 21:00'];

  function canAdvance() {
    if (stepIdx === 0) return customer.name && customer.phone && customer.email;
    if (stepIdx === 1) {
      if (customer.addressLater) return true;
      const billingOk = customer.billingSameAsDelivery || (customer.billingAddress && customer.billingPostcode);
      return customer.address && customer.postcode && billingOk;
    }
    if (stepIdx === 2) return emergency.name && emergency.phone;
    if (stepIdx === 3) return delivery.date || delivery.tbd;
    if (stepIdx === 4) return payment;
    if (stepIdx === 5) return paid;    if (stepIdx === 6) return signed;
    return false;
  }

  function handleConfirmPayment() {
    setPaying(true);
    setTimeout(() => { setPaying(false); setPaid(true); }, 1400);
  }

  return (
    <div className="handover">
      <div className="handover__left">
        <div className="handover__title-row">
          <div>
            <span className="phase-banner">
              <span className="phase-banner__dot"></span>
              Phase {phase} of 2 · {phase === 1 ? 'Additional info' : 'Confirm & pay'}
            </span>
            <h1 className="handover__title">{phase === 1 ? 'Customer additional info' : 'Confirm & payment'}</h1>
          </div>
          <button className="btn btn--ghost btn--sm" onClick={onBack}>
            {hIcon('arrow-left', 14)}Back to cart
          </button>
        </div>
        <p className="handover__sub">
          {phase === 1
            ? 'Hand the tablet to the customer to fill in their details. Quote items have been carried over — no re-entry needed.'
            : 'Review add-ons, record payment, then capture the customer signature to complete the order.'}
        </p>

        <div className="steps">
          {phaseSteps.map((label, i) => (
            <div key={label} className={`step-pill ${phaseStepIdx === i ? 'is-active' : ''} ${phaseStepIdx > i ? 'is-done' : ''}`}>
              <span className="step-pill__num">
                {phaseStepIdx > i ? hIcon('check', 11, 3) : i + 1}
              </span>
              <span className="step-pill__label">{label}</span>
            </div>
          ))}
        </div>

        {/* === PHASE 1 === */}
        {stepIdx === 0 && (
          <div className="fade-in">
            <div className="form-grid">
              <div className="field"><span className="field__label">Full name</span>
                <input value={customer.name} onChange={e => onCustomerChange({ ...customer, name: e.target.value })} placeholder="e.g. Lim Wei Ling" />
              </div>
              <div className="field"><span className="field__label">Phone</span>
                <input value={customer.phone} onChange={e => onCustomerChange({ ...customer, phone: e.target.value })} placeholder="+60 12 345 6789" />
              </div>
              <div className="field field--span"><span className="field__label">Email <span style={{ color: 'var(--c-orange)' }}>*</span></span>
                <input type="email" value={customer.email} onChange={e => onCustomerChange({ ...customer, email: e.target.value })} placeholder="customer@example.com — for receipt & order updates" />
              </div>
              <div className="field"><span className="field__label">Salesperson</span>
                <input value={staff?.name || ''} readOnly style={{ background: 'var(--pos-rail)', color: 'var(--fg-muted)', cursor: 'not-allowed' }} />
              </div>
              <div className="field"><span className="field__label">Customer type</span>
                <select value={customer.type || 'New'} onChange={e => onCustomerChange({ ...customer, type: e.target.value })}>
                  <option>New</option><option>Returning</option><option>Trade / Designer</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {stepIdx === 1 && (
          <div className="fade-in">
            {/* Fill later toggle */}
            <label className={`addr-toggle ${customer.addressLater ? 'is-on' : ''}`}>
              <input type="checkbox" checked={!!customer.addressLater}
                onChange={e => onCustomerChange({ ...customer, addressLater: e.target.checked })} />
              <span className="addr-toggle__box">{customer.addressLater && hIcon('check', 12, 3)}</span>
              <span>
                <strong>Fill in address later</strong>
                <span className="addr-toggle__hint">Customer hasn't confirmed delivery address yet — we'll capture it before dispatch.</span>
              </span>
            </label>

            {!customer.addressLater && (
              <React.Fragment>
                <div style={{ marginBottom: 14, marginTop: 22, fontFamily: 'var(--font-button)', fontSize: 13, fontWeight: 600 }}>Delivery address</div>
                <div className="form-grid">
                  <div className="field field--span"><span className="field__label">Full address</span>
                    <textarea value={customer.address} onChange={e => onCustomerChange({ ...customer, address: e.target.value })} placeholder="Unit, street, area" />
                  </div>
                  <div className="field"><span className="field__label">Postcode</span>
                    <input value={customer.postcode} onChange={e => onCustomerChange({ ...customer, postcode: e.target.value })} placeholder="50480" />
                  </div>
                  <div className="field"><span className="field__label">City</span>
                    <input value={customer.city || ''} onChange={e => onCustomerChange({ ...customer, city: e.target.value })} placeholder="Kuala Lumpur" />
                  </div>
                  <div className="field"><span className="field__label">State</span>
                    <select value={customer.state} onChange={e => onCustomerChange({ ...customer, state: e.target.value })}>
                      <option>Selangor</option><option>Kuala Lumpur</option><option>Putrajaya</option>
                      <option>Penang</option><option>Johor</option><option>Perak</option><option>Other</option>
                    </select>
                  </div>
                  <div className="field"><span className="field__label">Building type</span>
                    <select value={customer.bldg || 'Condo'} onChange={e => onCustomerChange({ ...customer, bldg: e.target.value })}>
                      <option>Condo</option><option>Landed</option><option>Apartment</option><option>Office</option>
                    </select>
                  </div>
                </div>

                {/* Billing same as delivery */}
                <label className={`addr-toggle ${customer.billingSameAsDelivery !== false ? 'is-on' : ''}`} style={{ marginTop: 22 }}>
                  <input type="checkbox" checked={customer.billingSameAsDelivery !== false}
                    onChange={e => onCustomerChange({ ...customer, billingSameAsDelivery: e.target.checked })} />
                  <span className="addr-toggle__box">{customer.billingSameAsDelivery !== false && hIcon('check', 12, 3)}</span>
                  <span>
                    <strong>Billing address same as delivery address</strong>
                    <span className="addr-toggle__hint">Uncheck if the invoice should be issued to a different address.</span>
                  </span>
                </label>

                {customer.billingSameAsDelivery === false && (
                  <React.Fragment>
                    <div style={{ marginBottom: 14, marginTop: 22, fontFamily: 'var(--font-button)', fontSize: 13, fontWeight: 600 }}>Billing address</div>
                    <div className="form-grid">
                      <div className="field field--span"><span className="field__label">Full address</span>
                        <textarea value={customer.billingAddress || ''} onChange={e => onCustomerChange({ ...customer, billingAddress: e.target.value })} placeholder="Unit, street, area" />
                      </div>
                      <div className="field"><span className="field__label">Postcode</span>
                        <input value={customer.billingPostcode || ''} onChange={e => onCustomerChange({ ...customer, billingPostcode: e.target.value })} placeholder="50480" />
                      </div>
                      <div className="field"><span className="field__label">City</span>
                        <input value={customer.billingCity || ''} onChange={e => onCustomerChange({ ...customer, billingCity: e.target.value })} placeholder="Kuala Lumpur" />
                      </div>
                      <div className="field"><span className="field__label">State</span>
                        <select value={customer.billingState || 'Selangor'} onChange={e => onCustomerChange({ ...customer, billingState: e.target.value })}>
                          <option>Selangor</option><option>Kuala Lumpur</option><option>Putrajaya</option>
                          <option>Penang</option><option>Johor</option><option>Perak</option><option>Other</option>
                        </select>
                      </div>
                    </div>
                  </React.Fragment>
                )}
              </React.Fragment>
            )}
          </div>
        )}

        {stepIdx === 2 && (
          <div className="fade-in">
            <div style={{ marginBottom: 14, fontFamily: 'var(--font-button)', fontSize: 13, fontWeight: 600 }}>Emergency contact</div>
            <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 16 }}>
              Used only if we cannot reach the customer on delivery day.
            </p>
            <div className="form-grid">
              <div className="field"><span className="field__label">Contact name</span>
                <input value={emergency.name} onChange={e => onEmergencyChange({ ...emergency, name: e.target.value })} placeholder="e.g. Lim Mei Hua" />
              </div>
              <div className="field"><span className="field__label">Relationship</span>
                <select value={emergency.relation || 'Spouse'} onChange={e => onEmergencyChange({ ...emergency, relation: e.target.value })}>
                  <option>Spouse</option><option>Parent</option><option>Sibling</option><option>Child</option><option>Friend</option><option>Other</option>
                </select>
              </div>
              <div className="field field--span"><span className="field__label">Phone</span>
                <input value={emergency.phone} onChange={e => onEmergencyChange({ ...emergency, phone: e.target.value })} placeholder="+60 12 345 6789" />
              </div>
            </div>
          </div>
        )}

        {stepIdx === 3 && (
          <div className="fade-in">
            <div style={{ marginBottom: 14, fontFamily: 'var(--font-button)', fontSize: 13, fontWeight: 600 }}>Delivery target date</div>

            <label className={`addr-toggle ${delivery.tbd ? 'is-on' : ''}`} style={{ marginBottom: 18 }}>
              <input type="checkbox" checked={!!delivery.tbd}
                onChange={e => onDeliveryChange({ ...delivery, tbd: e.target.checked, date: e.target.checked ? null : delivery.date })} />
              <span className="addr-toggle__box">{delivery.tbd && hIcon('check', 12, 3)}</span>
              <span>
                <strong>For Further Notice</strong>
                <span className="addr-toggle__hint">Customer hasn't confirmed a delivery date — we'll contact them later to schedule.</span>
              </span>
            </label>

            {!delivery.tbd && (
              <DatePicker value={delivery.date} onChange={d => onDeliveryChange({ ...delivery, date: d })} />
            )}

            <div className="field" style={{ marginTop: 18 }}>
              <span className="field__label">Special instructions (optional)</span>
              <textarea value={delivery.notes} onChange={e => onDeliveryChange({ ...delivery, notes: e.target.value })} placeholder="Lift available, leave at concierge, etc." style={{ minHeight: 60 }} />
            </div>
          </div>
        )}

        {/* === PHASE 2 === */}
        {stepIdx === 4 && (
          <div className="fade-in">
            <div style={{ marginBottom: 8, fontFamily: 'var(--font-button)', fontSize: 13, fontWeight: 600 }}>Add-ons (optional)</div>
            <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 4 }}>One-time fees, added on top of the RM2,990 product price.</p>
            <div className="addon-grid">
              {window.ADDONS.map(a => {
                const entry = addonEntry(a.id);
                const on = !!entry;
                function toggle() {
                  if (on) onAddonsChange(addons.filter(x => addonId(x) !== a.id));
                  else if (a.kind === 'qty') onAddonsChange([...addons, { id: a.id, qty: a.defaultQty || 1 }]);
                  else if (a.kind === 'floors') onAddonsChange([...addons, { id: a.id, floors: a.defaultFloors, items: a.defaultItems }]);
                  else onAddonsChange([...addons, a.id]);
                }
                function update(patch) {
                  onAddonsChange(addons.map(x => addonId(x) === a.id ? { ...(typeof x === 'object' ? x : { id: a.id }), ...patch } : x));
                }
                const linePrice = on ? addonPrice(entry, a) : a.price;

                return (
                  <div key={a.id} className={`addon-card ${on ? 'is-on' : ''}`}>
                    <button className="addon-card__head" onClick={toggle}>
                      <span className="addon-card__icon"><i data-lucide={a.icon}></i></span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <div className="addon-card__label">{a.label}</div>
                        <div className="addon-card__hint">{a.hint}</div>
                      </span>
                      <span className="addon-card__right">
                        <span className="addon-card__price">{a.kind ? (on ? `+RM${linePrice}` : 'configurable') : `+RM${a.price}`}</span>
                        <span className="addon-card__check"><i data-lucide="check"></i></span>
                      </span>
                    </button>
                    {on && a.kind === 'qty' && (
                      <div className="addon-config">
                        <span className="addon-config__label">{a.qtyLabel || 'Quantity'}</span>
                        <span className="qty-stepper">
                          <button onClick={() => update({ qty: Math.max(1, ((entry.qty ?? a.defaultQty) - 1)) })}>{hIcon('minus', 14, 2.5)}</button>
                          <span className="qty-stepper__num">{entry.qty ?? a.defaultQty}</span>
                          <button onClick={() => update({ qty: (entry.qty ?? a.defaultQty) + 1 })}>{hIcon('plus', 14, 2.5)}</button>
                        </span>
                        <span className="addon-config__calc">RM{a.perItemPrice} × {entry.qty ?? a.defaultQty} = <strong>RM{linePrice}</strong></span>
                      </div>
                    )}
                    {on && a.kind === 'floors' && (
                      <div className="addon-config addon-config--two">
                        <div className="addon-config__row">
                          <span className="addon-config__label">Floor</span>
                          <span className="qty-stepper">
                            <button onClick={() => update({ floors: Math.max(3, (entry.floors ?? a.defaultFloors) - 1) })}>{hIcon('minus', 14, 2.5)}</button>
                            <span className="qty-stepper__num">{entry.floors ?? a.defaultFloors}</span>
                            <button onClick={() => update({ floors: (entry.floors ?? a.defaultFloors) + 1 })}>{hIcon('plus', 14, 2.5)}</button>
                          </span>
                        </div>
                        <div className="addon-config__row">
                          <span className="addon-config__label">Items to carry</span>
                          <span className="qty-stepper">
                            <button onClick={() => update({ items: Math.max(1, (entry.items ?? a.defaultItems) - 1) })}>{hIcon('minus', 14, 2.5)}</button>
                            <span className="qty-stepper__num">{entry.items ?? a.defaultItems}</span>
                            <button onClick={() => update({ items: (entry.items ?? a.defaultItems) + 1 })}>{hIcon('plus', 14, 2.5)}</button>
                          </span>
                        </div>
                        <span className="addon-config__calc">
                          {Math.max(0, (entry.floors ?? a.defaultFloors) - 2)} billable {(Math.max(0, (entry.floors ?? a.defaultFloors) - 2) === 1 ? 'floor' : 'floors')} × {(entry.items ?? a.defaultItems)} item{(entry.items ?? a.defaultItems) > 1 ? 's' : ''} × RM{a.perFloorItem} = <strong>RM{linePrice}</strong>
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: 24, fontFamily: 'var(--font-button)', fontSize: 13, fontWeight: 600 }}>Payment method</div>
            <div className="pay-grid" style={{ marginTop: 10 }}>
              {window.PAYMENT_METHODS.map(m => (
                <button key={m.id} className={`pay-card ${payment === m.id ? 'is-selected' : ''}`} onClick={() => onPaymentChange(m.id)}>
                  <span className="pay-card__icon"><i data-lucide={m.icon}></i></span>
                  <span>
                    <div className="pay-card__label">{m.label}</div>
                    <div className="pay-card__hint">{m.hint}</div>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {stepIdx === 5 && (
          <div className="fade-in">
            <p style={{ fontSize: 13, color: 'var(--fg-muted)', marginBottom: 18 }}>
              Record the payment received via <strong>{window.PAYMENT_METHODS.find(p=>p.id===payment)?.label}</strong>. Customer can pay any amount between <strong>50% deposit</strong> (RM{minDeposit.toLocaleString('en-MY')}) and the full total (RM{total.toLocaleString('en-MY')}).
            </p>

            {/* Amount entered */}
            <div className="pay-amount">
              <span className="pay-amount__label">Amount paid</span>
              <div className="pay-amount__field">
                <span className="pay-amount__currency">RM</span>
                <input type="number" inputMode="decimal" min={minDeposit} max={total} step="1"
                  value={currentAmount}
                  onChange={e => setPayAmount(Number(e.target.value) || 0)} />
              </div>
              <div className="pay-amount__chips">
                <button className={`pay-chip ${currentAmount === minDeposit ? 'is-on' : ''}`} onClick={() => setPayAmount(minDeposit)}>50% deposit · RM{minDeposit.toLocaleString('en-MY')}</button>
                <button className={`pay-chip ${currentAmount === total ? 'is-on' : ''}`} onClick={() => setPayAmount(total)}>Full payment · RM{total.toLocaleString('en-MY')}</button>
                <button className={`pay-chip ${currentAmount === Math.ceil(total * 0.7) ? 'is-on' : ''}`} onClick={() => setPayAmount(Math.ceil(total * 0.7))}>70% · RM{Math.ceil(total * 0.7).toLocaleString('en-MY')}</button>
              </div>
              {!amountValid && (
                <div className="pay-amount__warn">
                  {hIcon('alert', 13, 2.4)} Amount must be at least RM{minDeposit.toLocaleString('en-MY')} (50% deposit) and no more than RM{total.toLocaleString('en-MY')}.
                </div>
              )}
              {amountValid && currentAmount < total && (
                <div className="pay-amount__balance">
                  Balance of <strong>RM{(total - currentAmount).toLocaleString('en-MY')}</strong> due on delivery.
                </div>
              )}
            </div>

            {/* Approval code */}
            <div className="field" style={{ marginTop: 22 }}>
              <span className="field__label">Approval code <span style={{ color: 'var(--c-orange)' }}>*</span></span>
              <input value={approvalCode} onChange={e => setApprovalCode(e.target.value)}
                placeholder={payment === 'transfer' ? 'Bank transaction reference' : 'From the card terminal slip'} />
            </div>

            {/* Attachment */}
            <div className="field" style={{ marginTop: 18 }}>
              <span className="field__label">Payment slip / proof <span style={{ color: 'var(--c-orange)' }}>*</span></span>
              {!attachment ? (
                <div className="upload-row">
                  <label className="upload-btn">
                    {hIcon('upload', 14, 2.2)}
                    <span>Upload file</span>
                    <input type="file" accept="image/*,application/pdf" style={{ display: 'none' }}
                      onChange={e => {
                        const f = e.target.files?.[0]; if (!f) return;
                        const reader = new FileReader();
                        reader.onload = ev => setAttachment({ name: f.name, dataUrl: ev.target.result, source: 'file', isImage: f.type.startsWith('image/') });
                        reader.readAsDataURL(f);
                      }} />
                  </label>
                  <button className="upload-btn" onClick={() => setShowCamera(true)}>
                    {hIcon('camera', 14, 2.2)}<span>Take photo</span>
                  </button>
                </div>
              ) : (
                <div className="upload-preview">
                  {attachment.isImage ? (
                    <img src={attachment.dataUrl} alt="Payment slip" />
                  ) : (
                    <div className="upload-preview__doc">{hIcon('file', 24, 1.6)}<span>{attachment.name}</span></div>
                  )}
                  <div className="upload-preview__meta">
                    <div>
                      <strong>{attachment.name}</strong>
                      <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 2 }}>
                        Captured via {attachment.source === 'camera' ? 'camera' : 'file upload'}
                      </div>
                    </div>
                    <button className="btn btn--ghost btn--sm" onClick={() => setAttachment(null)}>
                      {hIcon('x', 14, 2.4)}Remove
                    </button>
                  </div>
                </div>
              )}
            </div>

            {showCamera && (
              <CameraCapture
                onCapture={(dataUrl) => { setAttachment({ name: `slip-${Date.now()}.jpg`, dataUrl, source: 'camera', isImage: true }); setShowCamera(false); }}
                onCancel={() => setShowCamera(false)}
              />
            )}

            {/* Confirm button */}
            <div style={{ marginTop: 22, display: 'flex', gap: 10, alignItems: 'center' }}>
              {!paid && !paying && (
                <button className="btn btn--primary btn--lg"
                  disabled={!amountValid || !approvalCode || !attachment}
                  onClick={handleConfirmPayment}>
                  {hIcon('check', 14, 2.4)}Confirm payment received
                </button>
              )}
              {paying && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, color: 'var(--fg-muted)', fontSize: 13 }}>
                  <span style={{ width: 18, height: 18, border: '2px solid var(--line-strong)', borderTopColor: 'var(--c-orange)', borderRadius: 999, animation: 'spin 0.8s linear infinite' }}></span>
                  Recording payment…
                </span>
              )}
              {paid && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, color: '#2F8F4F', fontFamily: 'var(--font-button)', fontSize: 13, fontWeight: 600 }}>
                  <span style={{ width: 22, height: 22, borderRadius: 999, background: '#2F8F4F', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                    {hIcon('check', 12, 3)}
                  </span>
                  Payment recorded · RM{currentAmount.toLocaleString('en-MY')}
                </span>
              )}
            </div>
          </div>
        )}

        {stepIdx === 6 && (
          <div className="fade-in">
            <p style={{ fontSize: 13, color: 'var(--fg-muted)', marginBottom: 14 }}>
              Final step — customer reviews the order on the right and signs below to confirm.
            </p>
            <SignaturePad signed={signed} onChange={setSigned} />
            <div style={{ marginTop: 14, fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
              By signing, the customer confirms the items, delivery date, address, and total. Same price guarantee applies — every piece is RM2,990.
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 32, paddingTop: 20, borderTop: '1px solid var(--line)' }}>
          <button className="btn btn--ghost" onClick={() => stepIdx === 0 ? onBack() : setStepIdx(stepIdx - 1)}>
            {hIcon('arrow-left', 14)}{stepIdx === 0 ? 'Back to cart' : 'Previous'}
          </button>
          <span style={{ flex: 1 }}></span>
          {stepIdx === 5 && paid && (
            <button className="btn btn--primary btn--lg" onClick={() => setStepIdx(6)}>
              Continue to signature{hIcon('arrow-right', 14)}
            </button>
          )}
          {stepIdx !== 5 && (
            <button className="btn btn--primary btn--lg" disabled={!canAdvance()}
              onClick={() => stepIdx < 6 ? setStepIdx(stepIdx + 1) : onComplete({ paidAmount: currentAmount, approvalCode, slipDataUrl: attachment?.dataUrl, total, addonTotal, subtotal })}>
              {stepIdx < 6 ? 'Next' : 'Complete order'}
              {hIcon(stepIdx < 6 ? 'arrow-right' : 'check', 14)}
            </button>
          )}
        </div>
      </div>

      <SummaryPanel cart={cart} customer={customer} payment={payment} delivery={delivery} subtotal={subtotal} addonTotal={addonTotal} total={total} addons={addons} emergency={emergency} />
    </div>
  );
}

// ============ Pillow line-item helper ============
// Renders the per-pillow breakdown beneath a mattress in the order
// summary / receipt — so the salesperson and the customer can both see
// exactly which pillows are bundled vs. paid extras.
function PillowSummary({ pillows }) {
  const free  = pillows?.free  || {};
  const extra = pillows?.extra || {};
  const types = [
    { id: 'memory', name: 'Memory foam' },
    { id: 'latex',  name: 'Natural latex' },
  ];
  const rows = [];
  types.forEach(t => {
    const f = free[t.id]  || 0;
    const e = extra[t.id] || 0;
    if (f > 0) rows.push({
      key: 'f-' + t.id, label: t.name,
      qty: f, priceLabel: 'Included',
      isFree: true,
    });
    if (e > 0) rows.push({
      key: 'e-' + t.id, label: t.name,
      qty: e, priceLabel: `RM${(e * (t.id === 'memory' ? 89 : 109)).toLocaleString('en-MY')}`,
      isFree: false,
    });
  });
  if (rows.length === 0) return null;
  return (
    <ul className="summary__item-mods">
      {rows.map(r => (
        <li key={r.key}>
          <span className="summary__item-mods__id">{r.qty}×</span>
          <span className="summary__item-mods__sep">·</span>
          <span className="summary__item-mods__label">
            {r.label}{r.isFree && <span className="summary__item-mods__chip"> free</span>}
          </span>
          <span className="summary__item-mods__price">{r.priceLabel}</span>
        </li>
      ))}
    </ul>
  );
}

// ============ Summary Panel ============
function SummaryPanel({ cart, customer, payment, delivery, subtotal, addonTotal, total, addons, emergency }) {
  window.useLucide([cart, customer, payment, delivery, addons, emergency]);
  const orderId = useMemoH(() => 'ORD-' + Math.floor(100000 + Math.random() * 900000), []);
  const payLabel = window.PAYMENT_METHODS.find(p => p.id === payment)?.label;

  return (
    <aside className="summary">
      <div className="summary__head">
        <div className="summary__order">{orderId} · {new Date(2026, 4, 1).toLocaleDateString('en-MY')}</div>
        <div className="summary__title">Order summary</div>
      </div>
      <div className="summary__body">
        <div className="summary__section">
          <div className="summary__section-label">Items · {cart.reduce((s,i)=>s+i.qty,0)}</div>
          <div className="summary__items">
            {cart.flatMap(item => {
              const p = window.PRODUCTS.find(x => x.id === item.id);
              const cfg = item.config;
              // Custom sofas: explode into one card per completed sofa,
              // with each sofa's modules listed underneath.
              const sofas = cfg?.lineItem?.sofas;
              if (sofas && sofas.length > 0) {
                return sofas.map((s, si) => (
                  <div key={(item.key || item.id) + ':sofa:' + si} className="summary__item summary__item--sofa">
                    <div className="summary__item-photo" style={p?.img ? { backgroundImage: `url(${p.img})` } : { background: 'var(--bg-tan, #E3D0A6)' }}></div>
                    <div className="summary__item-main">
                      <div className="summary__item-name">
                        {s.label}
                        {s.isBundle && <span className="summary__item-badge">Bundle</span>}
                        {!s.closed && <span className="summary__item-badge summary__item-badge--warn">Open</span>}
                      </div>
                      <div className="summary__item-meta">
                        {s.depth}″ seat · {s.dimW}×{s.dimH} cm
                        {s.modules.length > 0 && ' · '}
                        {s.modules.map(m => m.qty > 1 ? `${m.id}×${m.qty}` : m.id).join(' + ')}
                      </div>
                      {s.modules.length > 0 && (
                        <ul className="summary__item-mods">
                          {s.modules.map(m => (
                            <li key={m.id}>
                              <span className="summary__item-mods__id">{m.id}{m.qty > 1 ? ` × ${m.qty}` : ''}</span>
                              <span className="summary__item-mods__sep">·</span>
                              <span className="summary__item-mods__label">{m.label.replace(m.id + ' · ', '')}</span>
                              <span className="summary__item-mods__price">RM{m.price.toLocaleString('en-MY')}</span>
                            </li>
                          ))}
                          {s.isBundle && s.saves > 0 && (
                            <li className="summary__item-mods__note">
                              <span>Bundle saves RM{s.saves.toLocaleString('en-MY')} vs à la carte</span>
                            </li>
                          )}
                        </ul>
                      )}
                    </div>
                    <span className="summary__item-price"><sup>RM</sup>{(s.price * item.qty).toLocaleString('en-MY')}</span>
                  </div>
                ));
              }
              const name = cfg?.lineItem?.title || p?.name || 'Item';
              const meta = cfg?.lineItem?.sub || (p ? `${p.size} · qty ${item.qty}` : `qty ${item.qty}`);
              const lineTotal = item.qty * (cfg?.lineItem?.total ?? window.PRICE);
              const pillows = cfg?.lineItem?.pillows;
              return [(
                <div key={item.key || item.id} className={"summary__item" + (pillows ? " summary__item--sofa" : "")}>
                  <div className="summary__item-photo" style={p?.img ? { backgroundImage: `url(${p.img})` } : { background: 'var(--bg-tan, #E3D0A6)' }}></div>
                  <div className="summary__item-main">
                    <div className="summary__item-name">{name}</div>
                    <div className="summary__item-meta">{meta}{cfg ? ` · qty ${item.qty}` : ''}</div>
                    {pillows && <PillowSummary pillows={pillows} />}
                  </div>
                  <span className="summary__item-price"><sup>RM</sup>{lineTotal.toLocaleString('en-MY')}</span>
                </div>
              )];
            })}
          </div>
        </div>

        {addons && addons.length > 0 && (
          <div className="summary__section">
            <div className="summary__section-label">Add-ons</div>
            {addons.map((entry, i) => {
              const id = typeof entry === 'string' ? entry : entry.id;
              const a = window.ADDONS.find(x => x.id === id);
              if (!a) return null;
              let line = `+RM${a.price}`;
              let detail = a.label;
              if (a.kind === 'qty') {
                const qty = (typeof entry === 'object' ? entry.qty : null) ?? a.defaultQty ?? 1;
                detail = `${a.label} × ${qty}`;
                line = `+RM${qty * a.perItemPrice}`;
              } else if (a.kind === 'floors') {
                const f = (typeof entry === 'object' ? entry.floors : null) ?? a.defaultFloors;
                const it = (typeof entry === 'object' ? entry.items : null) ?? a.defaultItems;
                const billable = Math.max(0, f - 2);
                detail = `Lift · floor ${f} × ${it} item${it > 1 ? 's' : ''}`;
                line = `+RM${billable * it * a.perFloorItem}`;
              }
              return <div key={i} className="summary__row"><span className="key">{detail}</span><span className="val">{line}</span></div>;
            })}
          </div>
        )}

        <div className="summary__section">
          <div className="summary__section-label">Customer</div>
          {customer.name ? (
            <>
              <div className="summary__row"><span className="key">Name</span><span className="val">{customer.name}</span></div>
              {customer.phone && <div className="summary__row"><span className="key">Phone</span><span className="val">{customer.phone}</span></div>}
              {customer.email && <div className="summary__row"><span className="key">Email</span><span className="val">{customer.email}</span></div>}
              {customer.addressLater
                ? <div className="summary__row"><span className="key">Address</span><span className="val" style={{ fontStyle: 'italic', color: 'var(--fg-muted)' }}>To be filled later</span></div>
                : customer.address && <div className="summary__row"><span className="key">Address</span><span className="val" style={{ maxWidth: 200 }}>{customer.address}</span></div>
              }
            </>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--fg-muted)', fontStyle: 'italic' }}>Not yet captured</div>
          )}
        </div>

        {emergency && emergency.name && (
          <div className="summary__section">
            <div className="summary__section-label">Emergency contact</div>
            <div className="summary__row"><span className="key">{emergency.relation || 'Contact'}</span><span className="val">{emergency.name}</span></div>
            {emergency.phone && <div className="summary__row"><span className="key">Phone</span><span className="val">{emergency.phone}</span></div>}
          </div>
        )}

        <div className="summary__section">
          <div className="summary__section-label">Delivery</div>
          {delivery.tbd ? (
            <div className="summary__row"><span className="key">Date</span><span className="val" style={{ fontStyle: 'italic', color: 'var(--c-orange)' }}>For Further Notice</span></div>
          ) : delivery.date ? (
            <>
              <div className="summary__row"><span className="key">Date</span><span className="val">{delivery.date.toLocaleDateString('en-MY', { weekday: 'short', day: 'numeric', month: 'short' })}</span></div>
              {delivery.slot && <div className="summary__row"><span className="key">Slot</span><span className="val">{delivery.slot}</span></div>}
            </>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--fg-muted)', fontStyle: 'italic' }}>Pending</div>
          )}
        </div>

        <div className="summary__section">
          <div className="summary__section-label">Payment</div>
          {payment ? (
            <div className="summary__row"><span className="key">Method</span><span className="val">{payLabel}</span></div>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--fg-muted)', fontStyle: 'italic' }}>Pending</div>
          )}
        </div>

        <div className="summary__section">
          <div className="summary__section-label">Totals</div>
          <div className="summary__row"><span className="key">Items subtotal</span><span className="val">RM{subtotal.toLocaleString('en-MY')}.00</span></div>
          {addonTotal > 0 && <div className="summary__row"><span className="key">Add-ons</span><span className="val">RM{addonTotal.toLocaleString('en-MY')}.00</span></div>}
        </div>
      </div>
      <div className="summary__foot">
        <div className="summary__total-row">
          <span className="summary__total-label">Total</span>
          <span className="summary__total-num"><sup>RM</sup>{total.toLocaleString('en-MY')}</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--fg-muted)', textAlign: 'right' }}>Inclusive of delivery within Klang Valley</div>
      </div>
    </aside>
  );
}

// ============ Confirmation ============
function ConfirmScreen({ cart, customer, delivery, payment, onNew, total, staff, addons }) {
  window.useLucide([]);
  const orderId = useMemoH(() => 'ORD-' + Math.floor(100000 + Math.random() * 900000), []);
  const itemCount = cart.reduce((s,i)=>s+i.qty,0);

  return (
    <div className="confirm">
      <div className="confirm__hero">
        <div className="confirm__hero-inner">
          <div className="confirm__check"><i data-lucide="check"></i></div>
          <div className="confirm__eyebrow">Order confirmed · {orderId}</div>
          <h1 className="confirm__head">
            Welcome <span className="accent">home</span>, {customer.name?.split(' ')[0] || 'friend'}.
          </h1>
          <p className="confirm__sub">
            Your {itemCount} {itemCount === 1 ? 'piece' : 'pieces'} will arrive{' '}
            {delivery.tbd
              ? <strong>on a date to be confirmed</strong>
              : <><strong>on {delivery.date?.toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'long' })}</strong>{delivery.slot ? <> between {delivery.slot}</> : null}</>
            }. A copy of the receipt has been sent to {customer.email || customer.phone}.
          </p>
          <div className="confirm__cta-row">
            <button className="btn btn--primary btn--lg" onClick={onNew}>
              <i data-lucide="plus"></i>New order
            </button>
            <button className="btn btn--ghost btn--lg" onClick={() => window.print()}>
              <i data-lucide="printer"></i>Print receipt
            </button>
          </div>
        </div>
      </div>

      <aside className="confirm__panel">
        <div className="summary__head">
          <div className="summary__order">{orderId}</div>
          <div className="summary__title">Receipt</div>
        </div>
        <div className="summary__body">
          <div className="summary__section">
            <div className="summary__section-label">Items</div>
            <div className="summary__items">
              {cart.flatMap(item => {
                const p = window.PRODUCTS.find(x => x.id === item.id);
                const cfg = item.config;
                const sofas = cfg?.lineItem?.sofas;
                if (sofas && sofas.length > 0) {
                  return sofas.map((s, si) => (
                    <div key={(item.key || item.id) + ':sofa:' + si} className="summary__item summary__item--sofa">
                      <div className="summary__item-photo" style={p?.img ? { backgroundImage: `url(${p.img})` } : { background: 'var(--bg-tan, #E3D0A6)' }}></div>
                      <div className="summary__item-main">
                        <div className="summary__item-name">
                          {s.label}
                          {s.isBundle && <span className="summary__item-badge">Bundle</span>}
                        </div>
                        <div className="summary__item-meta">
                          {s.depth}″ seat · {s.dimW}×{s.dimH} cm · qty {item.qty}
                        </div>
                        {s.modules.length > 0 && (
                          <ul className="summary__item-mods">
                            {s.modules.map(m => (
                              <li key={m.id}>
                                <span className="summary__item-mods__id">{m.id}{m.qty > 1 ? ` × ${m.qty}` : ''}</span>
                                <span className="summary__item-mods__sep">·</span>
                                <span className="summary__item-mods__label">{m.label.replace(m.id + ' · ', '')}</span>
                                <span className="summary__item-mods__price">RM{m.price.toLocaleString('en-MY')}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <span className="summary__item-price"><sup>RM</sup>{(s.price * item.qty).toLocaleString('en-MY')}</span>
                    </div>
                  ));
                }
                const name = cfg?.lineItem?.title || p?.name || 'Item';
                const lineTotal = item.qty * (cfg?.lineItem?.total ?? window.PRICE);
                const pillows = cfg?.lineItem?.pillows;
                return [(
                  <div key={item.key || item.id} className={"summary__item" + (pillows ? " summary__item--sofa" : "")}>
                    <div className="summary__item-photo" style={p?.img ? { backgroundImage: `url(${p.img})` } : { background: 'var(--bg-tan, #E3D0A6)' }}></div>
                    <div className="summary__item-main">
                      <div className="summary__item-name">{name}</div>
                      <div className="summary__item-meta">qty {item.qty}</div>
                      {pillows && <PillowSummary pillows={pillows} />}
                    </div>
                    <span className="summary__item-price"><sup>RM</sup>{lineTotal.toLocaleString('en-MY')}</span>
                  </div>
                )];
              })}
            </div>
          </div>
          <div className="summary__section">
            <div className="summary__section-label">Delivery</div>
            <div className="summary__row"><span className="key">Address</span><span className="val" style={{ maxWidth: 220 }}>{customer.addressLater ? <em style={{ color: 'var(--fg-muted)' }}>To be filled later</em> : customer.address}</span></div>
            <div className="summary__row"><span className="key">Date</span><span className="val">{delivery.tbd ? <em style={{ color: 'var(--c-orange)' }}>For Further Notice</em> : delivery.date?.toLocaleDateString('en-MY', { day:'numeric', month:'short', year:'numeric' })}</span></div>
            {!delivery.tbd && delivery.slot && <div className="summary__row"><span className="key">Slot</span><span className="val">{delivery.slot}</span></div>}
          </div>
          <div className="summary__section">
            <div className="summary__section-label">Payment</div>
            <div className="summary__row"><span className="key">Method</span><span className="val">{window.PAYMENT_METHODS.find(p=>p.id===payment)?.label}</span></div>
            <div className="summary__row"><span className="key">Status</span><span className="val" style={{ color: '#2F8F4F' }}>Recorded</span></div>
          </div>
        </div>
        <div className="summary__foot">
          <div className="summary__total-row">
            <span className="summary__total-label">Paid</span>
            <span className="summary__total-num"><sup>RM</sup>{total.toLocaleString('en-MY')}</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>Same price. Every piece. Always.</div>
        </div>
      </aside>

      <PrintReceipt orderId={orderId} cart={cart} customer={customer} delivery={delivery} payment={payment} total={total} staff={staff} addons={addons} />
    </div>
  );
}

// ============ Print Receipt (visible only in print mode) ============
function PrintReceipt({ orderId, cart, customer, delivery, payment, total, staff, addons }) {
  const today = new Date();
  const addonItems = (addons || []).map(a => {
    const def = window.ADDONS.find(x => x.id === a.id);
    if (!def) return null;
    let label = def.label;
    let price = 0;
    if (def.kind === 'qty') { const q = a.qty ?? def.defaultQty; price = q * def.perItemPrice; label = `${def.label} × ${q}`; }
    else if (def.kind === 'floors') {
      const f = a.floors ?? def.defaultFloors; const it = a.items ?? def.defaultItems;
      const billable = Math.max(0, f - 2); price = billable * it * def.perFloorItem;
      label = `${def.label} (${billable} ${billable===1?'floor':'floors'} × ${it})`;
    }
    return { label, price };
  }).filter(Boolean);

  return (
    <div className="print-receipt" aria-hidden="true">
      {/* Letterhead */}
      <div className="pr-head">
        <div className="pr-brand">
          <div className="pr-logo">2990<span className="pr-r">®</span></div>
          <div className="pr-tag">Same price. Every piece. Always.</div>
        </div>
        <div className="pr-meta">
          <div><span>Order</span><strong>{orderId}</strong></div>
          <div><span>Issued</span><strong>{today.toLocaleDateString('en-MY', { day:'numeric', month:'short', year:'numeric' })}</strong></div>
          <div><span>Showroom</span><strong>POS · KL</strong></div>
          <div><span>Salesperson</span><strong>{staff?.name || '—'}</strong></div>
        </div>
      </div>

      <div className="pr-rule"></div>

      {/* Greeting */}
      <div className="pr-greeting">
        <div className="pr-greeting__title">
          Welcome <span className="pr-accent">home</span>, {customer.name?.split(' ')[0] || 'friend'}.
        </div>
        <div className="pr-greeting__sub">
          Thank you for choosing 2990. Below is your official receipt.
        </div>
      </div>

      {/* Customer + Delivery side-by-side */}
      <div className="pr-grid">
        <section className="pr-block">
          <div className="pr-block__label">Customer</div>
          <div className="pr-block__row"><strong>{customer.name || '—'}</strong></div>
          <div className="pr-block__row">{customer.phone || '—'}</div>
          <div className="pr-block__row">{customer.email || '—'}</div>
        </section>
        <section className="pr-block">
          <div className="pr-block__label">Delivery</div>
          <div className="pr-block__row">
            {customer.addressLater
              ? <em>Address — to be confirmed</em>
              : (customer.address || '—')}
          </div>
          <div className="pr-block__row">
            {delivery.tbd
              ? <em>Date — for further notice</em>
              : <>{delivery.date?.toLocaleDateString('en-MY', { weekday:'long', day:'numeric', month:'long', year:'numeric' })}{delivery.slot ? ` · ${delivery.slot}` : ''}</>}
          </div>
        </section>
      </div>

      {/* Itemised table */}
      <table className="pr-table">
        <thead>
          <tr>
            <th>Item</th>
            <th className="num">Qty</th>
            <th className="num">Unit</th>
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {cart.flatMap(item => {
            const p = window.PRODUCTS.find(x => x.id === item.id);
            const cfg = item.config;
            const sofas = cfg?.lineItem?.sofas;
            // Each completed sofa lands as its own row, with module
            // compartments listed in a sub-row beneath.
            if (sofas && sofas.length > 0) {
              return sofas.flatMap((s, si) => {
                const unit = s.price;
                const name = s.isBundle
                  ? `${s.bundleLabel} (Custom build)`
                  : (sofas.length > 1 ? `Custom sofa ${String.fromCharCode(65 + si)}` : 'Custom sofa');
                const sub  = `${s.depth}″ seat · ${s.dimW}×${s.dimH} cm${s.modules.length > 0 ? ' · ' + s.modules.map(m => m.qty > 1 ? `${m.id}×${m.qty}` : m.id).join(' + ') : ''}`;
                return [
                  <tr key={(item.key || item.id) + ':sofa:' + si}>
                    <td>
                      <div className="pr-item-name">{name}</div>
                      {sub && <div className="pr-item-sub">{sub}</div>}
                    </td>
                    <td className="num">{item.qty}</td>
                    <td className="num">RM{unit.toLocaleString('en-MY')}</td>
                    <td className="num">RM{(item.qty * unit).toLocaleString('en-MY')}</td>
                  </tr>,
                  ...(s.modules.length > 0 ? [
                    <tr key={(item.key || item.id) + ':sofa:' + si + ':mods'} className="pr-mods-row">
                      <td colSpan="4">
                        <div className="pr-mods">
                          <div className="pr-mods__label">Compartments</div>
                          <ul className="pr-mods__list">
                            {s.modules.map(m => (
                              <li key={m.id}>
                                <span className="pr-mods__id">{m.id}{m.qty > 1 ? ` × ${m.qty}` : ''}</span>
                                <span className="pr-mods__name">{m.label.replace(m.id + ' · ', '')}</span>
                                <span className="pr-mods__price">RM{m.price.toLocaleString('en-MY')}</span>
                              </li>
                            ))}
                            {s.isBundle && s.saves > 0 && (
                              <li className="pr-mods__note">
                                Bundle saves RM{s.saves.toLocaleString('en-MY')} vs à la carte
                              </li>
                            )}
                          </ul>
                        </div>
                      </td>
                    </tr>
                  ] : []),
                ];
              });
            }
            const name = cfg?.lineItem?.title || p?.name || 'Item';
            const sub  = cfg?.lineItem?.sub || '';
            const unit = cfg?.lineItem?.total ?? window.PRICE;
            const pillows = cfg?.lineItem?.pillows;
            return [(
              <tr key={item.key || item.id}>
                <td>
                  <div className="pr-item-name">{name}</div>
                  {sub && <div className="pr-item-sub">{sub}</div>}
                </td>
                <td className="num">{item.qty}</td>
                <td className="num">RM{unit.toLocaleString('en-MY')}</td>
                <td className="num">RM{(item.qty * unit).toLocaleString('en-MY')}</td>
              </tr>
            ),
            ...(pillows ? (() => {
              const types = [
                { id: 'memory', code: 'MEM', name: 'Memory foam', price: 89 },
                { id: 'latex',  code: 'LTX', name: 'Natural latex', price: 109 },
              ];
              const rows = [];
              types.forEach(t => {
                const f = pillows.free?.[t.id]  || 0;
                const e = pillows.extra?.[t.id] || 0;
                if (f > 0) rows.push({ key: `f-${t.id}`, code: t.code, name: `${t.name} (incl.)`, qty: f, unit: 0,       total: 0,         free: true });
                if (e > 0) rows.push({ key: `e-${t.id}`, code: t.code, name: t.name,                qty: e, unit: t.price, total: e*t.price, free: false });
              });
              if (rows.length === 0) return [];
              return [
                <tr key={(item.key || item.id) + ':pillows-head'} className="pr-pillows-head">
                  <td colSpan="4">PILLOWS</td>
                </tr>,
                ...rows.map(r => (
                  <tr key={(item.key || item.id) + ':p:' + r.key} className="pr-pillow-row">
                    <td>
                      <span className="pr-pillow__code">{r.code}</span>
                      <span className="pr-pillow__name">{r.name}</span>
                    </td>
                    <td className="num">{r.qty}</td>
                    <td className="num">{r.free ? '—' : `RM${r.unit.toLocaleString('en-MY')}`}</td>
                    <td className="num">{r.free ? '—' : `RM${r.total.toLocaleString('en-MY')}`}</td>
                  </tr>
                )),
              ];
            })() : [])
            ];
          })}
          {addonItems.map((a, i) => (
            <tr key={'a-' + i} className="pr-addon">
              <td colSpan="3">{a.label}</td>
              <td className="num">RM{a.price.toLocaleString('en-MY')}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals */}
      <div className="pr-totals">
        <div className="pr-totals__inner">
          <div className="pr-totals__row"><span>Payment method</span><strong>{window.PAYMENT_METHODS.find(p=>p.id===payment)?.label || '—'}</strong></div>
          <div className="pr-totals__row"><span>Status</span><strong style={{ color: '#2F8F4F' }}>Recorded</strong></div>
          <div className="pr-totals__divider"></div>
          <div className="pr-totals__grand">
            <span>Total paid</span>
            <span className="pr-totals__num"><sup>RM</sup>{total.toLocaleString('en-MY')}</span>
          </div>
        </div>
      </div>

      {/* Signature & footer */}
      <div className="pr-signrow">
        <div className="pr-sign">
          <div className="pr-sign__line"></div>
          <div className="pr-sign__caption">Customer signature</div>
        </div>
        <div className="pr-sign">
          <div className="pr-sign__line"></div>
          <div className="pr-sign__caption">Authorised by · {staff?.name || '—'}</div>
        </div>
      </div>

      <div className="pr-foot">
        <div>2990 Showroom · Kuala Lumpur · hello@2990.my · +60 3-1234 5678</div>
        <div>Same price. Every piece. Always. — Thank you for shopping with us.</div>
      </div>
    </div>
  );
}

Object.assign(window, { HandoverScreen, ConfirmScreen, SignaturePad, DatePicker, SummaryPanel });
