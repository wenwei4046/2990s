// 2990's Backend Portal — Orders board + Detail drawer
const { useState: useStateO, useMemo: useMemoO, useEffect: useEffectO } = React;

function OrderCard({ order, onOpen }) {
  const products = order.cart.map(c => window.PRODUCTS.find(p => p.id === c.id)).filter(Boolean);
  const photos = products.slice(0, 3);
  const more = products.length - 3;
  const slip = window.SLIP_VERIFY[order.slipVerify || 'none'];
  const isLate = order.delivery?.date && new Date(order.delivery.date) < new Date() && order.lane !== 'delivered';
  const needsPO = order.lane === 'logistics' && !order.poIssued;
  const initials = (order.staff || '').split(' ').map(s => s[0]).slice(0, 2).join('');

  return (
    <button className="be-card" onClick={() => onOpen(order)}>
      <div className="be-card__head">
        <span className="be-card__id">{order.id}</span>
        <span className="be-card__when">{window.fmtTime(order.placedAt)}</span>
      </div>
      <div>
        <div className="be-card__name">{order.customer?.name || 'Walk-in'}</div>
        <div className="be-card__address">
          <i data-lucide="map-pin"></i>
          <span>{order.customer?.city || order.customer?.address?.slice(0, 32) || 'Address pending'}</span>
        </div>
      </div>
      <div className="be-card__photos">
        {photos.map((p, i) => (
          <div key={i} className="be-card__photo" style={{ backgroundImage: `url(${p.img})` }}></div>
        ))}
        {more > 0 && (
          <div className="be-card__photo be-card__photo--more">+{more}</div>
        )}
      </div>
      <div className="be-card__row">
        <span className="be-card__total">
          <sup>RM</sup>{window.fmtMoney(order.subtotal + (order.addonTotal || 0))}
        </span>
        <div className="be-card__statuses">
          <window.StatusPill tone={slip.tone} icon={slip.icon} label={slip.label} />
          {needsPO && <window.StatusPill tone="warn" icon="file-warning" label="Issue PO" />}
          {isLate && <window.StatusPill tone="bad" icon="alert-triangle" label="Late" />}
        </div>
      </div>
      <div className="be-card__row" style={{ paddingTop: 8, borderTop: '1px solid var(--line)' }}>
        <div className="be-card__staff">
          <span className="be-card__staff__dot">{initials}</span>
          {order.staff}
        </div>
        <div className="be-card__staff">
          <i data-lucide="calendar" style={{ width: 12, height: 12 }}></i>
          {order.delivery?.date ? window.fmtDate(order.delivery.date) : 'Date TBD'}
        </div>
      </div>
    </button>
  );
}

function OrdersBoard({ orders, onOpenOrder, focusLane }) {
  const [query, setQuery] = useStateO('');
  const [tab, setTab] = useStateO('all'); // all | mine | late
  const [view, setView] = useStateO('overall'); // overall | <laneId>
  const [poScanOpen, setPoScanOpen] = useStateO(false);
  useEffectO(() => { if (focusLane) setView(focusLane); }, [focusLane]);
  window.useLucideBE([orders.length, query, tab, view, focusLane, poScanOpen]);

  const filtered = useMemoO(() => {
    const q = query.toLowerCase();
    return orders.filter(o => {
      if (tab === 'mine' && o.staff !== window.COORDINATOR.name) {} // coordinator handles all
      if (tab === 'late') {
        const late = o.delivery?.date && new Date(o.delivery.date) < new Date() && o.lane !== 'delivered';
        if (!late) return false;
      }
      if (!q) return true;
      return o.id.toLowerCase().includes(q) ||
             (o.customer?.name || '').toLowerCase().includes(q) ||
             (o.customer?.phone || '').includes(q);
    });
  }, [orders, query, tab]);

  const lanes = useMemoO(() => {
    const map = {};
    window.LANES.forEach(l => map[l.id] = []);
    filtered.forEach(o => { if (map[o.lane]) map[o.lane].push(o); });
    return map;
  }, [filtered]);

  const counts = {
    all: orders.length,
    late: orders.filter(o => o.delivery?.date && new Date(o.delivery.date) < new Date() && o.lane !== 'delivered').length,
    today: orders.filter(o => o.placedAt > Date.now() - 86400000).length,
  };

  const activeLane = view !== 'overall' ? window.LANES.find(l => l.id === view) : null;

  return (
    <div className="be-page">
      <div className="be-subtabs">
        <button
          className={`be-subtab ${view === 'overall' ? 'is-active' : ''}`}
          onClick={() => setView('overall')}
        >
          <i data-lucide="layout-grid"></i>
          Overall
          <span className="be-subtab__count">{filtered.length}</span>
        </button>
        {window.LANES.map(l => (
          <button
            key={l.id}
            className={`be-subtab ${view === l.id ? 'is-active' : ''}`}
            onClick={() => setView(l.id)}
          >
            <span className="be-subtab__num">{l.num}</span>
            {l.title}
            <span className="be-subtab__count">{lanes[l.id].length}</span>
          </button>
        ))}
      </div>

      <div className="be-board-toolbar">
        <div className="be-tabs">
          <div className={`be-tab ${tab === 'all' ? 'is-active' : ''}`} onClick={() => setTab('all')}>
            All<span className="be-tab__count">{counts.all}</span>
          </div>
          <div className={`be-tab ${tab === 'late' ? 'is-active' : ''}`} onClick={() => setTab('late')}>
            Running late<span className="be-tab__count">{counts.late}</span>
          </div>
          <div className={`be-tab ${tab === 'today' ? 'is-active' : ''}`} onClick={() => setTab('today')}>
            Last 24h<span className="be-tab__count">{counts.today}</span>
          </div>
        </div>
        <div className="be-search" style={{ width: 280 }}>
          <i data-lucide="search"></i>
          <input placeholder="Order ID, name, phone…" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="be-pill"><i data-lucide="filter"></i>Filter</button>
          <button className="be-pill"><i data-lucide="download"></i>Export</button>
        </div>
      </div>

      {view === 'overall' ? (
        <div className="be-board">
          {window.LANES.map(l => (
            <div key={l.id} className="be-lane">
              <div className="be-lane__head" onClick={() => setView(l.id)} style={{ cursor: 'pointer' }} title={`Open ${l.title}`}>
                <div className="be-lane__num">{l.num}</div>
                <div>
                  <div className="be-lane__title">{l.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 2 }}>{l.sub}</div>
                </div>
                <div className="be-lane__count">{lanes[l.id].length}</div>
              </div>
              <div className="be-lane__body">
                {lanes[l.id].length === 0 ? (
                  <div className="be-empty-lane">
                    <i data-lucide={l.icon}></i>
                    <div>{l.terminal ? 'Showroom marks delivered' : 'Nothing here yet'}</div>
                  </div>
                ) : lanes[l.id].map(o => (
                  <OrderCard key={o.id} order={o} onOpen={onOpenOrder} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="be-lane-view">
          <div className="be-lane-view__head">
            <div className="be-lane__num be-lane-view__num">{activeLane.num}</div>
            <div style={{ flex: 1 }}>
              <div className="be-lane-view__title">{activeLane.title}</div>
              <div className="be-lane-view__sub">{activeLane.sub}</div>
            </div>
            {activeLane.id === 'logistics' && (
              <button
                className="be-po-scan-btn"
                onClick={() => setPoScanOpen(true)}
              >
                <i data-lucide="scan-line"></i>
                <span>
                  <strong>Scan PO needed</strong>
                  <small>{lanes.logistics.filter(o => !o.poIssued).length} orders pending PO</small>
                </span>
              </button>
            )}
            <div className="be-lane-view__count">
              <span>{lanes[activeLane.id].length}</span>
              <small>orders</small>
            </div>
          </div>
          <div className="be-lane-view__body">
            {lanes[activeLane.id].length === 0 ? (
              <div className="be-empty-lane be-empty-lane--big">
                <i data-lucide={activeLane.icon}></i>
                <div>{activeLane.terminal ? 'Nothing delivered yet' : 'No orders in this stage'}</div>
              </div>
            ) : lanes[activeLane.id].map(o => (
              <OrderCard key={o.id} order={o} onOpen={onOpenOrder} />
            ))}
          </div>
        </div>
      )}
      {poScanOpen && (
        <PoScanModal
          orders={lanes.logistics.filter(o => !o.poIssued)}
          onClose={() => setPoScanOpen(false)}
        />
      )}
    </div>
  );
}

// ─── PO Scan Modal ───────────────────────────────────────────────────────
// Aggregates every logistics order that hasn't issued a PO yet, breaks each
// product down into the line items a supplier needs to fulfil:
//   • Mattress + bundled pillows (cushions in the same cart) → separate SKUs
//   • Sofa → split into compartments (each compartment = one SKU + colour + size + qty)
//   • Bed frame / dining / accessory → single SKU + qty
// Output is grouped by supplier so coordinator can fire one PO per supplier.

// Mock supplier mapping by product category — coordinator-side reference.
const PO_SUPPLIER = {
  mattress: { code: 'SLP', name: 'Sleepworks Sdn Bhd' },
  sofa:     { code: 'KFA', name: 'Kraf Furnitur Asia' },
  bedframe: { code: 'KFA', name: 'Kraf Furnitur Asia' },
  dining:   { code: 'OAK', name: 'Oakline Workshop' },
  bathroom: { code: 'AQS', name: 'Aquasense Bath Co.' },
  kids:     { code: 'KID', name: 'Pinetop Kids Co.' },
  accessory:{ code: 'HMG', name: 'Homegoods Trading' },
};

// Mock fabric/colour per sofa product (not stored in cart yet — derived from
// product id so the same order always reads the same colour).
const SOFA_FABRIC = {
  's-noor':   { fabric: 'Boucle',     colour: 'Cream',  swatch: '#EEDFC2' },
  's-tanah':  { fabric: 'Linen',      colour: 'Sand',   swatch: '#D6BE94' },
  's-rumah':  { fabric: 'Leather',    colour: 'Walnut', swatch: '#7A4B2B' },
  's-petang': { fabric: 'Wool',       colour: 'Cream',  swatch: '#E9DBC1' },
};

// Mock compartment breakdown for each sofa SKU. In a real build this would
// come from the configurator state stored on the order; here we derive a
// plausible breakdown by sofa size.
const SOFA_COMPARTMENTS = {
  's-noor':   [ // 3-seater
    { sku: 'SOF-101-A', label: '1A · Left arm',   size: '95×95cm', qty: 1 },
    { sku: 'SOF-101-N', label: '1NA · Armless',   size: '95×95cm', qty: 1 },
    { sku: 'SOF-101-B', label: '1A · Right arm',  size: '95×95cm', qty: 1 },
  ],
  's-tanah':  [ // L-shape modular
    { sku: 'SOF-102-A', label: '2A · Left arm',   size: '160×95cm',  qty: 1 },
    { sku: 'SOF-102-C', label: '1C · Corner SE',  size: '95×95cm',   qty: 1 },
    { sku: 'SOF-102-L', label: 'L · Right',       size: '95×165cm',  qty: 1 },
  ],
  's-rumah':  [ // 2-seater loveseat
    { sku: 'SOF-103-A', label: '2A · Left arm',   size: '160×95cm',  qty: 1 },
  ],
  's-petang': [ // armchair
    { sku: 'SOF-104-A', label: '1A · Armchair',   size: '78×95cm',   qty: 1 },
  ],
};

// Mock pillow/bedding bundles for mattresses — pillows packaged with the
// mattress at the same supplier.
const MATTRESS_PILLOWS = {
  'm-cloud':  { sku: 'PIL-002', name: 'Cloud memory pillow', qty: 2 },
  'm-oak':    { sku: 'PIL-001', name: 'Oak comfort pillow',  qty: 2 },
  'm-linen':  { sku: 'PIL-003', name: 'Linen breathable pillow', qty: 2 },
  'm-dusk':   { sku: 'PIL-002', name: 'Cloud memory pillow', qty: 2 },
};

function buildPoLines(order) {
  // Returns: [{ supplierCode, supplierName, lines: [{...}] }]
  const bySupplier = {};
  order.cart.forEach(item => {
    const product = window.PRODUCTS.find(p => p.id === item.id);
    if (!product) return;
    const supplier = PO_SUPPLIER[product.cat] || PO_SUPPLIER.accessory;
    const key = supplier.code;
    if (!bySupplier[key]) bySupplier[key] = { supplier, lines: [] };

    if (product.cat === 'sofa' && SOFA_COMPARTMENTS[product.id]) {
      // Sofa → compartments + fabric
      const fab = SOFA_FABRIC[product.id] || { fabric: 'Linen', colour: 'Natural', swatch: '#D6BE94' };
      bySupplier[key].lines.push({
        kind: 'sofa',
        product,
        fabric: fab,
        compartments: SOFA_COMPARTMENTS[product.id].map(c => ({ ...c, qty: c.qty * (item.qty || 1) })),
        qty: item.qty || 1,
      });
    } else if (product.cat === 'mattress') {
      // Mattress + paired pillows
      const lines = [{
        kind: 'simple', sku: product.sku, name: product.name, size: product.size, qty: item.qty || 1,
      }];
      const pillow = MATTRESS_PILLOWS[product.id];
      if (pillow) lines.push({
        kind: 'pillow', sku: pillow.sku, name: pillow.name, size: 'Std 50×70cm',
        qty: pillow.qty * (item.qty || 1), bundledWith: product.sku,
      });
      bySupplier[key].lines.push({ kind: 'mattress', product, sublines: lines, qty: item.qty || 1 });
    } else {
      bySupplier[key].lines.push({
        kind: 'simple', product,
        sku: product.sku, name: product.name, size: product.size,
        qty: item.qty || 1,
      });
    }
  });
  return Object.values(bySupplier);
}

function PoScanModal({ orders, onClose }) {
  window.useLucideBE([orders.length]);
  // Aggregate across all orders into a single supplier → SKU → qty rollup
  const rollup = useMemoO(() => {
    const map = {}; // supplierCode → { supplier, items: { sku → {sku,name,size,qty,colour,orderIds:[]} } }
    orders.forEach(o => {
      buildPoLines(o).forEach(group => {
        const k = group.supplier.code;
        if (!map[k]) map[k] = { supplier: group.supplier, items: {} };
        const items = map[k].items;
        const addItem = ({ sku, name, size, qty, colour, fabric }) => {
          const key = sku + (colour ? `|${colour}` : '');
          if (!items[key]) items[key] = { sku, name, size, qty: 0, colour, fabric, orderIds: new Set() };
          items[key].qty += qty;
          items[key].orderIds.add(o.id);
        };
        group.lines.forEach(line => {
          if (line.kind === 'sofa') {
            line.compartments.forEach(c => addItem({
              sku: c.sku, name: `${line.product.name} · ${c.label}`,
              size: c.size, qty: c.qty,
              colour: line.fabric.colour, fabric: line.fabric,
            }));
          } else if (line.kind === 'mattress') {
            line.sublines.forEach(s => addItem({ sku: s.sku, name: s.name, size: s.size, qty: s.qty }));
          } else {
            addItem({ sku: line.sku, name: line.name, size: line.size, qty: line.qty });
          }
        });
      });
    });
    return map;
  }, [orders]);

  const supplierList = Object.values(rollup);
  const totalSkus = supplierList.reduce((n, g) => n + Object.keys(g.items).length, 0);
  const totalUnits = supplierList.reduce((n, g) => n + Object.values(g.items).reduce((m, it) => m + it.qty, 0), 0);

  const [view, setView] = useStateO('rollup'); // rollup | by-order

  return (
    <div className="be-modal" onClick={e => e.target.classList.contains('be-modal') && onClose()}>
      <div className="be-modal__panel be-po-modal">
        <div className="be-po-modal__head">
          <div>
            <span className="pos-eyebrow" style={{ color: 'var(--c-burnt)' }}>Awaiting logistics · PO scan</span>
            <h2 className="be-po-modal__title">Issue Purchase Orders</h2>
            <div className="be-po-modal__sub">
              {orders.length} orders · {totalSkus} unique SKUs · {totalUnits} units · {supplierList.length} suppliers
            </div>
          </div>
          <button className="be-iconbtn be-po-modal__close" onClick={onClose}>
            <i data-lucide="x"></i>
          </button>
        </div>

        <div className="be-po-modal__tabs">
          <button
            className={`be-po-tab ${view === 'rollup' ? 'is-active' : ''}`}
            onClick={() => setView('rollup')}
          >
            <i data-lucide="layers"></i>
            Roll-up by supplier
          </button>
          <button
            className={`be-po-tab ${view === 'by-order' ? 'is-active' : ''}`}
            onClick={() => setView('by-order')}
          >
            <i data-lucide="list-ordered"></i>
            Detail by order
          </button>
        </div>

        <div className="be-po-modal__body">
          {view === 'rollup' ? (
            supplierList.length === 0 ? (
              <div className="be-empty-lane be-empty-lane--big">
                <i data-lucide="check-circle-2"></i>
                <div>All POs already issued — nothing to scan.</div>
              </div>
            ) : supplierList.map(g => (
              <div key={g.supplier.code} className="be-po-supplier">
                <div className="be-po-supplier__head">
                  <div className="be-po-supplier__name">
                    <span className="be-po-supplier__code">{g.supplier.code}</span>
                    {g.supplier.name}
                  </div>
                  <button className="be-btn be-btn--primary be-po-supplier__action">
                    <i data-lucide="file-output"></i>
                    Generate PO
                  </button>
                </div>
                <table className="be-po-table">
                  <thead>
                    <tr>
                      <th style={{ width: 120 }}>SKU</th>
                      <th>Item</th>
                      <th style={{ width: 140 }}>Size</th>
                      <th style={{ width: 110 }}>Colour</th>
                      <th style={{ width: 60, textAlign: 'right' }}>Qty</th>
                      <th style={{ width: 110 }}>From orders</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.values(g.items).map(it => (
                      <tr key={it.sku + (it.colour || '')}>
                        <td><code className="be-po-sku">{it.sku}</code></td>
                        <td>{it.name}</td>
                        <td>{it.size || '—'}</td>
                        <td>
                          {it.fabric ? (
                            <span className="be-po-swatch">
                              <span className="be-po-swatch__dot" style={{ background: it.fabric.swatch }}></span>
                              {it.fabric.fabric} · {it.colour}
                            </span>
                          ) : '—'}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <strong className="be-po-qty">×{it.qty}</strong>
                        </td>
                        <td>
                          <span className="be-po-orderpills">
                            {[...it.orderIds].slice(0, 2).map(id => (
                              <span key={id} className="be-po-orderpill">{id}</span>
                            ))}
                            {it.orderIds.size > 2 && <span className="be-po-orderpill">+{it.orderIds.size - 2}</span>}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))
          ) : (
            // By-order detail view
            orders.length === 0 ? (
              <div className="be-empty-lane be-empty-lane--big">
                <i data-lucide="check-circle-2"></i>
                <div>All POs already issued — nothing to scan.</div>
              </div>
            ) : orders.map(o => {
              const groups = buildPoLines(o);
              return (
                <div key={o.id} className="be-po-order">
                  <div className="be-po-order__head">
                    <span className="be-po-order__id">{o.id}</span>
                    <span className="be-po-order__customer">{o.customer?.name}</span>
                    <span className="be-po-order__delivery">
                      <i data-lucide="calendar"></i>
                      {o.delivery?.date ? window.fmtDate(o.delivery.date) : 'Date TBD'}
                    </span>
                  </div>
                  {groups.map(g => (
                    <div key={g.supplier.code} className="be-po-order__group">
                      <div className="be-po-order__supplier">
                        <span className="be-po-supplier__code">{g.supplier.code}</span>
                        {g.supplier.name}
                      </div>
                      {g.lines.map((line, i) => (
                        <div key={i} className="be-po-line">
                          {line.kind === 'sofa' && (
                            <>
                              <div className="be-po-line__head">
                                <i data-lucide="sofa"></i>
                                <strong>{line.product.name}</strong>
                                <span className="be-po-swatch">
                                  <span className="be-po-swatch__dot" style={{ background: line.fabric.swatch }}></span>
                                  {line.fabric.fabric} · {line.fabric.colour}
                                </span>
                              </div>
                              <div className="be-po-line__sub">Split into {line.compartments.length} compartment{line.compartments.length === 1 ? '' : 's'}:</div>
                              <div className="be-po-line__compartments">
                                {line.compartments.map((c, j) => (
                                  <div key={j} className="be-po-compartment">
                                    <code className="be-po-sku">{c.sku}</code>
                                    <span className="be-po-compartment__label">{c.label}</span>
                                    <span className="be-po-compartment__size">{c.size}</span>
                                    <strong className="be-po-qty">×{c.qty}</strong>
                                  </div>
                                ))}
                              </div>
                            </>
                          )}
                          {line.kind === 'mattress' && (
                            <>
                              <div className="be-po-line__head">
                                <i data-lucide="bed-double"></i>
                                <strong>{line.product.name}</strong>
                              </div>
                              <div className="be-po-line__sub">Mattress + paired pillows:</div>
                              <div className="be-po-line__compartments">
                                {line.sublines.map((s, j) => (
                                  <div key={j} className="be-po-compartment">
                                    <code className="be-po-sku">{s.sku}</code>
                                    <span className="be-po-compartment__label">{s.name}</span>
                                    <span className="be-po-compartment__size">{s.size}</span>
                                    <strong className="be-po-qty">×{s.qty}</strong>
                                  </div>
                                ))}
                              </div>
                            </>
                          )}
                          {line.kind === 'simple' && (
                            <div className="be-po-line__head">
                              <i data-lucide={
                                line.product.cat === 'bedframe' ? 'bed' :
                                line.product.cat === 'dining' ? 'utensils-crossed' :
                                line.product.cat === 'bathroom' ? 'bath' :
                                line.product.cat === 'kids' ? 'baby' : 'package'
                              }></i>
                              <strong>{line.name}</strong>
                              <code className="be-po-sku">{line.sku}</code>
                              <span className="be-po-compartment__size">{line.size}</span>
                              <strong className="be-po-qty">×{line.qty}</strong>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              );
            })
          )}
        </div>

        <div className="be-po-modal__foot">
          <button className="be-pill" onClick={onClose}>Close</button>
          <button className="be-btn be-btn--primary">
            <i data-lucide="file-output"></i>
            Generate all POs ({supplierList.length})
          </button>
        </div>
      </div>
    </div>
  );
}

window.OrdersBoard = OrdersBoard;
window.OrderCard = OrderCard;
