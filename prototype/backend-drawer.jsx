// 2990's Backend Portal — Order Detail Drawer
// Lets the coordinator verify payment slips, advance status, and view all info.
// Verify only — does NOT approve. Approval is handled by Finance later.

const { useState: useStateDr, useEffect: useEffectDr } = React;

function OrderDrawer({ order, drivers, onClose, onUpdate, onToast }) {
  const [edited, setEdited] = useStateDr(order);
  useEffectDr(() => setEdited(order), [order?.id]);
  window.useLucideBE([edited?.id, edited?.lane, edited?.slipVerify]);

  if (!order || !edited) return null;
  const slip = window.SLIP_VERIFY[edited.slipVerify || 'none'];
  const method = window.PAYMENT_METHODS.find(m => m.id === edited.paymentMethod) || { label: 'Bank transfer', icon: 'qr-code' };
  const currentLaneIdx = window.LANES.findIndex(l => l.id === edited.lane);
  const currentLane = window.LANES[currentLaneIdx];

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

  function advance(targetLaneId) {
    // Logistics → Ready: confirm stock-in-warehouse first
    if (edited.lane === 'logistics' && targetLaneId === 'ready') {
      if (!window.confirm('Confirm goods are already in the warehouse before moving to Ready to Dispatch.')) {
        return;
      }
    }
    const next = { ...edited, lane: targetLaneId };
    if (targetLaneId === 'dispatched') {
      next.dispatchedAt = Date.now();
      // Override the customer's expected date with the confirmed one
      if (edited.confirmedDeliveryDate) {
        next.delivery = { ...(edited.delivery || {}), date: edited.confirmedDeliveryDate, confirmedAt: Date.now() };
      }
    }
    if (targetLaneId === 'delivered')  next.deliveredAt  = Date.now();
    setEdited(next);
    onUpdate(next);
    const lane = window.LANES.find(l => l.id === targetLaneId);
    onToast(`${edited.id} → ${lane.title}`);
  }

  function generatePDF() {
    // Simple print-window approach — opens a printable summary the user can save as PDF
    const w = window.open('', '_blank', 'width=820,height=1000');
    if (!w) { onToast('Allow pop-ups to generate PDF'); return; }
    const lane = window.LANES.find(l => l.id === edited.lane);
    const products = (edited.cart || []).map(c => {
      const p = (window.PRODUCTS || []).find(p => p.id === c.id);
      return { name: p?.name || c.id, qty: c.qty, price: p?.price || window.BE_PRICE };
    });
    const fmtMoney = window.fmtMoney || ((n) => n.toLocaleString());
    const css = `
      body { font-family: 'Poppins', system-ui, sans-serif; color: #221F20; padding: 40px 50px; max-width: 720px; margin: 0 auto; }
      h1 { font-family: 'Merriweather', serif; font-size: 26px; margin: 0 0 4px; }
      .eyebrow { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: #E86B3A; font-weight: 700; margin-bottom: 18px; }
      .meta { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px 20px; margin: 18px 0 24px; padding: 14px 16px; background: #FFF9EB; border-radius: 12px; font-size: 12px; }
      .meta b { display: block; font-size: 10px; color: #888; letter-spacing: .08em; text-transform: uppercase; margin-bottom: 2px; }
      table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px; }
      th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid #eee; }
      th { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: #888; }
      .totals { text-align: right; font-size: 14px; margin-top: 14px; }
      .totals .grand { font-family: 'Merriweather', serif; font-size: 22px; color: #A6471E; }
      .stamp { margin-top: 28px; padding: 14px 16px; background: #221F20; color: #FFF9EB; border-radius: 12px; font-size: 12px; }
      .footer { margin-top: 40px; font-size: 10px; color: #888; text-align: center; border-top: 1px solid #eee; padding-top: 18px; }
    `;
    const total = (edited.subtotal || 0) + (edited.addonTotal || 0);
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${edited.id} · ${edited.customer?.name || ''}</title>
      <link href="https://fonts.googleapis.com/css2?family=Merriweather:wght@700&family=Poppins:wght@400;600;700&display=swap" rel="stylesheet">
      <style>${css}</style></head><body>
      <div class="eyebrow">2990's · Order ${lane?.num || ''} ${lane?.title || ''}</div>
      <h1>${edited.id}</h1>
      <div style="font-size:13px;color:#666;">Generated ${new Date().toLocaleString('en-GB')} · by ${window.COORDINATOR?.name || 'Coordinator'}</div>
      <div class="meta">
        <div><b>Customer</b>${edited.customer?.name || '—'}</div>
        <div><b>Phone</b>${edited.customer?.phone || '—'}</div>
        <div><b>Address</b>${edited.customer?.address || '—'}, ${edited.customer?.city || ''} ${edited.customer?.postcode || ''}</div>
        <div><b>Salesperson</b>${edited.staff || '—'}</div>
        <div><b>Placed</b>${new Date(edited.placedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
        <div><b>Expected delivery</b>${edited.delivery?.date ? new Date(edited.delivery.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'TBD'}</div>
        ${edited.confirmedDeliveryDate ? `<div><b>Confirmed delivery</b>${new Date(edited.confirmedDeliveryDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</div>` : ''}
        ${edited.driver ? `<div><b>Driver</b>${edited.driver}</div>` : ''}
      </div>
      <table><thead><tr><th>Item</th><th style="text-align:center">Qty</th><th style="text-align:right">Price</th><th style="text-align:right">Subtotal</th></tr></thead><tbody>
        ${products.map(p => `<tr><td>${p.name}</td><td style="text-align:center">${p.qty}</td><td style="text-align:right">RM ${fmtMoney(p.price)}</td><td style="text-align:right">RM ${fmtMoney(p.price * p.qty)}</td></tr>`).join('')}
      </tbody></table>
      <div class="totals">
        Subtotal: RM ${fmtMoney(edited.subtotal || 0)}<br>
        ${edited.addonTotal ? `Add-ons: RM ${fmtMoney(edited.addonTotal)}<br>` : ''}
        Paid: RM ${fmtMoney(edited.paid || 0)}<br>
        <span class="grand">Total: RM ${fmtMoney(total)}</span>
      </div>
      <div class="stamp">Status · ${lane?.num} ${lane?.title} · Slip ${edited.slipVerify || 'none'}${edited.poIssued ? ' · PO issued' : ''}${edited.driverId ? ` · Driver ${edited.driverId}` : ''}</div>
      <div class="footer">2990's — Same price. Every piece. Always. · RM2,990</div>
      <script>setTimeout(() => window.print(), 350);</script>
    </body></html>`;
    w.document.write(html);
    w.document.close();
    onToast(`PDF prepared for ${edited.id}`);
  }

  function setVerify(state) {
    const next = { ...edited, slipVerify: state, slipVerifiedBy: state === 'verified' ? window.COORDINATOR.name : null, slipVerifiedAt: state === 'verified' ? Date.now() : null };
    setEdited(next);
    onUpdate(next);
    if (state === 'verified') onToast(`Slip verified for ${edited.id} · forwarded to Finance for approval`);
    if (state === 'flagged') onToast(`Slip flagged for ${edited.id} · sent back to Sales`);
  }

  function save() {
    onUpdate(edited);
    onToast(`${edited.id} updated`);
  }

  // Receivable view: verify-only banner
  const cannotApprove = (
    <div className="be-verify-actions__hint">
      <i data-lucide="info"></i>
      <span><strong>Verify only.</strong> You confirm the slip details match the order. Final approval &amp; reconciliation is done by Finance once they sync the bank statement.</span>
    </div>
  );

  return (
    <div className="be-overlay" onClick={onClose}>
      <aside className="be-drawer" onClick={e => e.stopPropagation()}>
        <div className="be-drawer__head">
          <div>
            <div className="be-drawer__eyebrow">Sales Order · {currentLane?.title}</div>
            <div className="be-drawer__title">{edited.id}</div>
            <div className="be-drawer__sub">
              {edited.customer?.name} · placed {window.fmtTime(edited.placedAt)} by {edited.staff}
            </div>
          </div>
          <button className="be-iconbtn" onClick={onClose} aria-label="Close">
            <i data-lucide="x"></i>
          </button>
        </div>

        <div className="be-drawer__body">
          {/* Status timeline */}
          <div className="be-sec">
            <div className="be-sec__title">
              <i data-lucide="git-branch"></i>Order pipeline
              <span className="be-sec__pill"></span>
            </div>
            <div className="be-timeline">
              {window.LANES.map((l, i) => (
                <div
                  key={l.id}
                  className={`be-timeline__step ${i < currentLaneIdx ? 'is-done' : ''} ${i === currentLaneIdx ? 'is-current' : ''}`}
                  onClick={() => {
                    if (i === currentLaneIdx) return;
                    if (i > currentLaneIdx + 1) return;
                    if (edited.lane === 'received') {
                      onToast('Step 01 → 02 is set by the showroom POS');
                      return;
                    }
                    if (i === currentLaneIdx + 1 && edited.lane === 'logistics' && !edited.poIssued) {
                      onToast('Issue PO first');
                      return;
                    }
                    if (i === currentLaneIdx + 1 && edited.lane === 'ready' && !edited.driverId) {
                      onToast('Pick a driver first');
                      return;
                    }
                    if (i === currentLaneIdx + 1 && edited.lane === 'ready' && !edited.confirmedDeliveryDate) {
                      onToast('Confirm a delivery date first');
                      return;
                    }
                    if (l.id === 'delivered' && !edited.doUrl) {
                      onToast('Upload signed DO first');
                      return;
                    }
                    advance(l.id);
                  }}
                  title={i === currentLaneIdx ? 'Current step' : `Move to ${l.title}`}
                >
                  <div className="be-timeline__num">{l.num}</div>
                  <div className="be-timeline__lbl">{l.title}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 4 }}>
              <i data-lucide="info" style={{ width: 11, height: 11, verticalAlign: '-1px', marginRight: 4 }}></i>
              Showroom marks step 06 once the customer signs the DO. Coordinator handles 01 → 05.
            </div>
          </div>

          {/* Items */}
          <div className="be-sec">
            <div className="be-sec__title">
              <i data-lucide="boxes"></i>Items
              <span className="be-sec__pill" style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                {window.pieceCount(edited.cart)} pieces
              </span>
            </div>
            <div className="be-items">
              {edited.cart.map((it, i) => {
                const p = window.PRODUCTS.find(x => x.id === it.id);
                if (!p) return null;
                return (
                  <div key={i} className="be-item">
                    <div className="be-item__photo" style={{ backgroundImage: `url(${p.img})` }}></div>
                    <div>
                      <div className="be-item__name">{p.name}</div>
                      <div className="be-item__meta">{p.sku} · {p.size}</div>
                    </div>
                    <div className="be-item__qty">×{it.qty}</div>
                    <div className="be-item__price"><sup>RM</sup>{window.fmtMoney(it.qty * window.BE_PRICE)}</div>
                  </div>
                );
              })}
              {(edited.addons || []).filter(a => (a.qty == null || a.qty > 0)).map((a, i) => {
                const def = window.BE_ADDONS.find(x => x.id === a.id);
                if (!def) return null;
                const cost = a.floors != null ? a.floors * a.items * 50 : (a.qty || 1) * def.price;
                return (
                  <div key={'a' + i} className="be-item" style={{ background: 'transparent', border: '1px dashed var(--line)' }}>
                    <div className="be-item__photo" style={{ background: 'var(--be-rail)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <i data-lucide={def.icon} style={{ width: 18, height: 18, color: 'var(--c-burnt)' }}></i>
                    </div>
                    <div>
                      <div className="be-item__name">{def.label}</div>
                      <div className="be-item__meta">
                        {a.floors != null ? `${a.floors} floors × ${a.items} items` : `Qty ${a.qty || 1}`}
                      </div>
                    </div>
                    <div className="be-item__qty"></div>
                    <div className="be-item__price"><sup>RM</sup>{window.fmtMoney(cost)}</div>
                  </div>
                );
              })}
            </div>
            <div className="be-totals">
              <div className="be-totals__row">
                <span>Furniture subtotal · {window.pieceCount(edited.cart)} × RM2,990</span>
                <span><sup>RM</sup>{window.fmtMoney(edited.subtotal)}</span>
              </div>
              {edited.addonTotal > 0 && (
                <div className="be-totals__row">
                  <span>Add-ons</span>
                  <span><sup>RM</sup>{window.fmtMoney(edited.addonTotal)}</span>
                </div>
              )}
              <div className="be-totals__row be-totals__row--total">
                <span>Order total</span>
                <span>RM{window.fmtMoney(edited.subtotal + (edited.addonTotal || 0))}</span>
              </div>
            </div>
          </div>

          {/* Customer */}
          <div className="be-sec">
            <div className="be-sec__title">
              <i data-lucide="user-round"></i>Customer
              <window.StatusPill tone="ok" icon="check" label="From POS" />
            </div>
            <div className="be-info-grid">
              <div className="be-info">
                <span className="be-info__lbl">Full name</span>
                <span className="be-info__val">{edited.customer?.name || '—'}</span>
              </div>
              <div className="be-info">
                <span className="be-info__lbl">Phone</span>
                <span className="be-info__val">{edited.customer?.phone || '—'}</span>
              </div>
              <div className="be-info be-info--span2">
                <span className="be-info__lbl">Email</span>
                <span className="be-info__val">{edited.customer?.email || '—'}</span>
              </div>
              <div className="be-info be-info--span2">
                <span className="be-info__lbl">Delivery address</span>
                <span className="be-info__val">{edited.customer?.address || '—'}</span>
              </div>
              <div className="be-info">
                <span className="be-info__lbl">Postcode</span>
                <span className="be-info__val">{edited.customer?.postcode || '—'}</span>
              </div>
              <div className="be-info">
                <span className="be-info__lbl">City / State</span>
                <span className="be-info__val">{edited.customer?.city || '—'}{edited.customer?.state ? ', ' + edited.customer.state : ''}</span>
              </div>
              <div className="be-info">
                <span className="be-info__lbl">Delivery date</span>
                <span className="be-info__val">{window.fmtDate(edited.delivery?.date)}</span>
              </div>
              <div className="be-info">
                <span className="be-info__lbl">Slot</span>
                <span className="be-info__val">{edited.delivery?.slot || 'TBD'}</span>
              </div>
            </div>
            {edited.notes && (
              <div style={{ background: 'var(--be-rail)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: 'var(--fg)', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <i data-lucide="message-square-quote" style={{ width: 14, height: 14, color: 'var(--c-burnt)', flexShrink: 0, marginTop: 2 }}></i>
                <span><strong style={{ fontFamily: 'var(--font-button)', fontSize: 11, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--fg-muted)' }}>From sales: </strong>{edited.notes}</span>
              </div>
            )}
          </div>

          {/* Payment slip — VERIFY ONLY */}
          <div className="be-sec">
            <div className="be-sec__title">
              <i data-lucide="receipt"></i>Payment slip
              <window.StatusPill tone={slip.tone} icon={slip.icon} label={slip.label} />
            </div>
            <div className="be-slip">
              <div className="be-slip__img be-slip__placeholder">
                {/* Faux slip preview */}
                <div className="be-slip__fake">
                  <div className="be-slip__fake__head">DUITNOW · TRANSFER RECEIPT</div>
                  <div className="be-slip__fake__row"><span>To</span><span>2990's SDN BHD</span></div>
                  <div className="be-slip__fake__row"><span>Ref</span><span>{edited.approvalCode || edited.id}</span></div>
                  <div className="be-slip__fake__amt">RM {window.fmtMoney(edited.paid)}.00</div>
                  <div className="be-slip__fake__row"><span>From</span><span>{edited.customer?.name?.toUpperCase().slice(0, 16)}</span></div>
                  <div className="be-slip__fake__row"><span>Date</span><span>{window.fmtDate(edited.placedAt)}</span></div>
                  <div className="be-slip__fake__row"><span>Status</span><span style={{ color: '#2F5D4F' }}>SUCCESS</span></div>
                </div>
              </div>
              <div className="be-slip__body">
                <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
                  Cross-check the slip against the order — amount, name, reference. You verify the match; Finance approves the deposit.
                </div>
                <div className="be-slip__rows">
                  <div className="be-slip__row">
                    <span>Method</span>
                    <span><i data-lucide={method.icon} style={{ width: 12, height: 12, verticalAlign: '-1px', marginRight: 4 }}></i>{method.label}</span>
                  </div>
                  <div className="be-slip__row">
                    <span>Reference</span><span>{edited.approvalCode || '—'}</span>
                  </div>
                  <div className="be-slip__row">
                    <span>Amount on slip</span>
                    <span>RM{window.fmtMoney(edited.paid)}</span>
                  </div>
                  <div className="be-slip__row">
                    <span>Order requires</span>
                    <span>RM{window.fmtMoney(Math.round((edited.subtotal + (edited.addonTotal || 0)) * 0.5))} <em style={{ color: 'var(--fg-muted)' }}>(50% min)</em></span>
                  </div>
                  <div className="be-slip__row be-slip__match">
                    <span>Match</span>
                    {edited.paid >= (edited.subtotal + (edited.addonTotal || 0)) * 0.5
                      ? <window.StatusPill tone="ok" icon="check" label="Amount OK" />
                      : <window.StatusPill tone="bad" icon="alert-triangle" label="Below 50%" />}
                  </div>
                </div>

                {edited.slipVerify === 'pending' && (
                  <>
                    <div className="be-verify-actions">
                      <button className="be-btn be-btn--primary" onClick={() => setVerify('verified')}>
                        <i data-lucide="shield-check"></i>Mark verified
                      </button>
                      <button className="be-btn be-btn--danger" onClick={() => setVerify('flagged')}>
                        <i data-lucide="flag"></i>Flag for sales
                      </button>
                    </div>
                    {cannotApprove}
                  </>
                )}

                {edited.slipVerify === 'verified' && (
                  <div className="be-verify-actions__hint" style={{ background: 'rgba(47,93,79,0.08)', borderLeftColor: '#2F5D4F' }}>
                    <i data-lucide="shield-check" style={{ color: '#2F5D4F' }}></i>
                    <span>
                      <strong>Verified by you{edited.slipVerifiedAt ? ' · ' + window.fmtTime(edited.slipVerifiedAt) : ''}.</strong>{' '}
                      <a style={{ color: 'var(--c-burnt)', textDecoration: 'underline', cursor: 'pointer' }} onClick={() => setVerify('pending')}>Undo</a>
                    </span>
                  </div>
                )}

                {edited.slipVerify === 'flagged' && (
                  <div className="be-verify-actions__hint">
                    <i data-lucide="flag"></i>
                    <span><strong>Flagged.</strong> Sales has been notified to re-check with the customer. <a style={{ color: 'var(--c-burnt)', textDecoration: 'underline', cursor: 'pointer' }} onClick={() => setVerify('pending')}>Re-open</a></span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Driver picker (when ready to dispatch) */}
          {edited.lane === 'ready' && (
            <div className="be-sec">
              <div className="be-sec__title">
                <i data-lucide="truck"></i>Assign driver to dispatch
              </div>
              <div className="be-driver-picker">
                {(drivers || []).filter(d => d.active).length === 0 ? (
                  <div className="be-empty-lane" style={{ padding: 18 }}>
                    <i data-lucide="user-plus"></i>
                    <div>No active drivers — add one in Settings → Drivers.</div>
                  </div>
                ) : (drivers || []).filter(d => d.active).map(d => (
                  <label
                    key={d.id}
                    className={`be-driver-card ${edited.driverId === d.id ? 'is-selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name="driver-pick"
                      checked={edited.driverId === d.id}
                      onChange={() => {
                        set('driverId', d.id);
                        set('driver', `${d.name} · ${d.vehicle || d.phone}`);
                      }}
                    />
                    <div className="be-driver-card__main">
                      <div className="be-driver-card__name">{d.name}</div>
                      <div className="be-driver-card__meta">{d.phone} · IC {d.icNumber}</div>
                      {d.vehicle && <div className="be-driver-card__veh">{d.vehicle}</div>}
                    </div>
                    <div className="be-driver-card__radio">
                      <i data-lucide={edited.driverId === d.id ? 'circle-check-big' : 'circle'}></i>
                    </div>
                  </label>
                ))}
              </div>
              <div className="be-confirm-grid">
                <label className="be-field">
                  <span>Confirmed delivery date *</span>
                  <input
                    type="date"
                    value={edited.confirmedDeliveryDate || ''}
                    onChange={e => set('confirmedDeliveryDate', e.target.value)}
                  />
                </label>
                <label className="be-field">
                  <span>Confirmation note</span>
                  <input
                    value={edited.confirmedWith || ''}
                    onChange={e => set('confirmedWith', e.target.value)}
                    placeholder="e.g. Phoned Ng Choon Hwa · 2pm window"
                  />
                </label>
              </div>
              {edited.delivery?.date && edited.confirmedDeliveryDate && edited.confirmedDeliveryDate !== edited.delivery.date && (
                <div className="be-confirm-override">
                  <i data-lucide="info"></i>
                  <span>
                    This will override the customer's expected date
                    {' '}<b>{new Date(edited.delivery.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</b>
                    {' '}→ <b>{new Date(edited.confirmedDeliveryDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</b>.
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Logistics note (when in logistics lane) */}
          {edited.lane === 'logistics' && (
            <div className="be-sec">
              <div className="be-sec__title">
                <i data-lucide="package-search"></i>Stock & re-order note
              </div>
              <textarea
                value={edited.stockNote || ''}
                onChange={e => set('stockNote', e.target.value)}
                placeholder="e.g. Tanah modular — re-order placed 3 May, ETA 8 May"
                style={{
                  width: '100%', minHeight: 70, padding: 12,
                  background: 'var(--be-rail)', border: '1px solid var(--line)',
                  borderRadius: 12, fontSize: 13, resize: 'vertical',
                }}
              />

              <div className="be-po-row">
                <div className="be-po-row__main">
                  <div className="be-po-row__title">
                    <i data-lucide="file-text"></i>Purchase Order
                  </div>
                  <div className="be-po-row__sub">
                    {edited.poIssued
                      ? <>PO issued · stock ordered with supplier{edited.poIssuedAt ? ` on ${new Date(edited.poIssuedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}` : ''}</>
                      : 'Issue a PO before stock can be marked ready to dispatch.'}
                  </div>
                </div>
                <button
                  className={`be-btn ${edited.poIssued ? 'be-btn--success' : 'be-btn--primary'}`}
                  onClick={() => {
                    if (edited.poIssued) return;
                    const next = { ...edited, poIssued: true, poIssuedAt: Date.now(), poIssuedBy: window.COORDINATOR.name };
                    setEdited(next);
                    onUpdate(next);
                    onToast(`PO issued for ${edited.id}`);
                  }}
                  disabled={edited.poIssued}
                >
                  <i data-lucide={edited.poIssued ? 'circle-check-big' : 'file-plus-2'}></i>
                  {edited.poIssued ? 'Done · PO issued' : 'Issue PO'}
                </button>
              </div>
            </div>
          )}

          {/* Driver + DO upload (when dispatched, not yet delivered) */}
          {edited.lane === 'dispatched' && (
            <div className="be-sec">
              <div className="be-sec__title">
                <i data-lucide="truck"></i>Dispatch & DO sign-off
              </div>
              <div className="be-info-grid">
                <div className="be-info">
                  <span className="be-info__lbl">Driver assigned</span>
                  <span className="be-info__val">{edited.driver || 'Not assigned'}</span>
                </div>
                <div className="be-info">
                  <span className="be-info__lbl">Customer slot</span>
                  <span className="be-info__val">{edited.confirmedWith || '—'}</span>
                </div>
                <div className="be-info">
                  <span className="be-info__lbl">Dispatched at</span>
                  <span className="be-info__val">{edited.dispatchedAt ? new Date(edited.dispatchedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                </div>
              </div>

              <div className="be-do-upload">
                <div className="be-do-upload__head">
                  <div className="be-do-upload__title">
                    <i data-lucide="file-signature"></i>Delivery Order (DO)
                  </div>
                  <div className="be-do-upload__sub">Upload the customer-signed DO photo, then confirm delivered.</div>
                </div>
                {edited.doUrl ? (
                  <div className="be-do-upload__filled">
                    <i data-lucide="image"></i>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{edited.doFileName || 'signed-DO.jpg'}</div>
                      <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>uploaded {edited.doUploadedAt ? new Date(edited.doUploadedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'just now'}</div>
                    </div>
                    <button className="be-btn be-btn--ghost" onClick={() => { set('doUrl', null); set('doFileName', null); set('doUploadedAt', null); }}>
                      <i data-lucide="x"></i>Replace
                    </button>
                  </div>
                ) : (
                  <label className="be-do-upload__drop">
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const f = e.target.files && e.target.files[0];
                        if (!f) return;
                        const url = URL.createObjectURL(f);
                        const next = { ...edited, doUrl: url, doFileName: f.name, doUploadedAt: Date.now() };
                        setEdited(next);
                        onUpdate(next);
                        onToast(`DO uploaded for ${edited.id}`);
                      }}
                    />
                    <i data-lucide="upload-cloud"></i>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>Click to upload signed DO</div>
                      <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>Image or PDF · driver-uploaded after handover</div>
                    </div>
                  </label>
                )}
              </div>
            </div>
          )}

          {/* Delivered confirmation (terminal lane) */}
          {edited.lane === 'delivered' && (
            <div className="be-sec">
              <div className="be-sec__title">
                <i data-lucide="circle-check-big"></i>Delivered
              </div>
              <div className="be-info-grid">
                <div className="be-info">
                  <span className="be-info__lbl">Driver</span>
                  <span className="be-info__val">{edited.driver || '—'}</span>
                </div>
                <div className="be-info">
                  <span className="be-info__lbl">Delivered at</span>
                  <span className="be-info__val">{edited.deliveredAt ? new Date(edited.deliveredAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                </div>
                <div className="be-info">
                  <span className="be-info__lbl">DO file</span>
                  <span className="be-info__val">{edited.doFileName || '—'}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Foot — advance status */}
        <div className="be-drawer__foot">
          <button className="be-btn be-btn--ghost" onClick={generatePDF}>
            <i data-lucide="file-down"></i>Generate PDF
          </button>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            {currentLaneIdx > 0 && currentLaneIdx < window.LANES.length - 1 && (
              <button
                className="be-btn be-btn--ghost"
                onClick={() => advance(window.LANES[currentLaneIdx - 1].id)}
              >
                <i data-lucide="arrow-left"></i>Step back
              </button>
            )}
            {/* Step 02 → 04 : standard "Move to next lane".
                01 (received) is moved by POS not coordinator, so no forward button.
                05 (dispatched) handled separately below. */}
            {edited.lane !== 'received' && currentLaneIdx < window.LANES.length - 2 && (() => {
              const blockedAtPO     = edited.lane === 'logistics' && !edited.poIssued;
              const blockedAtDriver = edited.lane === 'ready' && !edited.driverId;
              const blockedAtDate   = edited.lane === 'ready' && !edited.confirmedDeliveryDate;
              const blocked = blockedAtPO || blockedAtDriver || blockedAtDate;
              const reason  = blockedAtPO ? 'Issue PO first'
                            : blockedAtDriver ? 'Pick a driver first'
                            : blockedAtDate ? 'Confirm a delivery date first' : '';
              return (
                <button
                  className="be-btn be-btn--primary"
                  onClick={() => advance(window.LANES[currentLaneIdx + 1].id)}
                  disabled={blocked}
                  title={reason}
                >
                  Move to {window.LANES[currentLaneIdx + 1].title}<i data-lucide="arrow-right"></i>
                </button>
              );
            })()}
            {/* Step 05 (Dispatched) : Mark delivered, gated on DO upload */}
            {edited.lane === 'dispatched' && (
              <button
                className="be-btn be-btn--primary"
                onClick={() => advance('delivered')}
                disabled={!edited.doUrl}
                title={!edited.doUrl ? 'Upload signed DO first' : ''}
              >
                <i data-lucide="circle-check-big"></i>Mark as delivered
              </button>
            )}
            {currentLaneIdx === window.LANES.length - 1 && (
              <window.StatusPill tone="ok" icon="circle-check-big" label="Delivered" />
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

window.OrderDrawer = OrderDrawer;
