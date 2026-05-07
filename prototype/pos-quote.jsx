// 2990's POS — Quotation tab
// Sofa-focused custom configurator. The salesperson clicks compartments to
// build an L-shape (or straight) sofa, choose back cushion count, fabric,
// and the price totals live. Mattresses/bed-frames priced by size.
//
// Pricing model:
//   - Display unit (sample) sofa = RM2,990
//   - Custom sofa = sum of compartments
//   - Mattress / bed frame priced by size
//   - All inputs are configurable in POS_QUOTE_DATA — easy to update later.

const QUOTE_FABRICS = [
  { name: 'Oat',       hex: '#E3D0A6', surcharge: 0   },
  { name: 'Sand',      hex: '#D7C9A6', surcharge: 0   },
  { name: 'Stone',     hex: '#B5A98A', surcharge: 0   },
  { name: 'Slate',     hex: '#1F3A8A', surcharge: 0   },
  { name: 'Forest',    hex: '#2F5D4F', surcharge: 0   },
  { name: 'Cranberry', hex: '#B8331F', surcharge: 0   },
  { name: 'Charcoal',  hex: '#2A2A2C', surcharge: 0   },
  { name: 'Bouclé Cream', hex: '#F0E5C9', surcharge: 290 },
  { name: 'Velvet Rust', hex: '#A6471E', surcharge: 290 },
];

// Each compartment is a single building block. width/depth in cm.
const SOFA_COMPARTMENTS = [
  { id: 'arm-l',     name: 'Left arm',      type: 'arm',    side: 'left',  width: 22, depth: 95, price: 290 },
  { id: 'seat-1',    name: '1-seater',      type: 'seat',   width: 75, depth: 95, price: 1190 },
  { id: 'seat-2',    name: '2-seater',      type: 'seat',   width: 145, depth: 95, price: 2090 },
  { id: 'seat-3',    name: '3-seater',      type: 'seat',   width: 215, depth: 95, price: 2890 },
  { id: 'corner-l',  name: 'L-corner',      type: 'corner', width: 95, depth: 95, price: 1490 },
  { id: 'chaise',    name: 'Chaise',        type: 'chaise', width: 95, depth: 165, price: 1690 },
  { id: 'arm-r',     name: 'Right arm',     type: 'arm',    side: 'right', width: 22, depth: 95, price: 290 },
  { id: 'ottoman',   name: 'Ottoman',       type: 'ottoman',width: 75, depth: 75, price: 590 },
];

const SOFA_PRESETS = [
  { id: 'display', name: 'Display unit', detail: '2-seater · L-shape · 2 back cushions', price: 2990,
    parts: ['arm-l', 'seat-2', 'corner-l', 'arm-r'], cushions: 2 },
  { id: 'three-l', name: 'Family L', detail: '3+1 with chaise', price: null,
    parts: ['arm-l', 'seat-3', 'corner-l', 'chaise'], cushions: 3 },
  { id: 'long-l',  name: 'Long L',  detail: '3+2 with corner', price: null,
    parts: ['arm-l', 'seat-3', 'corner-l', 'seat-2', 'arm-r'], cushions: 4 },
  { id: 'straight',name: 'Straight',detail: '3-seater straight', price: null,
    parts: ['arm-l', 'seat-3', 'arm-r'], cushions: 2 },
];

// Size pricing for mattresses / bed frames
const SIZE_PRICES = {
  mattress: { 'Single': 1990, 'Super Single': 2290, 'Queen': 2990, 'King': 3490 },
  'bed-frame': { 'Single': 1690, 'Super Single': 1990, 'Queen': 2490, 'King': 2890 },
};

const BACK_CUSHION_PRICE = 190; // each
const FREE_CUSHIONS = 2; // first 2 included

// ─── compartment renderer (top-down 2D plan view) ─────────
function CompartmentBlock({ comp, fabricHex, scale = 1 }) {
  const w = comp.width * scale;
  const d = comp.depth * scale;
  const isArm = comp.type === 'arm';
  const isCorner = comp.type === 'corner';
  const isChaise = comp.type === 'chaise';
  const isOttoman = comp.type === 'ottoman';
  return (
    <div style={{
      width: w, height: d,
      background: fabricHex,
      border: '1.5px solid rgba(34,31,32,0.35)',
      borderRadius: isArm ? 8 : isOttoman ? 8 : 4,
      position: 'relative',
      boxShadow: 'inset 0 -8px 16px rgba(0,0,0,0.08), inset 0 2px 0 rgba(255,255,255,0.18)',
      flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {/* Backrest indicator (top edge) for seats */}
      {(comp.type === 'seat' || isCorner || isChaise) && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: '22%',
          background: 'rgba(0,0,0,0.18)',
          borderRadius: '3px 3px 0 0',
        }} />
      )}
      {/* Corner L marker */}
      {isCorner && (
        <div style={{
          position: 'absolute', top: 0, left: 0, width: '22%', height: '100%',
          background: 'rgba(0,0,0,0.18)',
          borderRadius: '3px 0 0 3px',
        }} />
      )}
      <span style={{
        fontFamily: 'var(--font-button)', fontSize: 10, fontWeight: 600,
        color: 'rgba(255,255,255,0.92)', letterSpacing: '0.02em',
        position: 'relative', zIndex: 1,
        textShadow: '0 1px 2px rgba(0,0,0,0.3)',
      }}>{comp.name}</span>
    </div>
  );
}

// Plan view of the assembled sofa
function SofaPlan({ parts, fabricHex, cushions, device }) {
  // determine the scale based on viewport width
  const totalWidth = parts.reduce((s, c) => s + c.width, 0);
  const maxDepth = Math.max(...parts.map(c => c.depth), 95);
  const containerWidth = device === 'mobile' ? 320 : device === 'tablet' ? 540 : 720;
  const scale = Math.min(containerWidth / Math.max(totalWidth, 200), 240 / maxDepth);

  return (
    <div style={{
      background: 'var(--c-cream)',
      border: '1px dashed var(--line-strong)',
      borderRadius: 16,
      padding: 28,
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
      alignItems: 'center',
    }}>
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 0,
        position: 'relative',
      }}>
        {parts.length === 0 ? (
          <div style={{ color: 'var(--fg-soft)', fontSize: 13, padding: '40px 60px', textAlign: 'center' }}>
            Tap a compartment below to start building.
          </div>
        ) : parts.map((c, i) => (
          <CompartmentBlock key={i} comp={c} fabricHex={fabricHex} scale={scale} />
        ))}
      </div>
      {parts.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          fontFamily: 'var(--font-button)', fontSize: 11, fontWeight: 600,
          letterSpacing: '0.12em', textTransform: 'uppercase',
          color: 'var(--fg-muted)',
        }}>
          <span>{totalWidth} cm wide</span>
          <span style={{ opacity: 0.4 }}>·</span>
          <span>{maxDepth} cm deep</span>
          <span style={{ opacity: 0.4 }}>·</span>
          <span>{cushions} back cushion{cushions !== 1 ? 's' : ''}</span>
        </div>
      )}
    </div>
  );
}

// ─── The Quotation tab body ───────────────────────────────
function QuoteTab({ device }) {
  const [tab, setTab] = React.useState('sofa');
  const [savedQuotes, setSavedQuotes] = React.useState([]);
  const [orderModalQuote, setOrderModalQuote] = React.useState(null);
  // Lifted sofa state so saved quotes can rehydrate it.
  const [sofaState, setSofaState] = React.useState(() => ({
    parts: SOFA_PRESETS[0].parts.map(id => SOFA_COMPARTMENTS.find(c => c.id === id)),
    cushions: SOFA_PRESETS[0].cushions,
    fabricIdx: 0,
    presetId: 'display',
  }));
  // Lifted mattress / bed-frame state for saving too.
  const [sizeState, setSizeState] = React.useState({
    mattress: { size: 'Queen', qty: 1 },
    'bed-frame': { size: 'Queen', qty: 1 },
  });

  function saveQuote(quote) {
    const q = { ...quote, id: 'Q-' + Date.now(), savedAt: new Date() };
    setSavedQuotes(curr => [q, ...curr].slice(0, 12));
  }
  function deleteQuote(id) {
    setSavedQuotes(curr => curr.filter(q => q.id !== id));
  }
  function loadQuote(q) {
    if (q.kind === 'sofa') {
      setSofaState(q.payload);
      setTab('sofa');
    } else {
      setSizeState(curr => ({ ...curr, [q.kind]: q.payload }));
      setTab(q.kind);
    }
  }
  function generateOrderFor(quote) {
    setOrderModalQuote(quote);
  }

  return (
    <React.Fragment>
      <div className="pos-section-head">
        <span className="pos-eyebrow">Quote · live price</span>
        <h2>Build it on the spot.</h2>
        <p>Walk the customer through compartments, sizes and fabrics. The price updates as you click. Save the quote if they want to think it over, or generate the order right away.</p>
      </div>

      <div className="pos-cat-tabs">
        <button className={`pos-cat-tab ${tab === 'sofa' ? 'is-active' : ''}`} onClick={() => setTab('sofa')}>
          <Icon name="sofa" size={14} /> Sofa · custom
        </button>
        <button className={`pos-cat-tab ${tab === 'mattress' ? 'is-active' : ''}`} onClick={() => setTab('mattress')}>
          <Icon name="bed" size={14} /> Mattress · by size
        </button>
        <button className={`pos-cat-tab ${tab === 'bed-frame' ? 'is-active' : ''}`} onClick={() => setTab('bed-frame')}>
          <Icon name="package" size={14} /> Bed frame · by size
        </button>
      </div>

      {tab === 'sofa' && (
        <SofaQuote
          device={device}
          state={sofaState}
          setState={setSofaState}
          onSaveQuote={saveQuote}
          onGenerateOrder={generateOrderFor}
          savedQuotes={savedQuotes}
          onLoadQuote={loadQuote}
          onDeleteQuote={deleteQuote}
        />
      )}
      {tab === 'mattress' && (
        <SizeQuote
          category="mattress"
          device={device}
          state={sizeState.mattress}
          setState={s => setSizeState(curr => ({ ...curr, mattress: typeof s === 'function' ? s(curr.mattress) : s }))}
          onSaveQuote={saveQuote}
          onGenerateOrder={generateOrderFor}
          savedQuotes={savedQuotes}
          onLoadQuote={loadQuote}
          onDeleteQuote={deleteQuote}
        />
      )}
      {tab === 'bed-frame' && (
        <SizeQuote
          category="bed-frame"
          device={device}
          state={sizeState['bed-frame']}
          setState={s => setSizeState(curr => ({ ...curr, 'bed-frame': typeof s === 'function' ? s(curr['bed-frame']) : s }))}
          onSaveQuote={saveQuote}
          onGenerateOrder={generateOrderFor}
          savedQuotes={savedQuotes}
          onLoadQuote={loadQuote}
          onDeleteQuote={deleteQuote}
        />
      )}

      {orderModalQuote && (
        <NewOrderModal
          quote={orderModalQuote}
          onClose={() => setOrderModalQuote(null)}
          onComplete={() => {
            // Once order is placed, remove this saved quote (if any) so it doesn't linger.
            if (orderModalQuote.id) deleteQuote(orderModalQuote.id);
          }}
        />
      )}
    </React.Fragment>
  );
}

// Saved quotes list — appears under the live-quote panel.
function SavedQuotesList({ quotes, onLoad, onDelete }) {
  return (
    <div className="pos-quote-saved">
      <div className="pos-quote-saved__title">
        <span>Saved quotes</span>
        <span style={{ fontSize: 10, color: 'var(--fg-soft)' }}>{quotes.length}</span>
      </div>
      {quotes.length === 0 ? (
        <div className="pos-quote-saved__empty">None yet — hit Save quote when a customer wants to think it over.</div>
      ) : (
        <div className="pos-quote-saved__list">
          {quotes.map(q => (
            <div key={q.id} className="pos-quote-saved__item" onClick={() => onLoad(q)}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="pos-quote-saved__name">{q.summary}</div>
                <div className="pos-quote-saved__detail">{q.id} · {q.savedAt.toLocaleString('en-MY', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
              </div>
              <span className="pos-quote-saved__price">{posPrice(q.total, 9)}</span>
              <button className="pos-quote-saved__del" onClick={(e) => { e.stopPropagation(); onDelete(q.id); }} aria-label="Delete">
                <Icon name="x" size={13} stroke={2} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Sofa configurator ────────────────────────────────────
function SofaQuote({ device, state, setState, onSaveQuote, onGenerateOrder, savedQuotes, onLoadQuote, onDeleteQuote }) {
  const { parts, cushions, fabricIdx, presetId } = state;
  const setParts = (v) => setState(s => ({ ...s, parts: typeof v === 'function' ? v(s.parts) : v }));
  const setCushions = (v) => setState(s => ({ ...s, cushions: typeof v === 'function' ? v(s.cushions) : v }));
  const setFabricIdx = (v) => setState(s => ({ ...s, fabricIdx: typeof v === 'function' ? v(s.fabricIdx) : v }));
  const setPresetId = (v) => setState(s => ({ ...s, presetId: typeof v === 'function' ? v(s.presetId) : v }));

  const fabric = QUOTE_FABRICS[fabricIdx];

  const isDisplay = presetId === 'display';

  // Pricing
  const compartmentSubtotal = parts.reduce((s, c) => s + c.price, 0);
  const cushionSurcharge = Math.max(0, cushions - FREE_CUSHIONS) * BACK_CUSHION_PRICE;
  const fabricSurcharge = fabric.surcharge;
  const total = isDisplay ? 2990 : compartmentSubtotal + cushionSurcharge + fabricSurcharge;

  function applyPreset(p) {
    setParts(p.parts.map(id => SOFA_COMPARTMENTS.find(c => c.id === id)));
    setCushions(p.cushions);
    setPresetId(p.id);
  }

  function addPart(comp) {
    if (presetId === 'display') setPresetId('custom');
    // Insert before the right arm if one exists, otherwise at the end
    setParts(curr => {
      const newPart = { ...comp };
      if (comp.id === 'arm-l') return [newPart, ...curr.filter(p => p.id !== 'arm-l')];
      if (comp.id === 'arm-r') return [...curr.filter(p => p.id !== 'arm-r'), newPart];
      const rIdx = curr.findIndex(p => p.id === 'arm-r');
      if (rIdx >= 0) return [...curr.slice(0, rIdx), newPart, ...curr.slice(rIdx)];
      return [...curr, newPart];
    });
  }

  function removePart(idx) {
    if (presetId === 'display') setPresetId('custom');
    setParts(curr => curr.filter((_, i) => i !== idx));
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: device === 'mobile' ? '1fr' : '1fr 320px', gap: 24 }}>
      <div>
        {/* Presets */}
        <div className="pos-eyebrow" style={{ marginBottom: 8 }}>Start from</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
          {SOFA_PRESETS.map(p => (
            <button key={p.id}
              className={`pos-option ${presetId === p.id ? 'is-selected' : ''}`}
              style={{ flexDirection: 'column', alignItems: 'flex-start', height: 'auto', padding: '10px 16px', gap: 2 }}
              onClick={() => applyPreset(p)}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</span>
              <span style={{ fontSize: 11, color: presetId === p.id ? 'rgba(255,249,235,0.7)' : 'var(--fg-muted)', fontWeight: 500, letterSpacing: 0 }}>{p.detail}</span>
            </button>
          ))}
        </div>

        {/* Plan view */}
        <SofaPlan parts={parts} fabricHex={fabric.hex} cushions={cushions} device={device} />

        {/* Selected parts list with remove */}
        {parts.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div className="pos-eyebrow" style={{ marginBottom: 8 }}>Compartments in this build</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {parts.map((c, i) => (
                <button key={i} className="pos-tag" style={{ cursor: 'pointer', padding: '6px 10px 6px 12px', display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={() => removePart(i)}>
                  {c.name} <span style={{ fontFamily: 'var(--font-mark)', fontWeight: 900, fontStretch: '80%' }}>{posFmt(c.price)}</span>
                  <Icon name="x" size={10} stroke={2.5} />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Add compartments */}
        <div style={{ marginTop: 24 }}>
          <div className="pos-eyebrow" style={{ marginBottom: 8 }}>Add a compartment</div>
          <div className="pos-addon-grid">
            {SOFA_COMPARTMENTS.map(c => (
              <button key={c.id} className="pos-addon" onClick={() => addPart(c)}>
                <span className="pos-addon__icon" style={{ background: fabric.hex, color: '#fff' }}>
                  <Icon name={c.type === 'arm' ? 'square' : c.type === 'ottoman' ? 'square' : 'sofa'} size={16} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="pos-addon__name">{c.name}</div>
                  <div className="pos-addon__price">{c.width}×{c.depth}cm · + {posFmt(c.price)}</div>
                </div>
                <span className="pos-addon__check"><Icon name="plus" size={12} stroke={2.5} /></span>
              </button>
            ))}
          </div>
        </div>

        {/* Back cushions */}
        <div className="pos-config__group" style={{ marginTop: 24 }}>
          <div className="pos-config__group-label">
            Back cushions <span>{cushions} · first {FREE_CUSHIONS} included, then + {posFmt(BACK_CUSHION_PRICE)} each</span>
          </div>
          <div className="pos-row" style={{ gap: 12 }}>
            <button className="pos-icon-btn" onClick={() => setCushions(c => Math.max(0, c - 1))}><Icon name="minus" size={14} /></button>
            <div style={{ fontFamily: 'var(--font-mark)', fontWeight: 900, fontStretch: '80%', fontSize: 32, color: 'var(--c-burnt)', minWidth: 40, textAlign: 'center', letterSpacing: '-0.02em' }}>{cushions}</div>
            <button className="pos-icon-btn" onClick={() => setCushions(c => Math.min(8, c + 1))}><Icon name="plus" size={14} /></button>
          </div>
        </div>

        {/* Fabric */}
        <div className="pos-config__group" style={{ marginTop: 24 }}>
          <div className="pos-config__group-label">
            Fabric <span>{fabric.name}{fabric.surcharge ? ' · + ' + posFmt(fabric.surcharge) : ''}</span>
          </div>
          <div className="pos-swatches">
            {QUOTE_FABRICS.map((f, i) => (
              <button key={f.name} aria-label={f.name}
                className={`pos-swatch ${fabricIdx === i ? 'is-selected' : ''}`}
                style={{ background: f.hex, position: 'relative' }}
                onClick={() => setFabricIdx(i)}>
                {f.surcharge > 0 && <span style={{ position: 'absolute', top: -4, right: -4, width: 14, height: 14, borderRadius: 999, background: 'var(--c-orange)', color: '#fff', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</span>}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Live quote panel */}
      <div className="pos-card-block" style={{ position: 'sticky', top: 16, alignSelf: 'start' }}>
        <h3>Live quote</h3>
        <div className="pos-stack-sm" style={{ marginBottom: 12 }}>
          {isDisplay && (
            <div style={{ background: 'var(--c-cream)', borderRadius: 12, padding: '10px 12px', fontSize: 12, color: 'var(--c-burnt)', display: 'flex', gap: 8, alignItems: 'center' }}>
              <Icon name="check" size={14} stroke={2.5} />
              <span>Display unit pricing — flat <strong>{posFmt(2990)}</strong>.</span>
            </div>
          )}
          {!isDisplay && (
            <React.Fragment>
              {parts.map((c, i) => (
                <div key={i} className="pos-cart__line" style={{ fontSize: 13 }}>
                  <span>{c.name}</span><span>{posFmt(c.price)}</span>
                </div>
              ))}
              <div className="pos-cart__line" style={{ fontSize: 13 }}>
                <span>Back cushions ({cushions})</span>
                <span>{cushionSurcharge ? posFmt(cushionSurcharge) : 'Included'}</span>
              </div>
              {fabricSurcharge > 0 && (
                <div className="pos-cart__line" style={{ fontSize: 13 }}>
                  <span>Fabric · {fabric.name}</span><span>{posFmt(fabricSurcharge)}</span>
                </div>
              )}
              <div className="pos-cart__line" style={{ fontSize: 13 }}>
                <span>Delivery & assembly</span><span style={{ color: 'var(--c-burnt)', fontWeight: 600 }}>Included</span>
              </div>
            </React.Fragment>
          )}
        </div>
        <div className="pos-cart__line pos-cart__line--total" style={{ paddingTop: 10, borderTop: '1px dashed var(--line)' }}>
          <span style={{ fontWeight: 600, color: 'var(--c-ink)' }}>Total</span>
          <span className="pos-cart__total-num" style={{ fontSize: 32 }}>{posPrice(total, 12)}</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 6, lineHeight: 1.5 }}>
          Quote valid for 14 days. Lead time 4–6 weeks for custom builds.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
          <button className="pos-btn pos-btn--primary pos-btn--block" onClick={() => onGenerateOrder({
            kind: 'sofa',
            summary: isDisplay ? 'Display unit sofa' : `Custom sofa · ${parts.length} compartment${parts.length !== 1 ? 's' : ''}`,
            total,
            payload: state,
          })}>
            <Icon name="arrow-right" size={14} /> Generate order
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="pos-btn pos-btn--ghost" style={{ flex: 1 }} onClick={() => onSaveQuote({
              kind: 'sofa',
              summary: isDisplay ? 'Display unit sofa' : `Custom sofa · ${parts.length} pcs`,
              total,
              payload: state,
            })}>
              <Icon name="receipt" size={13} /> Save quote
            </button>
            <button className="pos-btn pos-btn--ghost" style={{ flex: 1 }}>
              <Icon name="mail" size={13} /> Email
            </button>
          </div>
        </div>

        <SavedQuotesList quotes={savedQuotes} onLoad={onLoadQuote} onDelete={onDeleteQuote} />
      </div>
    </div>
  );
}

// ─── Mattress / bed frame size-based quote ───────────────
function SizeQuote({ category, device, state, setState, onSaveQuote, onGenerateOrder, savedQuotes, onLoadQuote, onDeleteQuote }) {
  const sizes = Object.keys(SIZE_PRICES[category]);
  const size = state.size || sizes[2] || sizes[0];
  const qty = state.qty ?? 1;
  const setSize = (s) => setState(curr => ({ ...curr, size: typeof s === 'function' ? s(curr.size) : s }));
  const setQty = (q) => setState(curr => ({ ...curr, qty: typeof q === 'function' ? q(curr.qty) : q }));
  const price = SIZE_PRICES[category][size];
  const total = price * qty;
  const label = category === 'mattress' ? 'Mattress' : 'Bed frame';

  return (
    <div style={{ display: 'grid', gridTemplateColumns: device === 'mobile' ? '1fr' : '1fr 320px', gap: 24 }}>
      <div>
        <div className="pos-eyebrow" style={{ marginBottom: 8 }}>Size</div>
        <div className="pos-options" style={{ marginBottom: 24 }}>
          {sizes.map(s => (
            <button key={s} className={`pos-option ${size === s ? 'is-selected' : ''}`}
              style={{ flexDirection: 'column', alignItems: 'flex-start', height: 'auto', padding: '12px 18px', gap: 4, minWidth: 130 }}
              onClick={() => setSize(s)}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{s}</span>
              <span style={{ fontFamily: 'var(--font-mark)', fontWeight: 900, fontStretch: '80%', fontSize: 18, letterSpacing: '-0.02em', color: size === s ? 'var(--c-cream)' : 'var(--c-burnt)' }}>
                {posPrice(SIZE_PRICES[category][s], 8)}
              </span>
            </button>
          ))}
        </div>

        <div className="pos-eyebrow" style={{ marginBottom: 8 }}>Quantity</div>
        <div className="pos-row" style={{ gap: 12, marginBottom: 24 }}>
          <button className="pos-icon-btn" onClick={() => setQty(q => Math.max(1, q - 1))}><Icon name="minus" size={14} /></button>
          <div style={{ fontFamily: 'var(--font-mark)', fontWeight: 900, fontStretch: '80%', fontSize: 32, minWidth: 40, textAlign: 'center', letterSpacing: '-0.02em' }}>{qty}</div>
          <button className="pos-icon-btn" onClick={() => setQty(q => q + 1)}><Icon name="plus" size={14} /></button>
        </div>

        <div style={{ background: 'var(--c-cream)', borderRadius: 12, padding: 16, fontSize: 13, color: 'var(--fg-muted)', maxWidth: 480 }}>
          {category === 'mattress'
            ? 'Sizes priced individually. Free white-glove delivery, old-mattress removal included on request.'
            : 'Frame priced by size. Slatted base included; no boxspring needed.'}
        </div>
      </div>

      <div className="pos-card-block" style={{ position: 'sticky', top: 16, alignSelf: 'start' }}>
        <h3>Live quote</h3>
        <div className="pos-stack-sm" style={{ marginBottom: 12 }}>
          <div className="pos-cart__line" style={{ fontSize: 13 }}>
            <span>{label} · {size}</span><span>{posFmt(price)}</span>
          </div>
          <div className="pos-cart__line" style={{ fontSize: 13 }}>
            <span>Quantity</span><span>× {qty}</span>
          </div>
          <div className="pos-cart__line" style={{ fontSize: 13 }}>
            <span>Delivery & assembly</span><span style={{ color: 'var(--c-burnt)', fontWeight: 600 }}>Included</span>
          </div>
        </div>
        <div className="pos-cart__line pos-cart__line--total" style={{ paddingTop: 10, borderTop: '1px dashed var(--line)' }}>
          <span style={{ fontWeight: 600 }}>Total</span>
          <span className="pos-cart__total-num" style={{ fontSize: 32 }}>{posPrice(total, 12)}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
          <button className="pos-btn pos-btn--primary pos-btn--block" onClick={() => onGenerateOrder({
            kind: category,
            summary: `${label} · ${size} × ${qty}`,
            total,
            payload: { size, qty },
          })}>
            <Icon name="arrow-right" size={14} /> Generate order
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="pos-btn pos-btn--ghost" style={{ flex: 1 }} onClick={() => onSaveQuote({
              kind: category,
              summary: `${label} · ${size} × ${qty}`,
              total,
              payload: { size, qty },
            })}>
              <Icon name="receipt" size={13} /> Save quote
            </button>
            <button className="pos-btn pos-btn--ghost" style={{ flex: 1 }}>
              <Icon name="mail" size={13} /> Email
            </button>
          </div>
        </div>

        <SavedQuotesList quotes={savedQuotes} onLoad={onLoadQuote} onDelete={onDeleteQuote} />
      </div>
    </div>
  );
}

window.QuoteTab = QuoteTab;
