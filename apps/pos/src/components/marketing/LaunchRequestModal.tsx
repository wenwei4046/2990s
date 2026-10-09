// New product / Edit new product — the launch request form (design screen
// 08). To save at all a request needs its showroom, Add / Replace and
// supplier code, and a sofa also its size, photo, category and function
// (owner 2026-10-09) — those carry a Required tag while empty. Everything
// else can be filled later. When editing an existing request, every other
// empty field carries a TO FILL tag, and Complete needs them all.

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { ImageUp, Pencil, Upload, X } from 'lucide-react';
import {
  cmOf, compLine, hasPhoto, missingOf, RM, requestTotal, saveBlockersOf, saveMissingOf, shapeName, specOf, TYPES,
  type DisplayItem, type LaunchRequest, type RequestStatus, type RequestType,
} from './marketing-model';
import { coloursOf, withValue, type MarketingOptions } from './marketing-options';
import {
  preparePhoto, useRequestPhoto, useSaveRequest, type ShowroomOption, type SofaCategoryOption,
} from '../../lib/marketing-api';
import { ComponentBuilder } from './ComponentBuilder';
import { SofaBlueprint } from './SofaBlueprint';
import s from './marketing.module.css';

type BuilderTarget = { target: 'draft' } | { target: 'combo'; idx: number };

const ToFill = ({ on }: { on: boolean }) => (on ? <span className={s.toFillTag}>TO FILL</span> : null);
/** Needed even to save — shown while the field is empty, on a new request too. */
const Req = ({ on }: { on: boolean }) => (on ? <span className={s.reqTag}>Required</span> : null);
const empty = (v: unknown) => !String(v ?? '').trim();
const bg = (url: string | null) => (url ? { backgroundImage: `url("${url}")` } : undefined);

export const LaunchRequestModal = ({ draft: d, setDraft, opts, showrooms, displays, sofaOptions, onSaved }: {
  draft: LaunchRequest;
  setDraft: (d: LaunchRequest | null) => void;
  opts: MarketingOptions;
  showrooms: ShowroomOption[];
  displays: DisplayItem[];
  /** Category → Function lists, kept in Marketing → ⋯ → Maintenance. */
  sofaOptions: SofaCategoryOption[];
  onSaved: (status: RequestStatus) => void;
}) => {
  const [err, setErr] = useState('');
  const [builder, setBuilder] = useState<BuilderTarget | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [viewing, setViewing] = useState(false);
  const save = useSaveRequest();
  // The saved photo, when this form has not picked a new one.
  const saved = useRequestPhoto(d.photoUpload ? null : d.id, d.photoUpload ? null : d.photoAt);
  const photoSrc = d.photoUpload
    ? `data:${d.photoUpload.contentType};base64,${d.photoUpload.dataB64}`
    : saved.data?.dataUrl ?? null;

  // The draft as last rendered — a photo is prepared asynchronously, and its
  // patch must not undo what was typed meanwhile, nor reopen a closed form.
  const latest = useRef(d);
  latest.current = d;
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => { open.current = false; };
  }, []);

  /** The design's setDraft: a Replace keeps a valid same-category candidate
   *  selected (the first one by default); leaving Replace clears it. */
  const patch = (p: Partial<LaunchRequest>) => {
    const next = { ...latest.current, ...p };
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
  const saveNeeds = saveMissingOf(d);
  const blockers = saveBlockersOf(d);
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
  const sizeMissing = !(cmOf(d.lengthCm) && cmOf(d.widthCm));
  const functionsOf = (category: string) => sofaOptions.find((c) => c.name === category)?.functions.map((f) => f.name) ?? [];
  const categoryOpts = withValue(sofaOptions.map((c) => c.name), d.sofaCategory);
  const functionOpts = withValue(functionsOf(d.sofaCategory), d.sofaFunction);

  const statusText = ok ? 'All info filled — ready to Complete'
    : isEdit ? `${miss.length} field${miss.length > 1 ? 's' : ''} still needed`
    : saveNeeds.length === 0 ? 'Ready to save — the rest can be filled later' : 'Required to save';
  const statusOk = ok || (!isEdit && blockers.length === 0);
  const chipsShown = isEdit ? miss : saveNeeds;

  /** A new photo asks the Exact / Non-exact question again: it is about this
   *  photo, not the last one. */
  const onPhotoFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setPhotoBusy(true);
    try {
      const photoUpload = await preparePhoto(f);
      if (open.current) patch({ photoUpload, photoMatch: '' });
    } catch (x) {
      if (open.current) setErr(`Photo not added — ${(x as Error).message}`);
    } finally {
      if (open.current) setPhotoBusy(false);
    }
  };

  const submit = async (status: RequestStatus) => {
    if (status === 'completed' && !ok) {
      setErr('Fill in the highlighted fields to Complete, or Save & close to keep it in Pending Info.');
      return;
    }
    if (blockers.length) {
      setErr(`Still needed to save: ${blockers.join(', ')}.`);
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
                ? <div className={s.modalSub}>Fields marked <span className={s.toFillBadge}>TO FILL</span> are still empty. Fill them in, then Complete. Fields marked <span className={s.reqBadge}>Required</span> are needed even to save.</div>
                : <div className={s.modalSub}>Anyone can fill this in. Fields marked <span className={s.reqBadge}>Required</span> are needed to save — the rest can be completed later.</div>}
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
                      {showrooms.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                    {showrooms.length === 0 && (
                      <span className={s.replaceHint}>No showrooms yet — add one on the Showroom display tab.</span>
                    )}
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
                  <span className={s.fieldLabel}>Supplier code<Req on={empty(d.supplierCode)} /></span>
                  <input className={`${s.input} ${s.inputBold}`} value={d.supplierCode} onChange={(e) => patch({ supplierCode: e.target.value })} placeholder="e.g. SL-2207" />
                </label>
                <label className={s.field}>
                  <span className={s.fieldLabel}>Model name<ToFill on={nd(empty(d.model))} /></span>
                  <input className={`${s.input} ${s.inputBold}`} value={d.model} onChange={(e) => patch({ model: e.target.value })} placeholder="Leave blank if not decided" />
                </label>
              </div>

              {isSofa && (
                <div className={`${s.field} ${s.fieldSize}`}>
                  <span className={s.fieldLabel}>Sofa size · length × width<Req on={sizeMissing} /></span>
                  <span className={s.inchRow}>
                    <input
                      type="number" inputMode="numeric" min={1} max={1000} step={1} value={d.lengthCm} placeholder="Length"
                      aria-label="Length in cm" className={`${s.input} ${s.inputBold} ${s.inchInput}`}
                      onChange={(e) => patch({ lengthCm: e.target.value })}
                    />
                    <span className={s.inchUnit}>×</span>
                    <input
                      type="number" inputMode="numeric" min={1} max={1000} step={1} value={d.widthCm} placeholder="Width"
                      aria-label="Width in cm" className={`${s.input} ${s.inputBold} ${s.inchInput}`}
                      onChange={(e) => patch({ widthCm: e.target.value })}
                    />
                    <span className={s.inchUnit}>cm</span>
                  </span>
                </div>
              )}

              {isSofa && (
                <div className={s.twoCol}>
                  <label className={s.field}>
                    <span className={s.fieldLabel}>Category<Req on={!d.sofaCategory} /></span>
                    <select
                      className={`${s.select} ${s.inputBold}`} value={d.sofaCategory}
                      onChange={(e) => {
                        // Keep the function when the new category offers it too (Fixed, say).
                        const keep = functionsOf(e.target.value).includes(d.sofaFunction);
                        patch({ sofaCategory: e.target.value, sofaFunction: keep ? d.sofaFunction : '' });
                      }}
                    >
                      <option value="">—</option>
                      {categoryOpts.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                    {sofaOptions.length === 0 && <span className={s.replaceHint}>No categories yet — add them in ⋯ › Maintenance.</span>}
                  </label>
                  <label className={s.field}>
                    <span className={s.fieldLabel}>Function<Req on={!d.sofaFunction} /></span>
                    <select
                      className={`${s.select} ${s.inputBold}`} value={d.sofaFunction} disabled={!d.sofaCategory}
                      onChange={(e) => patch({ sofaFunction: e.target.value })}
                    >
                      <option value="">{d.sofaCategory ? '—' : 'Choose a category first'}</option>
                      {functionOpts.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                    {d.sofaCategory && functionOpts.length === 0 && (
                      <span className={s.replaceHint}>No functions under {d.sofaCategory} yet — add them in ⋯ › Maintenance.</span>
                    )}
                  </label>
                </div>
              )}

              {isSofa && (
                <div className={s.field}>
                  <span className={s.fieldLabel}>Photo<Req on={!hasPhoto(d)} /></span>
                  {!hasPhoto(d) ? (
                    <label className={s.planStrip}>
                      <span className={s.planStripIcon}><ImageUp size={20} strokeWidth={1.75} className={s.icon} /></span>
                      <span className={s.planStripText}>
                        <span className={s.planStripTitle}>{photoBusy ? 'Preparing the photo…' : 'Upload a photo of the sofa'}</span>
                        <span className={s.planStripSub}>So Marketing can see what it looks like · JPG or PNG</span>
                      </span>
                      <span className={s.planStripPill}>Upload</span>
                      <input type="file" accept="image/*" className={s.hiddenFile} disabled={photoBusy} onChange={(e) => void onPhotoFile(e)} />
                    </label>
                  ) : (
                    <div className={s.photoCard}>
                      <button
                        type="button" className={s.photoThumb} style={bg(photoSrc)} disabled={!photoSrc}
                        aria-label="View the photo larger" onClick={() => setViewing(true)}
                      >
                        {!photoSrc && <span className={s.photoThumbText}>{saved.isError ? 'Photo could not load' : 'Loading…'}</span>}
                      </button>
                      <div className={s.photoSide}>
                        <span className={s.fieldLabel}>Is it the sofa in the photo?<Req on={!d.photoMatch} /></span>
                        <div className={s.actionRow}>
                          {([['exact', 'Exact'], ['non_exact', 'Non-exact']] as const).map(([id, label]) => (
                            <button key={id} type="button" className={`${s.actionChip} ${d.photoMatch === id ? s.chipOn : ''}`} onClick={() => patch({ photoMatch: id })}>
                              {label}
                            </button>
                          ))}
                        </div>
                        <span className={s.replaceHint}>
                          {d.photoMatch === 'exact' ? 'The same sofa as in the photo.'
                            : d.photoMatch === 'non_exact' ? 'Like the sofa in the photo, with some details changed.'
                            : 'Exact: the same sofa. Non-exact: like it, with some details changed.'}
                        </span>
                        {d.photoMatch === 'non_exact' && (
                          <label className={s.field}>
                            <span className={s.fieldLabel}>Note · what is different<Req on={empty(d.photoNote)} /></span>
                            <textarea
                              className={`${s.input} ${s.inputBold} ${s.noteInput}`} rows={2} maxLength={500} value={d.photoNote}
                              placeholder="e.g. slimmer arms, no stitching on the seat"
                              onChange={(e) => patch({ photoNote: e.target.value })}
                            />
                          </label>
                        )}
                        <label className={s.photoReplace}>
                          <Upload size={16} strokeWidth={1.75} className={s.icon} />{photoBusy ? 'Preparing…' : 'Replace photo'}
                          <input type="file" accept="image/*" className={s.hiddenFile} disabled={photoBusy} onChange={(e) => void onPhotoFile(e)} />
                        </label>
                      </div>
                    </div>
                  )}
                </div>
              )}

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

      {viewing && photoSrc && (
        <div className={s.lightbox} role="dialog" aria-label="Photo of the sofa" onClick={() => setViewing(false)}>
          <img src={photoSrc} alt="The sofa" className={s.lightboxImg} />
          <button type="button" className={s.lightboxClose} aria-label="Close" onClick={() => setViewing(false)}>
            <X size={20} strokeWidth={1.75} className={s.icon} />
          </button>
        </div>
      )}
    </>
  );
};
