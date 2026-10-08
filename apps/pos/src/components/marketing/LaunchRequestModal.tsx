// New product / Edit new product — the launch request form (design screen
// 08). A brand-new request needs only the showroom and Add / Replace to save;
// everything else can be filled later. When editing an existing request, every
// empty field carries a TO FILL tag, and Complete needs them all.

import { useState } from 'react';
import { Pencil, X } from 'lucide-react';
import {
  compLine, missingOf, RM, requestTotal, SAVE_REQUIRED, shapeName, specOf, TYPES,
  type DisplayItem, type LaunchRequest, type RequestStatus, type RequestType,
} from './marketing-model';
import { coloursOf, withValue, type MarketingOptions } from './marketing-options';
import { useSaveRequest } from '../../lib/marketing-api';
import { ComponentBuilder } from './ComponentBuilder';
import { SofaBlueprint } from './SofaBlueprint';
import s from './marketing.module.css';

type BuilderTarget = { target: 'draft' } | { target: 'combo'; idx: number };

const ToFill = ({ on }: { on: boolean }) => (on ? <span className={s.toFillTag}>TO FILL</span> : null);
const empty = (v: unknown) => !String(v ?? '').trim();

export const LaunchRequestModal = ({ draft: d, setDraft, opts, displays, onSaved }: {
  draft: LaunchRequest;
  setDraft: (d: LaunchRequest | null) => void;
  opts: MarketingOptions;
  displays: DisplayItem[];
  onSaved: (status: RequestStatus) => void;
}) => {
  const [err, setErr] = useState('');
  const [builder, setBuilder] = useState<BuilderTarget | null>(null);
  const save = useSaveRequest();

  /** The design's setDraft: a Replace keeps a valid same-category candidate
   *  selected (the first one by default); leaving Replace clears it. */
  const patch = (p: Partial<LaunchRequest>) => {
    const next = { ...d, ...p };
    if (('showroomId' in p || 'type' in p || 'action' in p) && next.action === 'replace') {
      const c = displays.filter((x) => x.venueId === next.showroomId && x.type === next.type);
      if (!c.find((x) => x.id === next.replaceId)) next.replaceId = c[0]?.id ?? null;
    }
    if (next.action !== 'replace') next.replaceId = null;
    setErr('');
    setDraft(next);
  };

  const isEdit = !!d.id;
  const miss = missingOf(d);
  const ok = miss.length === 0;
  const saveNeeds = miss.filter((m) => (SAVE_REQUIRED as readonly string[]).includes(m));
  const tl = TYPES.find((t) => t.id === d.type)!.label.toLowerCase();
  const cands = displays.filter((x) => x.venueId === d.showroomId && x.type === d.type);
  const rep = cands.find((c) => c.id === d.replaceId) ?? null;
  const isSofa = d.type === 'sofa';
  const isBed = d.type === 'bedframe';
  const showFabric = isSofa || isBed;
  const showSize = d.type === 'mattress' || isBed;
  const fabricLabels = withValue(opts.fabricSeries.map((x) => x.label), d.fabric);
  const colourOpts = withValue(coloursOf(opts, d.fabric), d.colour);
  const legOpts = withValue(isBed ? opts.bedLegs : opts.sofaLegs, d.leg);
  const seatOpts = withValue(opts.seats, d.seat);
  const divanOpts = withValue(opts.divans, d.divan);
  const sizeOpts = withValue(isBed ? opts.bedframeSizes : opts.mattressSizes, d.size);
  const nd = (isEmpty: boolean) => isEmpty && isEdit;
  const rowsIncomplete = !d.rows.length || d.rows.some((x) => !(Number(x.price) > 0));

  const statusText = ok ? 'All info filled — ready to Complete'
    : isEdit ? `${miss.length} field${miss.length > 1 ? 's' : ''} still needed`
    : (d.showroomId && d.action && !(d.action === 'replace' && !d.replaceId)) ? 'Ready to save — the rest can be filled later' : 'Required to save';
  const statusOk = ok || (!isEdit && !!d.showroomId && !!d.action);
  const chipsShown = isEdit ? miss : saveNeeds;

  const submit = async (status: RequestStatus) => {
    if (status === 'completed' && !ok) {
      setErr('Fill in the highlighted fields to Complete, or Save & close to keep it in Pending Info.');
      return;
    }
    if (!d.showroomId || !d.action) {
      setErr('Choose the showroom and whether this is an Add or a Replace before saving.');
      return;
    }
    try {
      await save.mutateAsync({ draft: d, status });
      onSaved(status);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const saveBuilt = (mods: string[]) => {
    if (!builder) return;
    if (builder.target === 'combo') {
      const rows = [...d.rows];
      if (builder.idx >= 0) rows[builder.idx] = { ...rows[builder.idx]!, modules: mods };
      else rows.push({ modules: mods, price: '' });
      patch({ rows });
    } else {
      patch({ modules: mods, rows: d.rows.length ? d.rows : [{ modules: mods, price: '' }] });
    }
    setBuilder(null);
  };

  return (
    <>
      <div className={s.modalScrim}>
        <div className={`${s.modal} ${s.modalWide}`} role="dialog" aria-label={isEdit ? 'Edit new product' : 'New product launch'}>
          <div className={s.modalHead}>
            <div>
              <div className={s.modalTitle}>{isEdit ? 'Edit new product' : 'New product launch'}</div>
              {isEdit
                ? <div className={s.modalSub}>Fields marked <span className={s.toFillBadge}>TO FILL</span> are still empty. Fill them in, then Complete.</div>
                : <div className={s.modalSub}>Anyone can fill this in. Only the showroom and Add / Replace are required to save — the rest can be completed later.</div>}
            </div>
            <button type="button" className={s.closeBtn} aria-label="Close" onClick={() => setDraft(null)}>
              <X size={18} strokeWidth={1.75} className={s.icon} />
            </button>
          </div>
          <div className={s.modalGrid}>
            <div className={`${s.modalLeft} ${s.modalLeftLoose}`}>
              <div className={s.chipRow}>
                {TYPES.filter((t) => t.id !== 'accessory').map((t) => (
                  <button key={t.id} type="button" className={`${s.typeChip} ${d.type === t.id ? s.chipOn : ''}`} onClick={() => patch({ type: t.id as RequestType, leg: '' })}>
                    {t.label}
                  </button>
                ))}
              </div>

              <div className={`${s.destBox} ${d.showroomId && d.action ? '' : s.destBoxNeeds}`}>
                <div className={s.destHead}>
                  <span className={s.destTitle}>Delivery to showroom</span>
                  <span className={s.requiredTag}>Required</span>
                </div>
                <div className={s.twoCol}>
                  <label className={s.field}>
                    <span className={s.fieldLabel}>Showroom</span>
                    <select className={s.select} value={d.showroomId} onChange={(e) => patch({ showroomId: e.target.value })}>
                      <option value="">Choose showroom…</option>
                      {opts.showrooms.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </label>
                  <div className={s.field}>
                    <span className={s.fieldLabel}>Action</span>
                    <div className={s.actionRow}>
                      {([['add', 'Add'], ['replace', 'Replace']] as const).map(([id, label]) => (
                        <button key={id} type="button" className={`${s.actionChip} ${d.action === id ? s.chipOn : ''}`} onClick={() => patch({ action: id })}>{label}</button>
                      ))}
                    </div>
                  </div>
                </div>
                {d.action === 'replace' && (
                  <div className={s.field}>
                    <span className={s.replaceHint}>
                      {!d.showroomId ? 'Choose a showroom first.'
                        : cands.length ? `Pick the ${tl} on display to replace — it is removed when the new product arrives:`
                        : `No ${tl} on display at this showroom. Use Add instead.`}
                    </span>
                    {cands.length > 0 && (
                      <>
                        <select className={`${s.select} ${s.replaceSelect}`} value={d.replaceId ?? ''} onChange={(e) => patch({ replaceId: e.target.value })}>
                          {cands.map((c) => (
                            <option key={c.id} value={c.id}>{c.type === 'sofa' ? `${c.name} — ${c.modules.join(' + ')}` : `${c.name} — ${c.size || '—'}`}</option>
                          ))}
                        </select>
                        <div className={s.replacePreview}>
                          {rep?.type === 'sofa' && (
                            <div className={s.replaceThumb}><SofaBlueprint modules={rep.modules} maxW={84} maxH={44} /></div>
                          )}
                          <span className={s.replaceText}>
                            <span className={s.replaceName}>{rep?.name ?? ''}</span>
                            <span className={s.replaceSpec}>{rep ? specOf(rep) : ''}</span>
                          </span>
                          <span className={s.willRemove}>Will be removed</span>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              {isSofa && (
                <div className={`${s.stepCard} ${s.stepCardBordered}`}>
                  <div className={s.stepThumb}><SofaBlueprint modules={d.modules} maxW={132} maxH={70} /></div>
                  <div className={s.stepText}>
                    <span className={s.fieldLabel}>Step 1 · Components<ToFill on={nd(!d.modules.length)} /></span>
                    <span className={s.stepShape}>{shapeName(d.modules)}</span>
                    <span className={s.stepLine}>{compLine(d.modules)}</span>
                  </div>
                  <button type="button" className={s.buildBtn} onClick={() => setBuilder({ target: 'draft' })}>
                    {d.modules.length ? 'Edit components' : 'Build components'}
                  </button>
                </div>
              )}

              <div className={s.twoCol}>
                <label className={s.field}>
                  <span className={s.fieldLabel}>Supplier code<ToFill on={nd(empty(d.supplierCode))} /></span>
                  <input className={`${s.input} ${s.inputBold}`} value={d.supplierCode} onChange={(e) => patch({ supplierCode: e.target.value })} placeholder="Leave blank if not decided" />
                </label>
                <label className={s.field}>
                  <span className={s.fieldLabel}>Model name<ToFill on={nd(empty(d.model))} /></span>
                  <input className={`${s.input} ${s.inputBold}`} value={d.model} onChange={(e) => patch({ model: e.target.value })} placeholder="Leave blank if not decided" />
                </label>
              </div>

              {showFabric && (
                <div className={s.twoCol}>
                  <label className={s.field}>
                    <span className={s.fieldLabel}>Fabric series<ToFill on={nd(empty(d.fabric))} /></span>
                    <select className={`${s.select} ${s.inputBold}`} value={d.fabric} onChange={(e) => patch({ fabric: e.target.value, colour: '' })}>
                      <option value="">—</option>
                      {fabricLabels.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </label>
                  <label className={s.field}>
                    <span className={s.fieldLabel}>Colour<ToFill on={nd(empty(d.colour))} /></span>
                    <select className={`${s.select} ${s.inputBold}`} value={d.colour} onChange={(e) => patch({ colour: e.target.value })}>
                      <option value="">—</option>
                      {colourOpts.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </label>
                  <label className={s.field}>
                    <span className={s.fieldLabel}>Leg height<ToFill on={nd(empty(d.leg))} /></span>
                    <select className={`${s.select} ${s.inputBold}`} value={d.leg} onChange={(e) => patch({ leg: e.target.value })}>
                      <option value="">—</option>
                      {legOpts.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </label>
                  {isSofa && (
                    <label className={s.field}>
                      <span className={s.fieldLabel}>Seat<ToFill on={nd(empty(d.seat))} /></span>
                      <select className={`${s.select} ${s.inputBold}`} value={d.seat} onChange={(e) => patch({ seat: e.target.value })}>
                        <option value="">—</option>
                        {seatOpts.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </label>
                  )}
                  {isBed && (
                    <label className={s.field}>
                      <span className={s.fieldLabel}>Divan height<ToFill on={nd(empty(d.divan))} /></span>
                      <select className={`${s.select} ${s.inputBold}`} value={d.divan} onChange={(e) => patch({ divan: e.target.value })}>
                        <option value="">—</option>
                        {divanOpts.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </label>
                  )}
                </div>
              )}

              {showSize && (
                <div className={s.field}>
                  <span className={s.fieldLabel}>Display size<ToFill on={nd(empty(d.size))} /></span>
                  <div className={s.chipRow}>
                    {sizeOpts.map((v) => (
                      <button key={v} type="button" className={`${s.sizeChip} ${d.size === v ? s.chipOn : ''}`} onClick={() => patch({ size: v })}>{v}</button>
                    ))}
                  </div>
                </div>
              )}

              {d.type === 'mattress' && (
                <label className={`${s.field} ${s.fieldMid}`}>
                  <span className={s.fieldLabel}>Mattress height (thickness)<ToFill on={nd(empty(d.height))} /></span>
                  <span className={s.inchRow}>
                    <input type="number" min={0} value={d.height} onChange={(e) => patch({ height: e.target.value })} placeholder="e.g. 12" className={`${s.input} ${s.inputBold} ${s.inchInput}`} />
                    <span className={s.inchUnit}>inch</span>
                  </span>
                </label>
              )}
              {isBed && (
                <label className={`${s.field} ${s.fieldMid}`}>
                  <span className={s.fieldLabel}>Mattress gap<ToFill on={nd(empty(d.gap))} /></span>
                  <span className={s.inchRow}>
                    <input type="number" min={0} value={d.gap} onChange={(e) => patch({ gap: e.target.value })} placeholder="e.g. 4" className={`${s.input} ${s.inputBold} ${s.inchInput}`} />
                    <span className={s.inchUnit}>inch</span>
                  </span>
                </label>
              )}

              {isSofa && (
                <div className={s.comboBlock}>
                  <div className={s.comboHead}>
                    <span className={s.comboTitle}>Combo price list<ToFill on={nd(rowsIncomplete)} /></span>
                    <span className={s.comboHint}>Combos built from Maintenance components</span>
                  </div>
                  <div className={s.comboTable}>
                    <div className={`${s.comboGrid} ${s.comboHeader}`}><span>#</span><span>Combo</span><span /><span>Ref. price (RM)</span><span /></div>
                    {d.rows.map((r, i) => (
                      <div key={i} className={`${s.comboGrid} ${s.comboRow}`}>
                        <span className={s.comboN}>{i + 1}</span>
                        <div className={s.comboThumb}><SofaBlueprint modules={r.modules} maxW={104} maxH={46} /></div>
                        <span className={s.comboText}>
                          <span className={s.comboShape}>{shapeName(r.modules)}</span>
                          <span className={s.comboLine}>{r.modules.join(' + ')}</span>
                        </span>
                        <input
                          type="number" min={0} value={r.price} placeholder="0" className={s.comboPrice}
                          aria-label={`Reference price for combo ${i + 1}`}
                          onChange={(e) => patch({ rows: d.rows.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)) })}
                        />
                        <span className={s.comboActions}>
                          <button type="button" className={s.miniIconBtn} title="Edit combo" onClick={() => setBuilder({ target: 'combo', idx: i })}>
                            <Pencil size={14} strokeWidth={1.75} className={s.icon} />
                          </button>
                          <button type="button" className={s.miniIconBtn} title="Remove" onClick={() => patch({ rows: d.rows.filter((_, j) => j !== i) })}>×</button>
                        </span>
                      </div>
                    ))}
                    {d.rows.length === 0 && <div className={s.comboEmpty}>No combos yet. Add a combo, pick its components, then type its price.</div>}
                    <div className={s.comboAddRow}>
                      <button type="button" className={s.comboAddBtn} onClick={() => setBuilder({ target: 'combo', idx: -1 })}>+ Add combo price</button>
                    </div>
                    <div className={s.comboTotal}><span className={s.comboTotalLabel}>Reference total</span><b>{RM(requestTotal(d))}</b></div>
                  </div>
                  <span className={s.comboNote}>Reference only, for Marketing's price list. Prices are not carried to Display; the selling price is still set in the SKU Master in Maintenance.</span>
                </div>
              )}

              <div className={`${s.field} ${s.fieldHalf}`}>
                <span className={s.fieldLabel}>Requested by</span>
                <div className={s.requesterChip}>
                  <span className={s.requesterAvatar}>{(d.by || 'Staff').slice(0, 2).toUpperCase()}</span>
                  <span className={s.requesterText}>
                    <span>{d.by}</span>
                    <span className={s.requesterSub}>{d.byRole} · signed-in account</span>
                  </span>
                </div>
              </div>
            </div>

            <div className={s.modalRight}>
              {isSofa && (
                <>
                  <div className={s.previewPlain}><SofaBlueprint modules={d.modules} maxW={280} maxH={150} showLabels /></div>
                  <div className={s.previewShape}>{shapeName(d.modules)}</div>
                </>
              )}
              <div className={s.field}>
                <span className={s.fieldLabel}>Status</span>
                <span className={`${s.statusText} ${statusOk ? s.statusOk : ''}`}>{statusText}</span>
              </div>
              {chipsShown.length > 0 && (
                <div className={s.missingChips}>
                  {chipsShown.map((m) => <span key={m} className={s.missingChip}>{m}</span>)}
                </div>
              )}
              {err && <div className={s.formError}>{err}</div>}
              <div className={s.spacer} />
              <button type="button" className={`${s.completeBtn} ${ok ? s.completeBtnReady : ''}`} disabled={save.isPending} onClick={() => void submit('completed')}>
                Complete
              </button>
              <button type="button" className={s.saveCloseBtn} disabled={save.isPending} onClick={() => void submit('pending')}>
                Save &amp; close (Pending Info)
              </button>
            </div>
          </div>
        </div>
      </div>

      {builder && (
        <ComponentBuilder
          context={builder.target === 'combo' ? 'Combo price · pick the components for this combo' : 'New product launch · Sofa'}
          initial={builder.target === 'combo' ? (builder.idx >= 0 ? d.rows[builder.idx]?.modules ?? [] : []) : d.modules}
          modules={opts.modules}
          seats={seatOpts}
          seat={d.seat}
          onSeat={(v) => patch({ seat: v })}
          fabrics={fabricLabels}
          fabric={d.fabric}
          onFabric={(f) => patch({ fabric: f, colour: '' })}
          colours={colourOpts}
          colour={d.colour}
          onColour={(c) => patch({ colour: c })}
          legs={legOpts}
          leg={d.leg}
          onLeg={(v) => patch({ leg: v })}
          onCancel={() => setBuilder(null)}
          onSave={saveBuilt}
        />
      )}
    </>
  );
};
