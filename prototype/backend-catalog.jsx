// 2990's Backend Portal — SKU master (wired) + Add-ons + Customers + Settings
const { useState: useStateS, useEffect: useEffectS, useMemo: useMemoS, useRef: useRefS } = React;

/* ──────────────────────────────────────────────────────────────────
 * SKU master state — single source of truth, lives on window so the
 * showroom POS can pick up the same edits if we wire that next.
 * ────────────────────────────────────────────────────────────────── */
function useSkuState() {
  const [skus, setSkus] = useStateS(() => {
    if (window.PRODUCTS_STATE) return window.PRODUCTS_STATE;
    const seeded = window.PRODUCTS.map(p => ({
      ...p,
      visible: true,
      lowAt: 5,
      updatedAt: Date.now() - Math.floor(Math.random() * 1000 * 60 * 60 * 24 * 12),
    }));
    window.PRODUCTS_STATE = seeded;
    return seeded;
  });

  function commit(next) {
    window.PRODUCTS_STATE = next;
    setSkus(next);
  }

  return [skus, {
    update: (id, patch) => commit(skus.map(s => s.id === id ? { ...s, ...patch, updatedAt: Date.now() } : s)),
    bumpStock: (id, delta) => commit(skus.map(s => s.id === id ? { ...s, stock: Math.max(0, s.stock + delta), updatedAt: Date.now() } : s)),
    create: (sku) => commit([{ ...sku, updatedAt: Date.now() }, ...skus]),
    remove: (id) => commit(skus.filter(s => s.id !== id)),
    bulkVisibility: (ids, visible) => commit(skus.map(s => ids.includes(s.id) ? { ...s, visible, updatedAt: Date.now() } : s)),
  }];
}

/* ──────────────────────────────────────────────────────────────────
 * SKU master page
 * ────────────────────────────────────────────────────────────────── */
function SkuMaster({ onToast }) {
  const [skus, ops] = useSkuState();
  const [query, setQuery]   = useStateS('');
  const [cat, setCat]       = useStateS('all');
  const [series, setSeries] = useStateS('all');
  const [view, setView]     = useStateS('all'); // all | low | hidden | tbc
  const [selected, setSelected] = useStateS([]);
  const [editingId, setEditingId] = useStateS(null);
  const [creating, setCreating] = useStateS(false);
  window.useLucideBE([query, cat, series, view, skus.length, selected.length, editingId, creating]);

  const cats = window.CATEGORIES;
  const seriesList = ['all', ...new Set(skus.map(s => s.series))];

  /* derived counts ------------------------------------------------- */
  const counts = useMemoS(() => {
    const lowAt = skus.filter(s => s.stock <= s.lowAt).length;
    const hidden = skus.filter(s => !s.visible).length;
    const tbc = skus.filter(s => {
      const c = cats.find(x => x.id === s.cat);
      return c && c.tbc;
    }).length;
    return { all: skus.length, low: lowAt, hidden, tbc };
  }, [skus]);

  /* visible rows --------------------------------------------------- */
  const visible = skus.filter(p => {
    if (cat !== 'all' && p.cat !== cat) return false;
    if (series !== 'all' && p.series !== series) return false;
    if (view === 'low' && p.stock > p.lowAt) return false;
    if (view === 'hidden' && p.visible) return false;
    if (view === 'tbc') {
      const c = cats.find(x => x.id === p.cat);
      if (!c || !c.tbc) return false;
    }
    const q = query.trim().toLowerCase();
    if (q && !(p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.series.toLowerCase().includes(q) || (p.detail || '').toLowerCase().includes(q))) return false;
    return true;
  });

  /* selection helpers --------------------------------------------- */
  const allVisibleIds = visible.map(v => v.id);
  const allSelected = allVisibleIds.length > 0 && allVisibleIds.every(id => selected.includes(id));
  function toggleAll() {
    if (allSelected) setSelected(selected.filter(id => !allVisibleIds.includes(id)));
    else setSelected([...new Set([...selected, ...allVisibleIds])]);
  }
  function toggleOne(id) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  /* category quick-stats ------------------------------------------ */
  const liveCats = cats.filter(c => c.id !== 'all' && !c.tbc);
  const tbcCats  = cats.filter(c => c.tbc);

  return (
    <div className="be-page">
      {/* ─── Pricing rule banner ─────────────────────────────────── */}
      <div className="be-rule-banner">
        <div className="be-rule-banner__icon"><i data-lucide="tag"></i></div>
        <div style={{ flex: 1 }}>
          <div className="be-rule-banner__title">Pricing rules · per SKU</div>
          <div className="be-rule-banner__sub">
            Mattress &amp; bedframe priced by size · Sofa priced by build (compartments + bundles, per Model). Toggle off any variant that doesn't apply to a specific Model.
          </div>
        </div>
        <button className="be-btn be-btn--ghost"><i data-lucide="upload"></i>Import CSV</button>
        <button className="be-btn be-btn--primary" onClick={() => setCreating(true)}>
          <i data-lucide="plus"></i>New SKU
        </button>
      </div>

      {/* ─── Stat strip ───────────────────────────────────────────── */}
      <div className="sku-stat-strip">
        <SkuStat label="All SKUs"   value={counts.all}    icon="package"      onClick={() => setView('all')}    active={view === 'all'} />
        <SkuStat label="Low stock"  value={counts.low}    icon="alert-circle" tone="warn"  onClick={() => setView('low')}    active={view === 'low'} hint="≤ threshold" />
        <SkuStat label="Hidden"     value={counts.hidden} icon="eye-off"      onClick={() => setView('hidden')} active={view === 'hidden'} hint="Not on showroom" />
        <SkuStat label="To-be-conf." value={counts.tbc}    icon="hourglass"   tone="muted" onClick={() => setView('tbc')}    active={view === 'tbc'} hint="Range pending" />
      </div>

      {/* ─── Filter row ───────────────────────────────────────────── */}
      <div className="be-board-toolbar sku-toolbar">
        <div className="be-tabs">
          <div className={`be-tab ${cat === 'all' ? 'is-active' : ''}`} onClick={() => setCat('all')}>
            All<span className="be-tab__count">{skus.length}</span>
          </div>
          {liveCats.map(c => {
            const n = skus.filter(p => p.cat === c.id).length;
            if (!n) return null;
            return (
              <div key={c.id} className={`be-tab ${cat === c.id ? 'is-active' : ''}`} onClick={() => setCat(c.id)}>
                {c.label}<span className="be-tab__count">{n}</span>
              </div>
            );
          })}
          <div className="sku-tab-divider"></div>
          {tbcCats.map(c => {
            const n = skus.filter(p => p.cat === c.id).length;
            if (!n) return null;
            return (
              <div key={c.id} className={`be-tab sku-tab--tbc ${cat === c.id ? 'is-active' : ''}`} onClick={() => setCat(c.id)} title="Range still being finalised">
                <i data-lucide="hourglass" style={{ width: 11, height: 11, marginRight: 4, verticalAlign: '-1px' }}></i>
                {c.label}<span className="be-tab__count">{n}</span>
              </div>
            );
          })}
        </div>

        <div className="sku-toolbar__right">
          <select className="sku-select" value={series} onChange={e => setSeries(e.target.value)}>
            <option value="all">All series</option>
            {seriesList.filter(s => s !== 'all').map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <div className="be-search" style={{ width: 260 }}>
            <i data-lucide="search"></i>
            <input placeholder="Name, SKU, series, detail…" value={query} onChange={e => setQuery(e.target.value)} />
            {query && (
              <i data-lucide="x" style={{ cursor: 'pointer' }} onClick={() => setQuery('')}></i>
            )}
          </div>
        </div>
      </div>

      {/* ─── Bulk action bar (appears when there's a selection) ─── */}
      {selected.length > 0 && (
        <div className="sku-bulk-bar">
          <div className="sku-bulk-bar__count">
            <i data-lucide="check-square"></i>
            <strong>{selected.length}</strong> selected
          </div>
          <button className="sku-bulk-btn" onClick={() => { ops.bulkVisibility(selected, true); onToast && onToast(`${selected.length} SKU shown on showroom`); setSelected([]); }}>
            <i data-lucide="eye"></i>Show on showroom
          </button>
          <button className="sku-bulk-btn" onClick={() => { ops.bulkVisibility(selected, false); onToast && onToast(`${selected.length} SKU hidden from showroom`); setSelected([]); }}>
            <i data-lucide="eye-off"></i>Hide
          </button>
          <button className="sku-bulk-btn"><i data-lucide="download"></i>Export CSV</button>
          <button className="sku-bulk-btn sku-bulk-btn--ghost" onClick={() => setSelected([])}>Clear</button>
        </div>
      )}

      {/* ─── Table ────────────────────────────────────────────────── */}
      <div className="be-table-card">
        <table className="be-table sku-table">
          <thead>
            <tr>
              <th style={{ width: 40 }}>
                <Checkbox checked={allSelected} onChange={toggleAll} />
              </th>
              <th style={{ width: 56 }}></th>
              <th>Product</th>
              <th style={{ width: 100 }}>SKU</th>
              <th style={{ width: 130 }}>Series</th>
              <th style={{ width: 140 }}>Size</th>
              <th style={{ width: 170 }}>Stock</th>
              <th style={{ width: 130 }}>Price</th>
              <th style={{ width: 100 }}>Visible</th>
              <th style={{ width: 80 }}></th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td colSpan={10}>
                <div className="sku-empty">
                  <i data-lucide="package-search"></i>
                  <div className="sku-empty__title">No SKUs match those filters</div>
                  <div className="sku-empty__sub">Try clearing the search or switching category.</div>
                  <button className="be-btn be-btn--ghost" onClick={() => { setQuery(''); setCat('all'); setSeries('all'); setView('all'); }}>
                    Reset filters
                  </button>
                </div>
              </td></tr>
            ) : visible.map(p => {
              const cObj = cats.find(c => c.id === p.cat);
              const tbc = cObj && cObj.tbc;
              const low = p.stock <= p.lowAt;
              const out = p.stock === 0;
              return (
                <tr key={p.id} className={`sku-row ${selected.includes(p.id) ? 'is-selected' : ''} ${!p.visible ? 'is-hidden-row' : ''}`} onClick={() => setEditingId(p.id)}>
                  <td onClick={e => e.stopPropagation()}>
                    <Checkbox checked={selected.includes(p.id)} onChange={() => toggleOne(p.id)} />
                  </td>
                  <td><div className="be-table__photo" style={{ backgroundImage: `url(${p.img})` }}></div></td>
                  <td>
                    <div className="sku-row__name-line">
                      <span className="be-table__name">{p.name}</span>
                      {tbc && <span className="sku-pill sku-pill--tbc"><i data-lucide="hourglass"></i>TBC</span>}
                      {!p.visible && <span className="sku-pill sku-pill--hidden"><i data-lucide="eye-off"></i>Hidden</span>}
                    </div>
                    <div className="sku-row__detail">{p.detail}</div>
                  </td>
                  <td><span className="be-table__sku">{p.sku}</span></td>
                  <td className="sku-row__series">
                    <span className="sku-series-chip" data-series={p.series}>{p.series}</span>
                  </td>
                  <td className="sku-row__size">{p.size}</td>
                  <td onClick={e => e.stopPropagation()}>
                    <div className="sku-stepper">
                      <button className="sku-stepper__btn" onClick={() => ops.bumpStock(p.id, -1)} disabled={p.stock === 0} aria-label="Decrease stock">
                        <i data-lucide="minus"></i>
                      </button>
                      <div className={`sku-stepper__val ${out ? 'is-out' : low ? 'is-low' : ''}`}>
                        {out ? 'Out' : p.stock}
                        {low && !out && <span className="sku-stepper__dot" title={`Low — ≤ ${p.lowAt}`}></span>}
                      </div>
                      <button className="sku-stepper__btn" onClick={() => ops.bumpStock(p.id, +1)} aria-label="Increase stock">
                        <i data-lucide="plus"></i>
                      </button>
                    </div>
                  </td>
                  <td>
                    {(() => {
                      const r = window.pricingRange(p);
                      if (!r) {
                        return (
                          <span className="be-table__price be-table__price--tbc" title="Not priced yet">
                            <i data-lucide="hourglass" style={{ width: 12, height: 12, marginRight: 4 }}></i>
                            Not priced
                          </span>
                        );
                      }
                      const same = r.from === r.to;
                      return (
                        <span className="be-table__price">
                          {same ? null : <span className="be-table__price__from">from</span>}
                          <sup>RM</sup>{window.fmtMoney(r.from)}
                          {!same && <span className="be-table__price__to"> – {window.fmtMoney(r.to)}</span>}
                        </span>
                      );
                    })()}
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <div
                      className={`be-toggle ${p.visible ? 'is-on' : ''}`}
                      onClick={() => { ops.update(p.id, { visible: !p.visible }); onToast && onToast(`${p.name} ${!p.visible ? 'shown on' : 'hidden from'} showroom`); }}
                    ></div>
                  </td>
                  <td className="be-table__act" onClick={e => e.stopPropagation()}>
                    <button className="be-iconbtn" title="Edit details" onClick={() => setEditingId(p.id)}>
                      <i data-lucide="pencil"></i>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ─── Foot meta ─────────────────────────────────────────────── */}
      <div className="sku-foot">
        Showing <strong>{visible.length}</strong> of {skus.length} SKUs · last edit {timeAgo(Math.max(...skus.map(s => s.updatedAt)))}
      </div>

      {/* ─── Edit / create drawer ─────────────────────────────────── */}
      {(editingId || creating) && (
        <SkuDrawer
          mode={creating ? 'create' : 'edit'}
          sku={editingId ? skus.find(s => s.id === editingId) : null}
          onClose={() => { setEditingId(null); setCreating(false); }}
          onSave={(record) => {
            if (creating) {
              ops.create(record);
              onToast && onToast(`SKU ${record.sku} created`);
            } else {
              ops.update(editingId, record);
              onToast && onToast(`${record.name} updated`);
            }
            setEditingId(null); setCreating(false);
          }}
          onRemove={(id) => {
            if (window.confirm('Remove this SKU? This cannot be undone.')) {
              ops.remove(id);
              onToast && onToast('SKU removed');
              setEditingId(null);
            }
          }}
        />
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
 * Small helpers
 * ────────────────────────────────────────────────────────────────── */
function timeAgo(ts) {
  const diff = Math.floor((Date.now() - ts) / 60000);
  if (diff < 1) return 'just now';
  if (diff < 60) return diff + 'm ago';
  if (diff < 1440) return Math.floor(diff / 60) + 'h ago';
  return Math.floor(diff / 1440) + 'd ago';
}

function Checkbox({ checked, onChange }) {
  return (
    <span className={`sku-check ${checked ? 'is-checked' : ''}`} onClick={onChange}>
      {checked && <i data-lucide="check"></i>}
    </span>
  );
}

function SkuStat({ label, value, icon, tone, hint, active, onClick }) {
  return (
    <div className={`sku-stat ${active ? 'is-active' : ''} ${tone ? 'sku-stat--' + tone : ''}`} onClick={onClick}>
      <div className="sku-stat__icon"><i data-lucide={icon}></i></div>
      <div className="sku-stat__body">
        <div className="sku-stat__value">{value}</div>
        <div className="sku-stat__label">{label}</div>
        {hint && <div className="sku-stat__hint">{hint}</div>}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
 * Edit / create drawer
 * ────────────────────────────────────────────────────────────────── */
const CAT_PREFIX = { mattress: 'MAT', sofa: 'SOF', bedframe: 'BED', dining: 'DIN', bathroom: 'BTH', kids: 'KID', accessory: 'ACC' };

function SkuDrawer({ mode, sku, onClose, onSave, onRemove }) {
  const blank = {
    id: 'sku-' + Math.random().toString(36).slice(2, 8),
    sku: '',
    cat: 'mattress',
    name: '',
    series: 'White Series',
    size: '',
    detail: '',
    img: window.IMG.bedroomWarm,
    stock: 0,
    lowAt: 5,
    visible: true,
  };
  const [draft, setDraft] = useStateS(sku || blank);
  window.useLucideBE([draft.cat, draft.img, draft.visible]);

  // auto-suggest SKU code when category changes during create
  useEffectS(() => {
    if (mode !== 'create') return;
    const prefix = CAT_PREFIX[draft.cat] || 'SKU';
    const existing = (window.PRODUCTS_STATE || []).filter(p => p.sku.startsWith(prefix));
    const nextN = String(existing.length + 1).padStart(3, '0');
    setDraft(d => ({ ...d, sku: `${prefix}-${nextN}` }));
  }, [draft.cat, mode]);

  // Seed pricing defaults whenever the category changes — for both create and
  // edit. We only seed when the existing pricing doesn't fit the new category
  // (e.g. switching mattress -> sofa wipes the size-variant array and loads
  // compartments+bundles instead). Pricing already in place is left intact.
  useEffectS(() => {
    setDraft(d => {
      const cat = d.cat;
      const p = d.pricing;
      const fits =
        (cat === 'sofa' && p && Array.isArray(p.compartments)) ||
        ((cat === 'mattress' || cat === 'bedframe') && p && Array.isArray(p.sizes));
      if (fits) return d;

      let pricing = null;
      if (cat === 'sofa') pricing = window.defaultSofaPricing();
      else if (cat === 'mattress') pricing = window.defaultMattressPricing();
      else if (cat === 'bedframe') pricing = window.defaultBedframePricing();
      // Other categories (dining, bathroom, kids, accessory) stay TBC for now.
      return { ...d, pricing };
    });
  }, [draft.cat]);

  function set(patch) { setDraft(prev => ({ ...prev, ...patch })); }

  const valid = draft.name.trim() && draft.sku.trim() && draft.size.trim();
  const cats = window.CATEGORIES.filter(c => c.id !== 'all');
  const allSeries = ['White Series', 'Earth Warm', 'Trend 26', 'Kids Zone'];
  const allImgs = Object.values(window.IMG);

  return (
    <div className="be-drawer-scrim" onClick={onClose}>
      <aside className="be-drawer sku-drawer" onClick={e => e.stopPropagation()}>
        <header className="be-drawer__head">
          <div style={{ flex: 1 }}>
            <div className="be-drawer__eyebrow">{mode === 'create' ? 'New SKU' : 'Edit SKU'}</div>
            <div className="be-drawer__title">{draft.name || (mode === 'create' ? 'Untitled piece' : 'Untitled')}</div>
            <div className="be-drawer__sub">
              {mode === 'create'
                ? 'Add a piece to the catalogue. Set pricing in the section below.'
                : <>{draft.sku} · last updated {timeAgo(draft.updatedAt || Date.now())}</>}
            </div>
          </div>
          <button className="be-iconbtn" onClick={onClose} aria-label="Close"><i data-lucide="x"></i></button>
        </header>

        <div className="be-drawer__body sku-drawer__body">
          {/* Photo block */}
          <section>
            <div className="sku-form-label">Product photo</div>
            <div className="sku-photo-picker">
              <div className="sku-photo-picker__main" style={{ backgroundImage: `url(${draft.img})` }}>
                {(() => {
                  const r = window.pricingRange(draft);
                  if (!r) return <div className="sku-photo-picker__price sku-photo-picker__price--tbc"><i data-lucide="hourglass"></i>Not priced</div>;
                  const same = r.from === r.to;
                  return (
                    <div className="sku-photo-picker__price">
                      {!same && <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.75, marginRight: 4 }}>from</span>}
                      <span>RM</span>{window.fmtMoney(r.from)}
                      {!same && <span style={{ fontSize: 11, opacity: 0.65, marginLeft: 4 }}>– {window.fmtMoney(r.to)}</span>}
                    </div>
                  );
                })()}
              </div>
              <div className="sku-photo-picker__thumbs">
                {allImgs.map(src => (
                  <div
                    key={src}
                    className={`sku-photo-picker__thumb ${draft.img === src ? 'is-active' : ''}`}
                    style={{ backgroundImage: `url(${src})` }}
                    onClick={() => set({ img: src })}
                  ></div>
                ))}
              </div>
              <div className="sku-photo-picker__hint">
                <i data-lucide="info"></i>
                Photos are sourced from the brand library. To upload new photography, use Brand Assets.
              </div>
            </div>
          </section>

          {/* Identity */}
          <section className="sku-form-section">
            <div className="sku-form-section__title">Identity</div>
            <div className="sku-form-grid">
              <label className="be-field" style={{ gridColumn: 'span 2' }}>
                <span>Display name *</span>
                <input value={draft.name} onChange={e => set({ name: e.target.value })} placeholder="e.g. Cloud Series Mattress" />
              </label>
              <label className="be-field">
                <span>Category *</span>
                <select className="sku-form-select" value={draft.cat} onChange={e => set({ cat: e.target.value })}>
                  {cats.map(c => <option key={c.id} value={c.id}>{c.label}{c.tbc ? ' · TBC' : ''}</option>)}
                </select>
              </label>
              <label className="be-field">
                <span>SKU code *</span>
                <input value={draft.sku} onChange={e => set({ sku: e.target.value.toUpperCase() })} placeholder="MAT-001" style={{ fontFamily: 'var(--font-button)', letterSpacing: '0.06em' }} />
              </label>
              <label className="be-field">
                <span>Series</span>
                <select className="sku-form-select" value={draft.series} onChange={e => set({ series: e.target.value })}>
                  {allSeries.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="be-field">
                <span>Size / dimensions</span>
                <input value={draft.size} onChange={e => set({ size: e.target.value })} placeholder="Queen, 152×190" />
              </label>
              <label className="be-field" style={{ gridColumn: 'span 2' }}>
                <span>Short detail</span>
                <input value={draft.detail} onChange={e => set({ detail: e.target.value })} placeholder="Pocket spring · gel-infused memory foam · cool knit" />
              </label>
            </div>
          </section>

          {/* Inventory */}
          <section className="sku-form-section">
            <div className="sku-form-section__title">Inventory</div>
            <div className="sku-form-grid">
              <label className="be-field">
                <span>On-hand stock</span>
                <div className="sku-stepper sku-stepper--lg">
                  <button className="sku-stepper__btn" onClick={() => set({ stock: Math.max(0, draft.stock - 1) })}><i data-lucide="minus"></i></button>
                  <input
                    className="sku-stepper__input"
                    type="number"
                    value={draft.stock}
                    onChange={e => set({ stock: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                  />
                  <button className="sku-stepper__btn" onClick={() => set({ stock: draft.stock + 1 })}><i data-lucide="plus"></i></button>
                </div>
              </label>
              <label className="be-field">
                <span>Low-stock alert at</span>
                <input
                  type="number"
                  value={draft.lowAt}
                  onChange={e => set({ lowAt: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                  placeholder="5"
                />
              </label>
            </div>
          </section>

          {/* Pricing — category-aware */}
          <PricingEditor draft={draft} set={set} />

          {/* Visibility */}
          <section className="sku-form-section">
            <div className="sku-form-section__title">Showroom visibility</div>
            <div className="sku-visibility-row">
              <div>
                <div className="sku-visibility-row__title">{draft.visible ? 'Live on showroom POS' : 'Hidden from showroom'}</div>
                <div className="sku-visibility-row__sub">
                  {draft.visible
                    ? 'Sales staff can add this piece to baskets right now.'
                    : 'Coordinator-only — staff cannot add this to baskets until you turn it back on.'}
                </div>
              </div>
              <div className={`be-toggle ${draft.visible ? 'is-on' : ''}`} onClick={() => set({ visible: !draft.visible })}></div>
            </div>
          </section>
        </div>

        <footer className="be-drawer__foot">
          {mode === 'edit' && (
            <button className="be-btn be-btn--danger" onClick={() => onRemove(draft.id)}>
              <i data-lucide="trash-2"></i>Remove SKU
            </button>
          )}
          <div style={{ flex: 1 }}></div>
          <button className="be-btn be-btn--ghost" onClick={onClose}><i data-lucide="x"></i>Cancel</button>
          <button className="be-btn be-btn--primary" disabled={!valid} onClick={() => onSave(draft)}>
            <i data-lucide={mode === 'create' ? 'plus' : 'save'}></i>
            {mode === 'create' ? 'Create SKU' : 'Save changes'}
          </button>
        </footer>
      </aside>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
 * Pricing editor — category-aware. Lives inside SkuDrawer.
 *  - Sofa:     compartments table + bundles table + recliner upgrade
 *  - Mattress: size variants table (Single, Super single, Queen, King)
 *  - Bedframe: size variants table (same as mattress)
 *  - Other:    TBC placeholder until the range is finalised
 * ────────────────────────────────────────────────────────────────── */
function PricingEditor({ draft, set }) {
  const { cat, pricing } = draft;

  if (cat === 'sofa') return <SofaPricingEditor pricing={pricing} set={set} />;
  if (cat === 'mattress' || cat === 'bedframe') return <SizePricingEditor pricing={pricing} set={set} catLabel={cat === 'mattress' ? 'Mattress' : 'Bedframe'} />;
  return <TbcPricingPlaceholder cat={cat} />;
}

function PriceInput({ value, onChange, disabled }) {
  return (
    <div className={`sku-price-input ${disabled ? 'is-disabled' : ''}`}>
      <span>RM</span>
      <input
        type="number"
        min="0"
        step="10"
        value={value}
        disabled={disabled}
        onChange={e => onChange(Math.max(0, parseFloat(e.target.value) || 0))}
      />
    </div>
  );
}

function ActiveToggle({ active, onChange, disabled }) {
  return (
    <div
      className={`be-toggle ${active ? 'is-on' : ''} ${disabled ? 'is-disabled' : ''}`}
      onClick={disabled ? null : () => onChange(!active)}
      title={active ? 'Active in this Model' : 'Hidden from this Model'}
    ></div>
  );
}

/* ─── Sofa: compartments + bundles + recliner ─────────────────────── */
function SofaPricingEditor({ pricing, set }) {
  // Defensive: if pricing isn't shaped, fall back to defaults.
  const safe = pricing && Array.isArray(pricing.compartments)
    ? pricing
    : window.defaultSofaPricing();

  function setComp(idx, patch) {
    const next = { ...safe, compartments: safe.compartments.map((c, i) => i === idx ? { ...c, ...patch } : c) };
    set({ pricing: next });
  }
  function setBundle(idx, patch) {
    const next = { ...safe, bundles: safe.bundles.map((b, i) => i === idx ? { ...b, ...patch } : b) };
    set({ pricing: next });
  }
  function setRecliner(price) {
    set({ pricing: { ...safe, reclinerUpgrade: price } });
  }
  function bulkSetCompartments(active) {
    set({ pricing: { ...safe, compartments: safe.compartments.map(c => ({ ...c, active })) } });
  }
  function bulkSetBundles(active) {
    set({ pricing: { ...safe, bundles: safe.bundles.map(b => ({ ...b, active })) } });
  }

  // Group compartments visually
  const lib = window.SOFA_COMPARTMENT_LIBRARY;
  const groups = ['1-seater', '2-seater', 'Corner', 'L-Shape', 'Accessory'];
  const activeC = safe.compartments.filter(c => c.active).length;
  const activeB = safe.bundles.filter(b => b.active).length;

  return (
    <section className="sku-form-section">
      <div className="sku-form-section__title">
        Sofa pricing
        <span className="sku-pricing-stat">
          {activeC}/{safe.compartments.length} compartments · {activeB}/{safe.bundles.length} bundles
        </span>
      </div>

      {/* Compartments block */}
      <div className="sku-pricing-block">
        <div className="sku-pricing-block__head">
          <div>
            <div className="sku-pricing-block__title">Compartments</div>
            <div className="sku-pricing-block__sub">Each module's à-la-carte price for this Model. Toggle off the ones not offered.</div>
          </div>
          <div className="sku-pricing-block__actions">
            <button type="button" className="sku-pricing-mini" onClick={() => bulkSetCompartments(true)}>All on</button>
            <button type="button" className="sku-pricing-mini" onClick={() => bulkSetCompartments(false)}>All off</button>
          </div>
        </div>

        {groups.map(group => {
          const ids = lib.filter(l => l.group === group).map(l => l.id);
          if (!ids.length) return null;
          return (
            <div key={group} className="sku-pricing-group">
              <div className="sku-pricing-group__label">{group}</div>
              <div className="sku-pricing-rows">
                {safe.compartments.map((c, i) => {
                  if (!ids.includes(c.id)) return null;
                  const def = lib.find(l => l.id === c.id);
                  return (
                    <div key={c.id} className={`sku-pricing-row ${c.active ? '' : 'is-off'}`}>
                      <ActiveToggle active={c.active} onChange={v => setComp(i, { active: v })} />
                      <div className="sku-pricing-row__id">{c.id}</div>
                      <div className="sku-pricing-row__label">{def?.label || c.id}</div>
                      <PriceInput value={c.price} onChange={v => setComp(i, { price: v })} disabled={!c.active} />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Bundles block */}
      <div className="sku-pricing-block">
        <div className="sku-pricing-block__head">
          <div>
            <div className="sku-pricing-block__title">Quick-Pick bundles</div>
            <div className="sku-pricing-block__sub">Pre-set combinations sold as a single SKU — usually a touch cheaper than à-la-carte.</div>
          </div>
          <div className="sku-pricing-block__actions">
            <button type="button" className="sku-pricing-mini" onClick={() => bulkSetBundles(true)}>All on</button>
            <button type="button" className="sku-pricing-mini" onClick={() => bulkSetBundles(false)}>All off</button>
          </div>
        </div>
        <div className="sku-pricing-rows">
          {safe.bundles.map((b, i) => {
            const def = window.SOFA_BUNDLE_LIBRARY.find(l => l.id === b.id);
            return (
              <div key={b.id} className={`sku-pricing-row ${b.active ? '' : 'is-off'}`}>
                <ActiveToggle active={b.active} onChange={v => setBundle(i, { active: v })} />
                <div className="sku-pricing-row__id">{b.id}</div>
                <div className="sku-pricing-row__label">
                  {def?.label || b.id}
                  {def?.sub && <span className="sku-pricing-row__sub"> · {def.sub}</span>}
                </div>
                <PriceInput value={b.price} onChange={v => setBundle(i, { price: v })} disabled={!b.active} />
              </div>
            );
          })}
        </div>
      </div>

      {/* Recliner add-on block */}
      <div className="sku-pricing-block sku-pricing-block--single">
        <div className="sku-pricing-block__head">
          <div>
            <div className="sku-pricing-block__title">Power-recliner upgrade</div>
            <div className="sku-pricing-block__sub">Per-seat add-on for 1A/2A/1NA/2NA modules. Set RM 0 to disable for this Model.</div>
          </div>
        </div>
        <div className="sku-pricing-recliner-row">
          <i data-lucide="armchair" style={{ width: 16, height: 16, color: 'var(--fg-muted)' }}></i>
          <div className="sku-pricing-row__label">Add a power recliner to a single seat</div>
          <PriceInput value={safe.reclinerUpgrade || 0} onChange={setRecliner} />
          <span className="sku-pricing-row__unit">per seat</span>
        </div>
      </div>
    </section>
  );
}

/* ─── Mattress / Bedframe: size variants ──────────────────────────── */
function SizePricingEditor({ pricing, set, catLabel }) {
  const safe = pricing && Array.isArray(pricing.sizes) ? pricing : { sizes: [] };

  function setSize(idx, patch) {
    set({ pricing: { ...safe, sizes: safe.sizes.map((s, i) => i === idx ? { ...s, ...patch } : s) } });
  }
  function bulkSet(active) {
    set({ pricing: { ...safe, sizes: safe.sizes.map(s => ({ ...s, active })) } });
  }

  const lib = catLabel === 'Mattress' ? window.MATTRESS_SIZE_LIBRARY : window.BEDFRAME_SIZE_LIBRARY;
  const activeCount = safe.sizes.filter(s => s.active).length;

  return (
    <section className="sku-form-section">
      <div className="sku-form-section__title">
        {catLabel} pricing · by size
        <span className="sku-pricing-stat">{activeCount}/{safe.sizes.length} sizes available</span>
      </div>
      <div className="sku-pricing-block">
        <div className="sku-pricing-block__head">
          <div>
            <div className="sku-pricing-block__title">Size variants</div>
            <div className="sku-pricing-block__sub">Each size sells at its own price. Toggle off any size this {catLabel.toLowerCase()} doesn't ship in.</div>
          </div>
          <div className="sku-pricing-block__actions">
            <button type="button" className="sku-pricing-mini" onClick={() => bulkSet(true)}>All on</button>
            <button type="button" className="sku-pricing-mini" onClick={() => bulkSet(false)}>All off</button>
          </div>
        </div>
        <div className="sku-pricing-rows">
          {safe.sizes.map((s, i) => {
            const def = lib.find(l => l.id === s.id);
            return (
              <div key={s.id} className={`sku-pricing-row ${s.active ? '' : 'is-off'}`}>
                <ActiveToggle active={s.active} onChange={v => setSize(i, { active: v })} />
                <div className="sku-pricing-row__id">{def?.label || s.id}</div>
                <div className="sku-pricing-row__label sku-pricing-row__label--dim">{def?.dim || ''} cm</div>
                <PriceInput value={s.price} onChange={v => setSize(i, { price: v })} disabled={!s.active} />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ─── Other categories: pricing TBC ───────────────────────────────── */
function TbcPricingPlaceholder({ cat }) {
  return (
    <section className="sku-form-section">
      <div className="sku-form-section__title">Pricing</div>
      <div className="sku-pricing-tbc">
        <i data-lucide="hourglass"></i>
        <div>
          <div className="sku-pricing-tbc__title">Pricing scheme not finalised for {cat}</div>
          <div className="sku-pricing-tbc__sub">Once we lock the range structure (size? bundle? per-piece?) we'll wire the editor here.</div>
        </div>
      </div>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────────
 * Add-ons manager (unchanged)
 * ────────────────────────────────────────────────────────────────── */
function AddonsManager({ onToast }) {
  const [items, setItems] = useStateS(window.BE_ADDONS);
  window.useLucideBE([items]);

  function update(id, patch) {
    setItems(prev => prev.map(it => it.id === id ? { ...it, ...patch } : it));
  }

  return (
    <div className="be-page">
      <div className="be-rule-banner">
        <div className="be-rule-banner__icon" style={{ background: 'var(--c-secondary-a)' }}>
          <i data-lucide="plus-circle"></i>
        </div>
        <div>
          <div className="be-rule-banner__title">Add-on products & services</div>
          <div className="be-rule-banner__sub">
            Edit pricing, units and availability for things sold alongside furniture — disposal, lift access, assembly, accessories.
          </div>
        </div>
        <button className="be-btn be-btn--primary" style={{ marginLeft: 'auto' }}>
          <i data-lucide="plus"></i>New add-on
        </button>
      </div>

      <div className="be-addon-grid">
        {items.map(a => (
          <div key={a.id} className={`be-addon ${a.enabled ? '' : 'is-disabled'}`}>
            <div className="be-addon__head">
              <div className="be-addon__icon"><i data-lucide={a.icon}></i></div>
              <div style={{ flex: 1 }}>
                <div className="be-addon__name">{a.label}</div>
                <div className="be-addon__desc">{a.desc}</div>
              </div>
              <div
                className={`be-toggle ${a.enabled ? 'is-on' : ''}`}
                onClick={() => { update(a.id, { enabled: !a.enabled }); onToast(a.enabled ? `${a.label} hidden from showroom` : `${a.label} live in showroom`); }}
              ></div>
            </div>
            <div className="be-addon__price-row">
              <div className="be-addon__price-input">
                <span>RM</span>
                <input
                  type="number"
                  value={a.price}
                  onChange={e => update(a.id, { price: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <div className="be-addon__unit">per {a.unit}</div>
            </div>
            <div className="be-addon__foot">
              <span className="be-addon__stock">
                Stock · <strong>{a.stock}</strong>
              </span>
              <span style={{ display: 'flex', gap: 6 }}>
                <button className="be-iconbtn" title="History"><i data-lucide="history"></i></button>
                <button className="be-iconbtn" title="Edit"><i data-lucide="pencil"></i></button>
              </span>
            </div>
          </div>
        ))}

        {/* Add new tile */}
        <div className="be-addon" style={{ borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center', cursor: 'pointer', minHeight: 220 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, color: 'var(--fg-muted)' }}>
            <div className="be-addon__icon" style={{ background: 'var(--be-rail)' }}>
              <i data-lucide="plus"></i>
            </div>
            <div className="be-addon__name" style={{ color: 'var(--fg-muted)' }}>Add a new add-on</div>
            <div className="be-addon__desc" style={{ textAlign: 'center', maxWidth: 24 + 'ch' }}>Disposal, lift access, assembly — anything sold alongside.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
 * Customers stub & Settings (unchanged)
 * ────────────────────────────────────────────────────────────────── */
function CustomersStub() {
  window.useLucideBE([]);
  return (
    <div className="be-page">
      <div className="be-rule-banner">
        <div className="be-rule-banner__icon" style={{ background: 'var(--c-secondary-b)' }}>
          <i data-lucide="users-round"></i>
        </div>
        <div>
          <div className="be-rule-banner__title">Customers directory</div>
          <div className="be-rule-banner__sub">Read-only contact lookup, mirrored from the showroom POS. Detailed profile next pass.</div>
        </div>
      </div>
      <div style={{ padding: 64, textAlign: 'center', color: 'var(--fg-muted)' }}>
        <i data-lucide="users-round" style={{ width: 36, height: 36, opacity: 0.5 }}></i>
        <div style={{ marginTop: 8, fontSize: 13 }}>Coming next — directory, order history per family, bilingual notes.</div>
      </div>
    </div>
  );
}

function SettingsPage({ drivers, setDrivers, onToast }) {
  const [draft, setDraft] = React.useState({ name: '', phone: '', icNumber: '', vehicle: '' });
  const [editingId, setEditingId] = React.useState(null);
  window.useLucideBE([drivers.length, editingId, draft.name]);

  function reset() { setDraft({ name: '', phone: '', icNumber: '', vehicle: '' }); setEditingId(null); }

  function save() {
    if (!draft.name.trim() || !draft.phone.trim() || !draft.icNumber.trim()) {
      onToast && onToast('Name, phone & IC are all required');
      return;
    }
    if (editingId) {
      setDrivers(prev => prev.map(d => d.id === editingId ? { ...d, ...draft } : d));
      onToast && onToast(`Driver ${draft.name} updated`);
    } else {
      const id = 'DRV-' + String(drivers.length + 1).padStart(2, '0');
      setDrivers(prev => [...prev, { id, ...draft, active: true, createdAt: Date.now() }]);
      onToast && onToast(`Driver ${draft.name} added`);
    }
    reset();
  }

  function startEdit(d) { setEditingId(d.id); setDraft({ name: d.name, phone: d.phone, icNumber: d.icNumber, vehicle: d.vehicle || '' }); }
  function remove(id) {
    const d = drivers.find(x => x.id === id);
    setDrivers(prev => prev.filter(x => x.id !== id));
    onToast && onToast(`Driver ${d?.name || id} removed`);
    if (editingId === id) reset();
  }
  function toggleActive(id) {
    setDrivers(prev => prev.map(d => d.id === id ? { ...d, active: !d.active } : d));
  }

  return (
    <div className="be-page">
      <div className="be-rule-banner">
        <div className="be-rule-banner__icon" style={{ background: 'var(--c-ink)' }}>
          <i data-lucide="settings"></i>
        </div>
        <div>
          <div className="be-rule-banner__title">Settings</div>
          <div className="be-rule-banner__sub">Drivers, working hours, dispatch slots & workspace preferences.</div>
        </div>
      </div>

      <section className="be-settings__section">
        <div className="be-settings__head">
          <div>
            <div className="be-settings__title"><i data-lucide="truck"></i>Drivers</div>
            <div className="be-settings__sub">{drivers.length} on roster · used at the dispatch step in every order</div>
          </div>
        </div>

        <div className="be-driver-form">
          <div className="be-driver-form__title">{editingId ? `Edit ${editingId}` : 'Add a new driver'}</div>
          <div className="be-driver-form__grid">
            <label className="be-field">
              <span>Full name *</span>
              <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Razali Ibrahim" />
            </label>
            <label className="be-field">
              <span>Phone *</span>
              <input value={draft.phone} onChange={e => setDraft({ ...draft, phone: e.target.value })} placeholder="+60 12 345 6789" />
            </label>
            <label className="be-field">
              <span>IC number *</span>
              <input value={draft.icNumber} onChange={e => setDraft({ ...draft, icNumber: e.target.value })} placeholder="850412-08-5532" />
            </label>
            <label className="be-field">
              <span>Vehicle (optional)</span>
              <input value={draft.vehicle} onChange={e => setDraft({ ...draft, vehicle: e.target.value })} placeholder="Lorry · WXY 2241" />
            </label>
          </div>
          <div className="be-driver-form__foot">
            {editingId && <button className="be-btn be-btn--ghost" onClick={reset}><i data-lucide="x"></i>Cancel</button>}
            <button className="be-btn be-btn--primary" onClick={save}>
              <i data-lucide={editingId ? 'save' : 'plus'}></i>{editingId ? 'Save changes' : 'Create driver'}
            </button>
          </div>
        </div>

        <div className="be-driver-table">
          <div className="be-driver-row be-driver-row--head">
            <div>ID</div><div>Name</div><div>Phone</div><div>IC</div><div>Vehicle</div><div>Status</div><div></div>
          </div>
          {drivers.length === 0 ? (
            <div className="be-empty-lane" style={{ padding: 32 }}>
              <i data-lucide="user-plus"></i>
              <div>No drivers yet — add one above.</div>
            </div>
          ) : drivers.map(d => (
            <div key={d.id} className={`be-driver-row ${editingId === d.id ? 'is-editing' : ''}`}>
              <div className="be-driver-row__id">{d.id}</div>
              <div>
                <div style={{ fontWeight: 600 }}>{d.name}</div>
                <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>added {new Date(d.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</div>
              </div>
              <div>{d.phone}</div>
              <div style={{ fontFamily: 'var(--font-mono, ui-monospace)', fontSize: 12 }}>{d.icNumber}</div>
              <div style={{ fontSize: 12 }}>{d.vehicle || <span style={{ color: 'var(--fg-muted)' }}>—</span>}</div>
              <div>
                <button className="be-driver-status" data-active={d.active} onClick={() => toggleActive(d.id)}>
                  <i data-lucide={d.active ? 'check' : 'pause'}></i>{d.active ? 'Active' : 'Paused'}
                </button>
              </div>
              <div className="be-driver-row__actions">
                <button className="be-icon-btn" onClick={() => startEdit(d)} aria-label="Edit"><i data-lucide="pencil"></i></button>
                <button className="be-icon-btn be-icon-btn--danger" onClick={() => remove(d.id)} aria-label="Remove"><i data-lucide="trash-2"></i></button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="be-settings__section">
        <div className="be-settings__head">
          <div>
            <div className="be-settings__title"><i data-lucide="clock"></i>Working hours & dispatch slots</div>
            <div className="be-settings__sub">Coming soon — for now hours follow the showroom default (10:00–19:00, Tue–Sun).</div>
          </div>
        </div>
      </section>
    </div>
  );
}

window.SkuMaster = SkuMaster;
window.AddonsManager = AddonsManager;
window.CustomersStub = CustomersStub;
window.SettingsPage = SettingsPage;
