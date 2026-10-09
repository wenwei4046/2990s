// Add on display — record a piece on a showroom floor, with the same options a
// Sales Order line offers (design screens 04 and 06). A sofa is built first
// (Step 1 · Components), then its Model, fabric, colour, leg and seat.

import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { compLine, seatDepth, shapeName, sizeName, specOf, TYPES, type DisplayType, type SofaLayout } from './marketing-model';
import {
  allowedOr, coloursOf, fabricsFor, preferred,
  type MarketingOptions, type ModelOption,
} from './marketing-options';
import { useAddDisplay, type ShowroomOption } from '../../lib/marketing-api';
import { ComponentBuilder } from './ComponentBuilder';
import { SofaLayoutPreview } from './SofaLayoutPreview';
import s from './marketing.module.css';

interface AddState {
  type: DisplayType;
  modelId: string;
  size: string;
  height: string;
  fabric: string;
  colour: string;
  leg: string;
  seat: string;
  divan: string;
  gap: string;
  modules: string[];
  /** The sofa as laid out on the canvas (0220). */
  layout: SofaLayout | null;
  qty: number;
}

/** The option lists for one type + Model — the Sales Order line's rule: the
 *  Model's ticked options, or the master pool when it ticks none. */
function listsFor(opts: MarketingOptions, type: DisplayType, model: ModelOption | undefined) {
  const allowed = model?.allowed ?? null;
  const fab = fabricsFor(opts, allowed);
  const sizePool = type === 'bedframe' ? opts.bedframeSizes : opts.mattressSizes;
  return {
    fabricSeries: fab.series.map((x) => x.label),
    coloursOf: (series: string) => coloursOf({ fabricSeries: fab.series, colours: fab.colours }, series),
    legs: type === 'bedframe' ? allowedOr(opts.bedLegs, allowed?.leg_heights) : allowedOr(opts.sofaLegs, allowed?.leg_heights),
    seats: allowedOr(opts.seats, type === 'sofa' ? allowed?.sizes : undefined),
    divans: allowedOr(opts.divans, allowed?.divan_heights),
    sizes: model?.sizeCodes.length ? model.sizeCodes.map(sizeName) : sizePool,
  };
}

/** A fresh form for a type — the design's newAdd(): its first Model, and the
 *  design's defaults (Queen, 4" legs, 28" seat, 10" divan) wherever the live
 *  lists carry them. */
function freshAdd(opts: MarketingOptions, type: DisplayType): AddState {
  const model = opts.models[type][0];
  const l = listsFor(opts, type, model);
  const fabric = l.fabricSeries[0] ?? '';
  return {
    type, modelId: model?.id ?? '', size: preferred(l.sizes, 'Queen'), height: '',
    fabric, colour: l.coloursOf(fabric)[0] ?? '', leg: preferred(l.legs, '4"'), seat: preferred(l.seats, '28"'),
    divan: preferred(l.divans, '10"'), gap: '', modules: [], layout: null, qty: 1,
  };
}

export const AddDisplayModal = ({ showroom, opts, onClose, onAdded }: {
  showroom: ShowroomOption;
  opts: MarketingOptions;
  onClose: () => void;
  onAdded: (name: string) => void;
}) => {
  const [a, setA] = useState<AddState>(() => freshAdd(opts, 'sofa'));
  const [building, setBuilding] = useState(false);
  const add = useAddDisplay();
  const [err, setErr] = useState('');
  const set = (p: Partial<AddState>) => setA((x) => ({ ...x, ...p }));

  const models = opts.models[a.type];
  const model = models.find((m) => m.id === a.modelId);
  const l = useMemo(() => listsFor(opts, a.type, model), [opts, a.type, model]);
  const isSofa = a.type === 'sofa';
  const showFabric = a.type === 'sofa' || a.type === 'bedframe';
  const showSize = a.type === 'mattress' || a.type === 'bedframe';

  /** A different Model may not offer what is picked — keep what it does
   *  offer, re-default the rest. */
  const pickModel = (id: string) => {
    const m = models.find((x) => x.id === id);
    const nl = listsFor(opts, a.type, m);
    const keep = (v: string, list: string[], want: string) => (list.includes(v) ? v : preferred(list, want));
    const fabric = nl.fabricSeries.includes(a.fabric) ? a.fabric : nl.fabricSeries[0] ?? '';
    const colours = nl.coloursOf(fabric);
    set({
      modelId: id, fabric, colour: colours.includes(a.colour) ? a.colour : colours[0] ?? '',
      leg: keep(a.leg, nl.legs, '4"'), seat: keep(a.seat, nl.seats, '28"'), divan: keep(a.divan, nl.divans, '10"'),
      size: keep(a.size, nl.sizes, 'Queen'),
    });
  };

  const preview = { ...a, name: model?.name ?? '' };
  const photo = !isSofa ? model?.photoUrl ?? null : null;

  const submit = async () => {
    if (isSofa && !a.modules.length) { setBuilding(true); return; }
    if (!model) return;
    setErr('');
    const extra = a.type === 'sofa' ? { fabric: a.fabric, colour: a.colour, leg: a.leg, seat: a.seat, modules: a.modules, layout: a.layout }
      : a.type === 'mattress' ? { size: a.size, height: a.height.trim() }
      : a.type === 'bedframe' ? { size: a.size, fabric: a.fabric, colour: a.colour, leg: a.leg, divan: a.divan, gap: a.gap.trim() }
      : { qty: a.qty };
    try {
      await add.mutateAsync({
        venueId: showroom.id, type: a.type, modelId: model.id, name: model.name, code: model.code,
        photoUrl: isSofa ? null : model.photoUrl, ...extra,
      });
      onAdded(model.name);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <>
      <div className={s.modalScrim}>
        <div className={s.modal} role="dialog" aria-label="Add on display">
          <div className={s.modalHead}>
            <div>
              <div className={s.modalTitle}>Add on display</div>
              <div className={s.modalSub}>{showroom.name} · same options as a Sales Order line</div>
            </div>
            <button type="button" className={s.closeBtn} aria-label="Close" onClick={onClose}>
              <X size={18} strokeWidth={1.75} className={s.icon} />
            </button>
          </div>
          <div className={s.modalGrid}>
            <div className={s.modalLeft}>
              <div className={s.chipRow}>
                {TYPES.map((t) => (
                  <button key={t.id} type="button" className={`${s.typeChip} ${a.type === t.id ? s.chipOn : ''}`} onClick={() => setA(freshAdd(opts, t.id))}>
                    {t.label}
                  </button>
                ))}
              </div>

              {isSofa && (
                <div className={s.stepCard}>
                  <div className={s.stepText}>
                    <span className={s.fieldLabel}>Step 1 · Components</span>
                    <span className={s.stepShape}>{shapeName(a.modules)}</span>
                    <span className={s.stepLine}>{compLine(a.modules)}</span>
                  </div>
                  <button type="button" className={s.buildBtn} onClick={() => setBuilding(true)}>
                    {a.modules.length ? 'Edit components' : 'Build components'}
                  </button>
                </div>
              )}

              <div className={s.field}>
                <span className={s.fieldLabel}>Model</span>
                {models.length === 0 ? (
                  <span className={s.modelEmpty}>No {TYPES.find((t) => t.id === a.type)!.label.toLowerCase()} models in the catalogue yet.</span>
                ) : (
                  <div className={s.modelGrid}>
                    {models.map((m) => (
                      <button key={m.id} type="button" className={`${s.modelTile} ${m.id === a.modelId ? s.modelTileOn : ''}`} onClick={() => pickModel(m.id)}>
                        <span className={s.modelTilePhoto} style={m.photoUrl ? { backgroundImage: `url("${m.photoUrl}")` } : undefined} />
                        <span className={s.modelTileName}>{m.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {showSize && (
                <div className={s.field}>
                  <span className={s.fieldLabel}>Display size</span>
                  <div className={s.chipRow}>
                    {l.sizes.map((v) => (
                      <button key={v} type="button" className={`${s.sizeChip} ${a.size === v ? s.chipOn : ''}`} onClick={() => set({ size: v })}>{v}</button>
                    ))}
                  </div>
                </div>
              )}

              {a.type === 'mattress' && (
                <label className={`${s.field} ${s.fieldNarrow}`}>
                  <span className={s.fieldLabel}>Mattress height</span>
                  <span className={s.inchRow}>
                    <input type="number" min={0} value={a.height} onChange={(e) => set({ height: e.target.value })} placeholder="e.g. 12" className={`${s.input} ${s.inchInput}`} />
                    <span className={s.inchUnit}>inch</span>
                  </span>
                </label>
              )}

              {showFabric && (
                <div className={s.twoCol}>
                  <label className={s.field}>
                    <span className={s.fieldLabel}>Fabric series</span>
                    <select className={s.select} value={a.fabric} onChange={(e) => set({ fabric: e.target.value, colour: l.coloursOf(e.target.value)[0] ?? '' })}>
                      {l.fabricSeries.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </label>
                  <label className={s.field}>
                    <span className={s.fieldLabel}>Colour</span>
                    <select className={s.select} value={a.colour} onChange={(e) => set({ colour: e.target.value })}>
                      {l.coloursOf(a.fabric).map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </label>
                  <label className={s.field}>
                    <span className={s.fieldLabel}>Leg height</span>
                    <select className={s.select} value={a.leg} onChange={(e) => set({ leg: e.target.value })}>
                      {l.legs.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </label>
                  {isSofa && (
                    <label className={s.field}>
                      <span className={s.fieldLabel}>Seat</span>
                      <select className={s.select} value={a.seat} onChange={(e) => set({ seat: e.target.value })}>
                        {l.seats.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </label>
                  )}
                  {a.type === 'bedframe' && (
                    <>
                      <label className={s.field}>
                        <span className={s.fieldLabel}>Divan height</span>
                        <select className={s.select} value={a.divan} onChange={(e) => set({ divan: e.target.value })}>
                          {l.divans.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </label>
                      <label className={s.field}>
                        <span className={s.fieldLabel}>Mattress gap</span>
                        <span className={s.inchRow}>
                          <input type="number" min={0} value={a.gap} onChange={(e) => set({ gap: e.target.value })} placeholder="e.g. 4" className={`${s.input} ${s.inchInput}`} />
                          <span className={s.inchUnit}>inch</span>
                        </span>
                      </label>
                    </>
                  )}
                </div>
              )}

              {a.type === 'accessory' && (
                <label className={`${s.field} ${s.fieldNarrower}`}>
                  <span className={s.fieldLabel}>Qty</span>
                  <input type="number" min={1} value={a.qty} onChange={(e) => set({ qty: Math.max(1, Number(e.target.value) || 1) })} className={s.input} />
                </label>
              )}
            </div>

            <div className={s.modalRight}>
              <div className={s.previewPane} style={photo ? { backgroundImage: `url("${photo}")` } : undefined}>
                {isSofa && <SofaLayoutPreview layout={a.layout} modules={a.modules} depth={seatDepth(a.seat)} art={opts.moduleArt} dims />}
              </div>
              <div>
                <div className={s.previewName}>{preview.name}</div>
                <div className={s.previewSpec}>{specOf(preview)}</div>
              </div>
              {err && <div className={s.formError}>{err}</div>}
              <div className={s.spacer} />
              <button type="button" className={s.submitBig} disabled={add.isPending || (!model && !isSofa)} onClick={() => void submit()}>
                Add to {showroom.name}
              </button>
            </div>
          </div>
        </div>
      </div>

      {building && (
        <ComponentBuilder
          context={`Add on display · ${showroom.name}`}
          initialLayout={a.layout}
          initialModules={a.modules}
          pool={opts.sofaPool}
          seats={l.seats}
          seat={a.seat}
          onSeat={(v) => set({ seat: v })}
          fabrics={l.fabricSeries}
          fabric={a.fabric}
          onFabric={(f) => set({ fabric: f, colour: l.coloursOf(f)[0] ?? '' })}
          colours={l.coloursOf(a.fabric)}
          colour={a.colour}
          onColour={(c) => set({ colour: c })}
          legs={l.legs}
          leg={a.leg}
          onLeg={(v) => set({ leg: v })}
          onCancel={() => setBuilding(false)}
          onSave={({ layout, modules }) => { set({ modules, layout }); setBuilding(false); }}
        />
      )}
    </>
  );
};
