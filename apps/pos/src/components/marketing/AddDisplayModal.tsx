// Add on display — record a piece on a showroom floor, with the same options a
// Sales Order line offers (design screens 04 and 06). A sofa is built first
// (Step 1 · Components), then its Model, fabric, colour, leg and seat.
//
// ⋯ › Duplicate from… (owner 2026-10-10) fills it from a piece on any floor,
// or from a product on the launch board. A new product is not in the
// catalogue, so its copy keeps its own name and code — its own tile, ahead of
// the catalogue's — and the launch request it came from, which brings its
// photo and NEW pill, as Arrive would.

import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import {
  compLine, displayCopyFrom, seatDepth, shapeName, sizeName, specOf, TYPES,
  type DisplayCopy, type DisplayItem, type DisplayType, type DuplicateSource, type LaunchRequest, type SofaLayout,
} from './marketing-model';
import {
  allowedOr, coloursOf, fabricsFor, preferred, withValue,
  type MarketingOptions, type ModelOption,
} from './marketing-options';
import { useAddDisplay, type ShowroomOption } from '../../lib/marketing-api';
import { ComponentBuilder } from './ComponentBuilder';
import { DuplicateFrom, FormMoreMenu } from './DuplicateFrom';
import { SofaLayoutPreview } from './SofaLayoutPreview';
import s from './marketing.module.css';

/** A copied piece the catalogue cannot name — a new product from the launch
 *  board, or a Model since taken out of the catalogue: its own name and code,
 *  and what Arrive carries with a new product. */
type CopiedProduct = Pick<
  DisplayCopy,
  'modelId' | 'name' | 'code' | 'photoUrl' | 'lengthCm' | 'widthCm' | 'sofaCategory' | 'sofaFunction' | 'sourceRequestId'
>;

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
  /** A copy's own product — the one picked while no catalogue Model is. */
  product: CopiedProduct | null;
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
    divan: preferred(l.divans, '10"'), gap: '', modules: [], layout: null, qty: 1, product: null,
  };
}

/** A source as this form takes it: a catalogue piece picks its Model; any
 *  other keeps its own name and code. */
function copiedAdd(opts: MarketingOptions, c: DisplayCopy): AddState {
  const inCatalogue = !!c.modelId && opts.models[c.type].some((m) => m.id === c.modelId);
  return {
    type: c.type, modelId: inCatalogue ? c.modelId! : '', size: c.size, height: c.height, fabric: c.fabric, colour: c.colour,
    leg: c.leg, seat: c.seat, divan: c.divan, gap: c.gap, modules: c.modules, layout: c.layout, qty: c.qty,
    product: inCatalogue ? null : {
      modelId: c.modelId, name: c.name, code: c.code, photoUrl: c.photoUrl, lengthCm: c.lengthCm, widthCm: c.widthCm,
      sofaCategory: c.sofaCategory, sofaFunction: c.sofaFunction, sourceRequestId: c.sourceRequestId,
    },
  };
}

const bg = (url: string | null | undefined) => (url ? { backgroundImage: `url("${url}")` } : undefined);
/** A copy can bring a blank (a launch request not filled in yet): shown as
 *  "—" rather than as the first option it is not. */
const blankOption = (v: string) => (v ? null : <option value="">—</option>);

export const AddDisplayModal = ({ showroom, opts, displays, requests, showrooms, onClose, onAdded }: {
  showroom: ShowroomOption;
  opts: MarketingOptions;
  /** What Duplicate can copy: every floor's pieces, and the launch board. */
  displays: DisplayItem[];
  requests: LaunchRequest[];
  showrooms: ShowroomOption[];
  onClose: () => void;
  onAdded: (name: string) => void;
}) => {
  const [a, setA] = useState<AddState>(() => freshAdd(opts, 'sofa'));
  const [building, setBuilding] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const add = useAddDisplay();
  const [err, setErr] = useState('');
  const set = (p: Partial<AddState>) => setA((x) => ({ ...x, ...p }));

  const models = opts.models[a.type];
  const model = models.find((m) => m.id === a.modelId);
  /** The copied product, when it is the one picked. */
  const product = model ? null : a.product;
  const l = useMemo(() => listsFor(opts, a.type, model), [opts, a.type, model]);
  const isSofa = a.type === 'sofa';
  const showFabric = a.type === 'sofa' || a.type === 'bedframe';
  const showSize = a.type === 'mattress' || a.type === 'bedframe';
  const fabricOpts = withValue(l.fabricSeries, a.fabric);
  const colourOpts = withValue(l.coloursOf(a.fabric), a.colour);
  const legOpts = withValue(l.legs, a.leg);
  const seatOpts = withValue(l.seats, a.seat);
  const divanOpts = withValue(l.divans, a.divan);
  const sizeOpts = withValue(l.sizes, a.size);

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

  /** Who the piece is: a catalogue Model, or the copied product. */
  const ident = model
    ? { modelId: model.id, name: model.name, code: model.code, photoUrl: model.photoUrl }
    : product ? { modelId: product.modelId, name: product.name, code: product.code, photoUrl: product.photoUrl } : null;
  const preview = { ...a, name: ident?.name ?? '' };
  const photo = !isSofa ? ident?.photoUrl ?? null : null;

  const submit = async () => {
    if (isSofa && !a.modules.length) { setBuilding(true); return; }
    if (!ident) return;
    setErr('');
    const extra = a.type === 'sofa' ? { fabric: a.fabric, colour: a.colour, leg: a.leg, seat: a.seat, modules: a.modules, layout: a.layout }
      : a.type === 'mattress' ? { size: a.size, height: a.height.trim() }
      : a.type === 'bedframe' ? { size: a.size, fabric: a.fabric, colour: a.colour, leg: a.leg, divan: a.divan, gap: a.gap.trim() }
      : { qty: a.qty };
    // A new product brings what Arrive would have: its request, and on a sofa
    // its size, category and function.
    const carried = product ? {
      sourceRequestId: product.sourceRequestId,
      ...(isSofa ? { lengthCm: product.lengthCm, widthCm: product.widthCm, sofaCategory: product.sofaCategory, sofaFunction: product.sofaFunction } : {}),
    } : {};
    try {
      await add.mutateAsync({
        venueId: showroom.id, type: a.type, modelId: ident.modelId, name: ident.name, code: ident.code,
        photoUrl: isSofa ? null : ident.photoUrl, ...extra, ...carried,
      });
      onAdded(ident.name);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const duplicate = async (src: DuplicateSource) => {
    setA(copiedAdd(opts, displayCopyFrom(src)));
    setErr('');
    setDuplicating(false);
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
                <FormMoreMenu onDuplicate={() => setDuplicating(true)} />
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
                {models.length === 0 && !a.product ? (
                  <span className={s.modelEmpty}>No {TYPES.find((t) => t.id === a.type)!.label.toLowerCase()} models in the catalogue yet.</span>
                ) : (
                  <div className={s.modelGrid}>
                    {a.product && (
                      <button type="button" className={`${s.modelTile} ${product ? s.modelTileOn : ''}`} onClick={() => set({ modelId: '' })}>
                        <span className={`${s.modelTilePhoto} ${s.modelTileArt}`} style={isSofa ? undefined : bg(a.product.photoUrl)}>
                          {isSofa && <SofaLayoutPreview layout={a.layout} modules={a.modules} depth={seatDepth(a.seat)} art={opts.moduleArt} pad={4} />}
                        </span>
                        <span className={s.modelTileName}>{a.product.name}</span>
                        <span className={s.modelTileSub}>{a.product.sourceRequestId ? 'New product' : 'Not in the catalogue'}</span>
                      </button>
                    )}
                    {models.map((m) => (
                      <button key={m.id} type="button" className={`${s.modelTile} ${m.id === a.modelId ? s.modelTileOn : ''}`} onClick={() => pickModel(m.id)}>
                        <span className={s.modelTilePhoto} style={bg(m.photoUrl)} />
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
                    {sizeOpts.map((v) => (
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
                      {blankOption(a.fabric)}
                      {fabricOpts.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </label>
                  <label className={s.field}>
                    <span className={s.fieldLabel}>Colour</span>
                    <select className={s.select} value={a.colour} onChange={(e) => set({ colour: e.target.value })}>
                      {blankOption(a.colour)}
                      {colourOpts.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </label>
                  <label className={s.field}>
                    <span className={s.fieldLabel}>Leg height</span>
                    <select className={s.select} value={a.leg} onChange={(e) => set({ leg: e.target.value })}>
                      {blankOption(a.leg)}
                      {legOpts.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </label>
                  {isSofa && (
                    <label className={s.field}>
                      <span className={s.fieldLabel}>Seat</span>
                      <select className={s.select} value={a.seat} onChange={(e) => set({ seat: e.target.value })}>
                        {blankOption(a.seat)}
                        {seatOpts.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </label>
                  )}
                  {a.type === 'bedframe' && (
                    <>
                      <label className={s.field}>
                        <span className={s.fieldLabel}>Divan height</span>
                        <select className={s.select} value={a.divan} onChange={(e) => set({ divan: e.target.value })}>
                          {blankOption(a.divan)}
                          {divanOpts.map((o) => <option key={o} value={o}>{o}</option>)}
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
              <button type="button" className={s.submitBig} disabled={add.isPending || (!ident && !isSofa)} onClick={() => void submit()}>
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
          seats={seatOpts}
          seat={a.seat}
          onSeat={(v) => set({ seat: v })}
          fabrics={fabricOpts}
          fabric={a.fabric}
          onFabric={(f) => set({ fabric: f, colour: l.coloursOf(f)[0] ?? '' })}
          colours={colourOpts}
          colour={a.colour}
          onColour={(c) => set({ colour: c })}
          legs={legOpts}
          leg={a.leg}
          onLeg={(v) => set({ leg: v })}
          onCancel={() => setBuilding(false)}
          onSave={({ layout, modules }) => { set({ modules, layout }); setBuilding(false); }}
        />
      )}

      {duplicating && (
        <DuplicateFrom
          displays={displays}
          requests={requests}
          showrooms={showrooms}
          types={TYPES.map((t) => t.id)}
          initialTab="display"
          hereId={showroom.id}
          opts={opts}
          onPick={duplicate}
          onClose={() => setDuplicating(false)}
        />
      )}
    </>
  );
};
