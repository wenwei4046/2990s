// Product launching — the Management → Marketing hand-off board (design
// screens 07–09): Pending Info → Completed Info → Arrive.

import { useState } from 'react';
import { BedDouble, BedSingle, ClipboardCopy, ClipboardList, PackageCheck, Sofa, Trash2, Truck } from 'lucide-react';
import {
  blankRequest, exportText, missingOf, RM, requestTotal, seatDepth, shapeName, shortDate, typeOf, type LaunchRequest,
} from './marketing-model';
import { useMarketingOptions } from './marketing-options';
import { useArriveRequest, useDeleteRequest, useRequestPhoto, type MarketingState } from '../../lib/marketing-api';
import { SofaLayoutPreview } from './SofaLayoutPreview';
import { LaunchRequestModal } from './LaunchRequestModal';
import { ExportModal } from './ExportModal';
import s from './marketing.module.css';

const TYPE_ICON = { sofa: Sofa, mattress: BedSingle, bedframe: BedDouble } as const;

export const ProductLaunchTab = ({ state, draft, setDraft, toast }: {
  state: MarketingState;
  draft: LaunchRequest | null;
  setDraft: (d: LaunchRequest | null) => void;
  toast: (t: string) => void;
}) => {
  const opts = useMarketingOptions();
  const pending = state.requests.filter((r) => r.status === 'pending');
  const completed = state.requests.filter((r) => r.status === 'completed');
  const [delId, setDelId] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const del = useDeleteRequest();
  const arrive = useArriveRequest();

  const showroomName = (id: string) => state.showrooms.find((x) => x.id === id)?.name ?? null;
  const displayOf = (id: string | null) => (id ? state.displays.find((d) => d.id === id) ?? null : null);

  /** Open a saved request in the form. A Replace whose piece is unset (or no
   *  longer on display) takes the first same-category candidate — the rule the
   *  design's form applies whenever the showroom, type or action changes. The
   *  prototype skipped it on open, which left its select SHOWING the first
   *  piece while nothing was chosen (and re-picking that piece fired no
   *  change). */
  const openForEdit = (r: LaunchRequest): LaunchRequest => {
    const d = { ...r, rows: r.rows.map((x) => ({ ...x })) };
    if (d.action === 'replace') {
      const c = state.displays.filter((x) => x.venueId === d.showroomId && x.type === d.type);
      if (!c.some((x) => x.id === d.replaceId)) d.replaceId = c[0]?.id ?? null;
    }
    return d;
  };

  const doArrive = async (r: LaunchRequest) => {
    if (!r.id) return;
    try {
      const res = await arrive.mutateAsync(r.id);
      const old = res.removedName;
      toast(`${r.model} is now on display at ${showroomName(r.showroomId) ?? 'the showroom'}${old ? ` · ${old} removed` : ''}`);
    } catch (e) {
      toast(`Not arrived — ${(e as Error).message}`);
    }
  };

  const delReq = state.requests.find((r) => r.id === delId) ?? null;
  const doDelete = async () => {
    if (!delReq?.id) return;
    try {
      await del.mutateAsync(delReq.id);
      setDelId(null);
      toast(`${delReq.model || 'Request'} deleted`);
    } catch (e) {
      toast(`Not deleted — ${(e as Error).message}`);
    }
  };

  const card = (r: LaunchRequest) => {
    const tlabel = typeOf(r.type).label;
    const miss = missingOf(r);
    const tot = missingOf({ ...blankRequest('', ''), type: r.type, action: r.action }).length;
    const done = Math.max(0, tot - miss.length);
    const pct = tot ? Math.round((done / tot) * 100) : 100;
    const rep = displayOf(r.replaceId);
    const meta = [r.supplierCode, r.fabric, r.type === 'sofa' && r.modules.length ? shapeName(r.modules) : '', r.type !== 'sofa' ? r.size : '']
      .filter(Boolean).join(' · ') || 'No details yet';
    const Icon = TYPE_ICON[r.type];
    const isCompleted = r.status === 'completed';
    return (
      <div key={r.id ?? 'draft'} className={s.reqCard}>
        <div className={s.reqTop}>
          <div className={s.reqThumb}>
            {r.type === 'sofa' && r.modules.length > 0
              ? <SofaLayoutPreview layout={r.layout} modules={r.modules} depth={seatDepth(r.seat)} art={opts.moduleArt} />
              : <Icon size={26} strokeWidth={1.75} className={s.icon} />}
          </div>
          <div className={s.reqInfo}>
            <div className={s.reqLine1}>
              <span className={s.reqType}>{tlabel}</span>
              <span className={s.reqByline}>{`${r.by || 'Anyone'} · ${shortDate(r.created)}`}</span>
            </div>
            <span className={`${s.reqTitle} ${r.model ? '' : s.reqTitleBlank}`}>{r.model || `Untitled ${tlabel.toLowerCase()}`}</span>
            <span className={s.reqMeta}>{meta}</span>
          </div>
        </div>
        <div className={s.reqTruck}>
          <Truck size={14} strokeWidth={1.75} className={`${s.icon} ${s.reqTruckIcon}`} />
          <span className={s.reqTruckText}>
            <b>{r.action === 'replace' ? 'Replace' : 'Add'}</b> → {showroomName(r.showroomId) ?? '—'}
            {rep && <span className={s.reqReplaces}> · replaces {rep.name}</span>}
          </span>
          {r.type === 'sofa' && r.rows.length > 0 && <span className={s.reqTotal}>{RM(requestTotal(r))}</span>}
        </div>
        {miss.length > 0 && (
          <div className={s.missBox}>
            <div className={s.missHead}>
              <span className={s.missLabel}><ClipboardList size={14} strokeWidth={1.75} className={s.icon} />Still to fill · {miss.length}</span>
              <span className={s.missProgress}>{`${done} of ${tot} filled`}</span>
            </div>
            <div className={s.missBar}><div className={s.missBarFill} style={{ width: `${pct}%` }} /></div>
            <div className={s.missList}>
              {miss.map((m) => (
                <span key={m} className={s.missItem}><span className={s.missBoxTick} /><span className={s.missText}>{m}</span></span>
              ))}
            </div>
          </div>
        )}
        <div className={s.reqFoot}>
          <button type="button" className={s.reqDelete} title="Delete request" onClick={() => setDelId(r.id)}>
            <Trash2 size={13} strokeWidth={1.75} className={s.icon} />Delete
          </button>
          <button type="button" className={s.reqGhost} onClick={() => setDraft(openForEdit(r))}>
            {isCompleted ? 'Edit' : 'Fill in'}
          </button>
          {isCompleted && (
            <button type="button" className={s.reqGhost} onClick={() => setExporting(r.id)}>
              <ClipboardCopy size={13} strokeWidth={1.75} className={s.icon} />Export
            </button>
          )}
          {isCompleted && (
            <button type="button" className={s.reqArrive} disabled={arrive.isPending} onClick={() => void doArrive(r)}>
              <PackageCheck size={13} strokeWidth={1.75} className={s.icon} />Arrive
            </button>
          )}
        </div>
      </div>
    );
  };

  const cols = [
    { key: 'p', title: 'Pending Info', list: pending, dot: 'var(--c-orange)', cls: s.boardColPending, hint: 'Fill in, then Complete', emptyTitle: 'Nothing pending', emptyBody: 'Requests that still need details land here.' },
    { key: 'c', title: 'Completed Info', list: completed, dot: 'var(--c-success)', cls: s.boardColDone, hint: 'Press Arrive when it reaches the showroom', emptyTitle: 'Nothing waiting to arrive', emptyBody: 'Completed requests wait here until Marketing presses Arrive.' },
  ];

  const exportReq = state.requests.find((r) => r.id === exporting) ?? null;
  // The brief describes the photo; Procurement needs the picture beside it.
  const exportPhoto = useRequestPhoto(exportReq?.type === 'sofa' ? exportReq.id : null, exportReq?.photoAt ?? null);
  const photoName = (r: LaunchRequest, dataUrl: string) =>
    `${(r.model || r.supplierCode || 'sofa').trim().replace(/[^\w-]+/g, '-')}-photo.${dataUrl.startsWith('data:image/png') ? 'png' : 'jpg'}`;

  return (
    <>
      <div className={s.launchWrap}>
        <div className={s.launchStatsRow}>
          <div className={s.launchStats}>
            <div className={s.launchStat}><span className={s.launchStatN} style={{ color: 'var(--c-warn)' }}>{pending.length}</span><span className={s.launchStatLabel}>pending info</span></div>
            <div className={s.launchStat}><span className={s.launchStatN} style={{ color: 'var(--c-success)' }}>{completed.length}</span><span className={s.launchStatLabel}>ready to arrive</span></div>
          </div>
        </div>
        <div className={s.board}>
          {cols.map((col) => (
            <section key={col.key} className={`${s.boardCol} ${col.cls}`}>
              <header className={s.boardHead}>
                <div className={s.boardHeadLeft}>
                  <span className={s.boardDot} style={{ background: col.dot }} />
                  <span className={s.boardTitle}>{col.title}</span>
                  <span className={s.boardCount}>{col.list.length}</span>
                </div>
              </header>
              <span className={s.boardHint}>{col.hint}</span>
              {col.list.length === 0 && (
                <div className={s.boardEmpty}>
                  <span className={s.boardEmptyTitle}>{col.emptyTitle}</span>
                  <span className={s.boardEmptyBody}>{col.emptyBody}</span>
                </div>
              )}
              {col.list.map(card)}
            </section>
          ))}
        </div>
      </div>

      {draft && (
        <LaunchRequestModal
          draft={draft}
          setDraft={setDraft}
          opts={opts}
          showrooms={state.showrooms}
          displays={state.displays}
          sofaOptions={state.sofaOptions}
          onSaved={(status) => { setDraft(null); toast(status === 'completed' ? 'Moved to Completed Info' : 'Saved to Pending Info'); }}
        />
      )}

      {delReq && (
        <div className={`${s.dialogScrim} ${s.dialogScrimTop}`}>
          <div className={s.dialog} role="alertdialog" aria-label="Delete this request?">
            <div className={s.dialogTitle}>Delete this request?</div>
            <div className={s.dialogText}>
              {`${delReq.model || 'Untitled ' + typeOf(delReq.type).label.toLowerCase()} (${typeOf(delReq.type).label}, ${delReq.status === 'completed' ? 'Completed Info' : 'Pending Info'}) will be removed. Nothing changes on the showroom display.`}
            </div>
            <div className={s.dialogActions}>
              <button type="button" className={s.ghostBtn} onClick={() => setDelId(null)}>Keep</button>
              <button type="button" className={s.dangerBtn} disabled={del.isPending} onClick={() => void doDelete()}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {exportReq && (
        <ExportModal
          initial={exportText(exportReq, {
            showroomName: showroomName(exportReq.showroomId),
            replaceItem: displayOf(exportReq.replaceId),
            moduleLabel: opts.moduleLabel,
          })}
          photo={exportPhoto.data ? { dataUrl: exportPhoto.data.dataUrl, fileName: photoName(exportReq, exportPhoto.data.dataUrl) } : null}
          onClose={() => setExporting(null)}
        />
      )}
    </>
  );
};
