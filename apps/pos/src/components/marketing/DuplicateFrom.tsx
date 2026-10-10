// Duplicate from… — fill a form from a piece already on a showroom floor, or
// from a product on the launch board, which is on no floor yet (owner
// 2026-10-10). Opened from ⋯ beside the type chips of the New product launch
// and Add on display forms. One new model going to three showrooms is three
// launch requests: the second and third are copies of the first, however much
// of it is filled in. What a copy takes is marketing-model.ts's to say
// (requestFieldsFrom, displayCopyFrom). Not in the design handoff, so it is
// built from the section's own pieces: the ⋯ menu, the view segment, the
// board's request card lines.

import { useState } from 'react';
import { BedDouble, BedSingle, Copy, MoreHorizontal, Search, Sofa, X } from 'lucide-react';
import {
  missingOf, seatDepth, shapeName, specOf, typeOf, TYPES,
  type DisplayItem, type DisplayType, type DuplicateSource, type LaunchRequest,
} from './marketing-model';
import type { MarketingOptions } from './marketing-options';
import type { ShowroomOption } from '../../lib/marketing-api';
import { SofaLayoutPreview } from './SofaLayoutPreview';
import s from './marketing.module.css';

/** ⋯ at the end of a form's type chips, and its menu. */
export const FormMoreMenu = ({ onDuplicate }: { onDuplicate: () => void }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className={s.moreWrap}>
      <button
        type="button"
        className={`${s.moreBtn} ${open ? s.moreBtnOpen : ''}`}
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreHorizontal size={20} strokeWidth={1.75} className={s.icon} />
      </button>
      {open && (
        <>
          <div className={s.rpScrim} onClick={() => setOpen(false)} />
          <div className={s.morePop} role="menu">
            <button type="button" role="menuitem" className={s.moreItem} onClick={() => { setOpen(false); onDuplicate(); }}>
              <Copy size={20} strokeWidth={1.75} className={`${s.icon} ${s.moreItemIcon}`} />
              <span className={s.moreItemText}>
                <span className={s.moreItemTitle}>Duplicate from…</span>
                <span className={s.moreItemSub}>A piece on display, or a product being launched</span>
              </span>
            </button>
          </div>
        </>
      )}
    </div>
  );
};

type Tab = 'launch' | 'display';

const TYPE_ICON = { sofa: Sofa, mattress: BedSingle, bedframe: BedDouble } as const;
const typeRank = (t: DisplayType) => TYPES.findIndex((x) => x.id === t);
const bg = (url: string | null) => (url ? { backgroundImage: `url("${url}")` } : undefined);

export const DuplicateFrom = ({
  displays, requests, showrooms, types, initialTab, hereId, exceptRequestId, opts, onPick, onClose,
}: {
  displays: DisplayItem[];
  requests: LaunchRequest[];
  showrooms: ShowroomOption[];
  /** What the form can take — a launch request has no accessory. */
  types: readonly DisplayType[];
  initialTab: Tab;
  /** The showroom an Add on display form is filing under, named as such. */
  hereId?: string;
  /** The request being edited, which is not its own source. */
  exceptRequestId?: string | null;
  opts: MarketingOptions;
  /** Fill the form; resolves once it is filled (a photo is fetched first). */
  onPick: (src: DuplicateSource) => Promise<void>;
  onClose: () => void;
}) => {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');

  const takes = (t: DisplayType) => types.includes(t);
  const showroomName = (id: string) => showrooms.find((x) => x.id === id)?.name ?? 'Showroom';
  const here = hereId ? showrooms.find((x) => x.id === hereId) ?? null : null;
  const needle = q.trim().toLowerCase();
  const hit = (...parts: string[]) => !needle || parts.join(' ').toLowerCase().includes(needle);

  const reqs = requests.filter((r) => r.id && r.id !== exceptRequestId && takes(r.type) && hit(
    r.model, r.supplierCode, r.fabric, r.colour, showroomName(r.showroomId), typeOf(r.type).label,
    r.type === 'sofa' ? shapeName(r.modules) : r.size,
  ));
  const pieces = displays.filter((d) => takes(d.type) && hit(d.name, d.code, d.fabric, d.colour, showroomName(d.venueId), typeOf(d.type).label, specOf(d)));
  const requestGroups = [
    { key: 'pending', title: 'Pending Info', list: reqs.filter((r) => r.status === 'pending') },
    { key: 'completed', title: 'Completed Info', list: reqs.filter((r) => r.status === 'completed') },
  ].filter((g) => g.list.length);
  const displayGroups = [...showrooms, ...(pieces.some((d) => !showrooms.some((x) => x.id === d.venueId)) ? [{ id: '', name: 'Showroom', area: '' }] : [])]
    .map((x) => ({
      key: x.id,
      title: x.id === hereId ? `${x.name} · this showroom` : x.name,
      list: pieces
        .filter((d) => (x.id ? d.venueId === x.id : !showrooms.some((y) => y.id === d.venueId)))
        .sort((a, b) => typeRank(a.type) - typeRank(b.type)),
    }))
    .filter((g) => g.list.length);
  const totalReqs = requests.filter((r) => r.id && r.id !== exceptRequestId && takes(r.type)).length;
  const totalPieces = displays.filter((d) => takes(d.type)).length;

  const pick = async (key: string, src: DuplicateSource) => {
    if (busy) return;
    setBusy(key);
    setErr('');
    try {
      await onPick(src);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(null);
    }
  };

  const requestRow = (r: LaunchRequest) => {
    const tl = typeOf(r.type).label;
    const miss = missingOf(r).length;
    const Icon = TYPE_ICON[r.type];
    const meta = [r.type === 'sofa' && r.modules.length ? shapeName(r.modules) : '', [r.fabric, r.colour].filter(Boolean).join(' '), r.type !== 'sofa' ? r.size : '']
      .filter(Boolean).join(' · ') || 'No details yet';
    return (
      <button key={r.id} type="button" className={s.dupItem} disabled={!!busy} onClick={() => void pick(r.id!, { kind: 'request', request: r })}>
        <span className={s.dupThumb}>
          {r.type === 'sofa' && r.modules.length > 0
            ? <SofaLayoutPreview layout={r.layout} modules={r.modules} depth={seatDepth(r.seat)} art={opts.moduleArt} />
            : <Icon size={24} strokeWidth={1.75} className={s.icon} />}
        </span>
        <span className={s.dupText}>
          <span className={s.dupLine1}>
            <span className={s.reqType}>{tl}</span>
            {r.supplierCode && <span className={s.dupCode}>{r.supplierCode}</span>}
          </span>
          <span className={`${s.dupName} ${r.model ? '' : s.reqTitleBlank}`}>{r.model || `Untitled ${tl.toLowerCase()}`}</span>
          <span className={s.dupMeta}>{meta}</span>
        </span>
        <span className={s.dupSide}>
          <span className={s.dupWhere}>{r.action === 'replace' ? 'Replace' : 'Add'} → {showroomName(r.showroomId)}</span>
          {busy === r.id
            ? <span className={s.dupBusy}>Copying…</span>
            : <span className={miss ? s.dupToFill : s.dupFilled}>{miss ? `${miss} still to fill` : 'All filled'}</span>}
        </span>
      </button>
    );
  };

  const displayRow = (d: DisplayItem) => {
    const live = d.type !== 'sofa' && d.modelId ? opts.models[d.type].find((m) => m.id === d.modelId)?.photoUrl ?? null : null;
    const photo = d.type === 'sofa' ? null : live ?? d.photoUrl;
    return (
      <button key={d.id} type="button" className={s.dupItem} disabled={!!busy} onClick={() => void pick(d.id, { kind: 'display', item: d })}>
        <span className={s.dupThumb} style={bg(photo)}>
          {d.type === 'sofa' && <SofaLayoutPreview layout={d.layout} modules={d.modules} depth={seatDepth(d.seat)} art={opts.moduleArt} />}
          {d.type !== 'sofa' && !photo && <span className={s.dupInitial}>{(d.name || '?').charAt(0).toUpperCase()}</span>}
        </span>
        <span className={s.dupText}>
          <span className={s.dupLine1}>
            <span className={s.reqType}>{typeOf(d.type).label}</span>
            {d.isNew && <span className={s.dupNew}>New</span>}
          </span>
          <span className={s.dupName}>{d.name}</span>
          <span className={s.dupMeta}>{specOf(d)}</span>
        </span>
        <span className={s.dupSide}>
          <span className={s.dupCode}>{d.code}</span>
          {busy === d.id && <span className={s.dupBusy}>Copying…</span>}
        </span>
      </button>
    );
  };

  const groups: Array<{ key: string; title: string; list: LaunchRequest[] | DisplayItem[] }> =
    tab === 'launch' ? requestGroups : displayGroups;
  const total = tab === 'launch' ? totalReqs : totalPieces;

  return (
    <div className={s.dialogScrim}>
      <div className={s.dupDialog} role="dialog" aria-label="Duplicate from">
        <div className={s.dupHead}>
          <div>
            <div className={s.dialogTitle}>Duplicate from…</div>
            <div className={s.modalSub}>
              {here
                ? `Copies it into this form, to put on display at ${here.name}.`
                : 'Copies the product into this form. The showroom and Add / Replace stay as you set them here.'}
            </div>
          </div>
          <button type="button" className={s.closeBtn} aria-label="Close" onClick={onClose}>
            <X size={18} strokeWidth={1.75} className={s.icon} />
          </button>
        </div>
        <div className={s.dupControls}>
          <div className={s.viewSeg} role="tablist" aria-label="Copy from">
            {([['launch', 'Product launching', totalReqs], ['display', 'On display', totalPieces]] as const).map(([id, label, n]) => (
              <button
                key={id} type="button" role="tab" aria-selected={tab === id}
                className={`${s.viewSegBtn} ${tab === id ? s.viewSegBtnOn : ''}`} onClick={() => setTab(id)}
              >
                {label}<span className={s.chipCount}>{n}</span>
              </button>
            ))}
          </div>
          <label className={s.dupSearch}>
            <Search size={16} strokeWidth={1.75} className={s.icon} />
            <input
              className={s.dupSearchInput} value={q} placeholder="Model, supplier code, fabric, showroom"
              aria-label="Search" onChange={(e) => setQ(e.target.value)}
            />
          </label>
        </div>
        <div className={s.dupList}>
          {groups.map((g) => (
            <section key={g.key} className={s.dupGroup}>
              <header className={s.dupGroupHead}>
                <span className={s.dupGroupTitle}>{g.title}</span>
                <span className={s.groupCount}>{g.list.length}</span>
              </header>
              {tab === 'launch'
                ? (g.list as LaunchRequest[]).map(requestRow)
                : (g.list as DisplayItem[]).map(displayRow)}
            </section>
          ))}
          {groups.length === 0 && (
            <div className={s.dupEmpty}>
              {total === 0
                ? (tab === 'launch' ? 'No products on the launch board yet.' : 'Nothing on display yet.')
                : `Nothing matches “${q.trim()}”.`}
            </div>
          )}
        </div>
        {err && <div className={`${s.formError} ${s.dupError}`}>{err}</div>}
      </div>
    </div>
  );
};
