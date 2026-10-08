// Showroom display — what is physically on the floor in each showroom.
// Design screens 02 (page), 03 (detail drawer), 04–06 (Add on display). The
// showroom list itself is kept here too (Add showroom / Edit showroom — owner
// 2026-10-09, migration 0218), which the design did not have.

import { useMemo, useState, type ChangeEvent } from 'react';
import { ImageUp, Pencil, Plus, Store, Trash2, Upload, X } from 'lucide-react';
import {
  detailRows, moduleInfo, shapeName, specOf, tagsOf, typeOf, TYPES,
  type DisplayItem, type DisplayType,
} from './marketing-model';
import { useMarketingOptions, type MarketingOptions } from './marketing-options';
import {
  prepareFloorplan, useDeleteFloorplan, useFloorplan, usePutFloorplan, useRemoveDisplay, type MarketingState,
} from '../../lib/marketing-api';
import { SofaBlueprint } from './SofaBlueprint';
import { AddDisplayModal } from './AddDisplayModal';
import { ShowroomDialog } from './ShowroomDialog';
import s from './marketing.module.css';

type CatFilter = 'all' | DisplayType;

/** A display's picture: the live catalogue photo for its Model, else the one
 *  snapshotted when it was added. Sofas draw their blueprint instead. */
const photoOf = (it: DisplayItem, opts: MarketingOptions): string | null => {
  if (it.type === 'sofa') return null;
  const live = it.modelId ? opts.models[it.type].find((m) => m.id === it.modelId)?.photoUrl : null;
  return live ?? it.photoUrl ?? null;
};
const initialOf = (name: string) => (name || '?').charAt(0).toUpperCase();
const bg = (url: string | null) => (url ? { backgroundImage: `url("${url}")` } : undefined);

export const ShowroomDisplayTab = ({ state, toast }: { state: MarketingState; toast: (t: string) => void }) => {
  const opts = useMarketingOptions();
  const showrooms = state.showrooms;
  const [pickedId, setPickedId] = useState<string | null>(null);
  const showroom = showrooms.find((x) => x.id === pickedId) ?? showrooms[0] ?? null;
  const [catFilter, setCatFilter] = useState<CatFilter>('all');
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  /** The showroom dialog: 'add', or the id of the showroom being edited. */
  const [srDialog, setSrDialog] = useState<'add' | string | null>(null);

  const byShowroom = useMemo(() => {
    const m = new Map<string, DisplayItem[]>();
    for (const d of state.displays) m.set(d.venueId, [...(m.get(d.venueId) ?? []), d]);
    return m;
  }, [state.displays]);
  const items = showroom ? byShowroom.get(showroom.id) ?? [] : [];
  const planMeta = showroom ? state.floorplans.find((f) => f.venueId === showroom.id) ?? null : null;
  const plan = useFloorplan(showroom?.id ?? null, planMeta?.updatedAt ?? null);
  const putPlan = usePutFloorplan();
  const delPlan = useDeleteFloorplan();
  const remove = useRemoveDisplay();

  const findItem = (id: string | null) => {
    if (!id) return null;
    const it = state.displays.find((d) => d.id === id);
    if (!it) return null;
    return { it, s: showrooms.find((x) => x.id === it.venueId) ?? { id: it.venueId, name: 'Showroom', area: '' } };
  };
  const drawer = findItem(drawerId);
  const confirm = findItem(confirmId);

  const onPlanFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f || !showroom) return;
    try {
      const p = await prepareFloorplan(f);
      await putPlan.mutateAsync({ venueId: showroom.id, ...p });
    } catch (err) {
      toast(`Floor plan not saved — ${(err as Error).message}`);
    }
  };

  const doRemove = async () => {
    if (!confirm) return;
    try {
      await remove.mutateAsync(confirm.it.id);
      setConfirmId(null);
      setDrawerId(null);
      toast(`${confirm.it.name} removed from ${confirm.s.name}`);
    } catch (err) {
      toast(`Not removed — ${(err as Error).message}`);
    }
  };

  const editing = srDialog && srDialog !== 'add' ? showrooms.find((x) => x.id === srDialog) ?? null : null;
  const showroomDialog = srDialog && (
    <ShowroomDialog
      showroom={editing ?? undefined}
      inUse={editing ? {
        pieces: byShowroom.get(editing.id)?.length ?? 0,
        open: state.requests.filter((r) => r.showroomId === editing.id).length,
      } : undefined}
      onClose={() => setSrDialog(null)}
      onSaved={(saved, added) => {
        setSrDialog(null);
        if (added) { setPickedId(saved.id); setCatFilter('all'); }
        toast(added ? `${saved.name} added` : `${saved.name} saved`);
      }}
      onRemoved={(name) => { setSrDialog(null); setPickedId(null); toast(`${name} removed from the list`); }}
    />
  );

  if (!showroom) {
    return (
      <>
        <div className={s.emptyCard}>
          <div className={s.emptyCardTitle}>No showrooms yet.</div>
          <div className={s.emptyCardBody}>Add the showrooms you keep a display record for.</div>
          <button type="button" className={`${s.addDisplayBtn} ${s.emptyCardAction}`} onClick={() => setSrDialog('add')}>
            <Plus size={16} strokeWidth={1.75} className={s.icon} />Add showroom
          </button>
        </div>
        {showroomDialog}
      </>
    );
  }

  const cnt = (t: DisplayType) => items.filter((x) => x.type === t).length;
  const catTabs: Array<{ id: CatFilter; label: string; count: number }> = [
    { id: 'all', label: 'All', count: items.length },
    ...TYPES.map((t) => ({ id: t.id, label: t.group, count: cnt(t.id) })),
  ];
  const groups = TYPES.filter((t) => catFilter === 'all' || catFilter === t.id)
    .map((t) => ({ t, list: items.filter((x) => x.type === t.id) }))
    .filter((g) => g.list.length > 0);

  return (
    <>
      <div className={s.displayLayout}>
        <aside className={s.rail}>
          <div className={s.railHead}>
            <span className={s.railTitle}>Showrooms</span>
            <span className={s.railMeta}>{showrooms.length} {showrooms.length === 1 ? 'branch' : 'branches'}</span>
          </div>
          {showrooms.map((x) => {
            const l = byShowroom.get(x.id) ?? [];
            const c = (t: DisplayType) => l.filter((d) => d.type === t).length;
            const active = x.id === showroom.id;
            const hasPlan = state.floorplans.some((f) => f.venueId === x.id);
            return (
              <button
                key={x.id}
                type="button"
                className={`${s.srCard} ${active ? s.srCardActive : ''}`}
                onClick={() => { setPickedId(x.id); setCatFilter('all'); }}
              >
                <span className={s.srTop}>
                  <span className={s.srIcon}><Store size={16} strokeWidth={1.75} className={s.icon} /></span>
                  <span className={s.srNameBlock}>
                    <span className={s.srName}>{x.name}</span>
                    {x.area && <span className={s.srArea}>{x.area}</span>}
                  </span>
                  <span className={s.srCount}>{l.length}</span>
                </span>
                <span className={s.srStats}>
                  {([['sofa', 'Sofa'], ['mattress', 'Mattress'], ['bedframe', 'Bed frame']] as const).map(([t, label]) => (
                    <span key={t} className={s.srStat}>
                      <span className={s.srStatN}>{c(t)}</span>
                      <span className={s.srStatLabel}>{label}</span>
                    </span>
                  ))}
                </span>
                <span className={`${s.srPlan} ${hasPlan ? s.srPlanOk : ''}`}>
                  <span className={s.srPlanDot} />
                  {hasPlan ? 'Floor plan uploaded' : 'No floor plan yet'}
                </span>
              </button>
            );
          })}
          <button type="button" className={s.srAdd} onClick={() => setSrDialog('add')}>
            <Plus size={16} strokeWidth={1.75} className={s.icon} />Add showroom
          </button>
        </aside>

        <section className={s.displayMain}>
          <div className={s.srHeader}>
            <div className={s.srHeaderText}>
              {showroom.area && <span className={s.eyebrowBurnt}>{showroom.area}</span>}
              <h2 className={s.srTitle}>{showroom.name}</h2>
              <span className={s.srSummary}>
                {items.length ? `${items.length} piece${items.length === 1 ? '' : 's'} on display` : 'No pieces on display'}
              </span>
            </div>
            <div className={s.srHeaderActions}>
              <button type="button" className={`${s.ghostBtn} ${s.srEditBtn}`} onClick={() => setSrDialog(showroom.id)}>
                <Pencil size={15} strokeWidth={1.75} className={s.icon} />Edit showroom
              </button>
              <button type="button" className={s.addDisplayBtn} onClick={() => setAddOpen(true)}>
                <Plus size={16} strokeWidth={1.75} className={s.icon} />Add on display
              </button>
            </div>
          </div>

          {!planMeta ? (
            <label className={s.planStrip}>
              <span className={s.planStripIcon}><ImageUp size={20} strokeWidth={1.75} className={s.icon} /></span>
              <span className={s.planStripText}>
                <span className={s.planStripTitle}>Floor plan</span>
                <span className={s.planStripSub}>
                  {putPlan.isPending ? 'Uploading…' : 'Upload the layout from the design team · PNG or JPG'}
                </span>
              </span>
              <span className={s.planStripPill}>Upload</span>
              <input type="file" accept="image/*" className={s.hiddenFile} onChange={(e) => void onPlanFile(e)} />
            </label>
          ) : (
            <div className={s.planCard}>
              <div className={s.planCardHead}>
                <span className={s.planCardTitle}>Floor plan</span>
                <div className={s.planCardActions}>
                  <label className={s.planReplace}>
                    <Upload size={13} strokeWidth={1.75} className={s.icon} />Replace
                    <input type="file" accept="image/*" className={s.hiddenFile} onChange={(e) => void onPlanFile(e)} />
                  </label>
                  <button
                    type="button"
                    className={s.planRemove}
                    disabled={delPlan.isPending}
                    onClick={() => delPlan.mutate(showroom.id, { onError: (err) => toast(`Not removed — ${err.message}`) })}
                  >
                    Remove
                  </button>
                </div>
              </div>
              <div role="img" aria-label="Floor plan" className={s.planImage} style={bg(plan.data ?? null)} />
            </div>
          )}

          <div className={s.catChips}>
            {catTabs.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`${s.chipToggle} ${catFilter === t.id ? s.chipToggleOn : ''}`}
                onClick={() => setCatFilter(t.id)}
              >
                {t.label}<span className={s.chipCount}>{t.count}</span>
              </button>
            ))}
          </div>

          {groups.length === 0 && (
            <div className={s.emptyCard}>
              <div className={s.emptyCardTitle}>Nothing on display here yet.</div>
              <div className={s.emptyCardBody}>Use Add on display to record what is on the floor.</div>
            </div>
          )}

          {groups.map(({ t, list }) => (
            <section key={t.id} className={s.group}>
              <header className={s.groupHead}>
                <span className={s.groupLabel}>{t.group}</span>
                <span className={s.groupCount}>{list.length} {list.length === 1 ? 'piece' : 'pieces'}</span>
              </header>
              <div className={s.displayGrid}>
                {list.map((it) => {
                  const photo = photoOf(it, opts);
                  return (
                    <div
                      key={it.id}
                      className={s.displayCard}
                      role="button"
                      tabIndex={0}
                      onClick={() => setDrawerId(it.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDrawerId(it.id); } }}
                    >
                      <div className={s.displayPic} style={bg(photo)}>
                        {it.type === 'sofa' && <SofaBlueprint modules={it.modules} maxW={180} maxH={100} />}
                        {it.type !== 'sofa' && !photo && <span className={s.initialArt}>{initialOf(it.name)}</span>}
                        {it.isNew && <span className={s.newPill}>New</span>}
                        {it.type === 'sofa' && <span className={s.shapePill}>{shapeName(it.modules)}</span>}
                      </div>
                      <div className={s.displayBody}>
                        <div className={s.displayNameRow}>
                          <span className={s.displayName}>{it.name}</span>
                          <span className={s.displayCode}>{it.code || '—'}</span>
                        </div>
                        <div className={s.tagRow}>
                          {tagsOf(it).map((tag) => <span key={tag} className={s.tag}>{tag}</span>)}
                        </div>
                        <div className={s.spacer} />
                        <div className={s.displayFoot}>
                          <span className={s.viewDetails}>View details</span>
                          <button
                            type="button"
                            className={s.binBtn}
                            title="Remove from display"
                            aria-label={`Remove ${it.name} from display`}
                            onClick={(e) => { e.stopPropagation(); setConfirmId(it.id); }}
                          >
                            <Trash2 size={15} strokeWidth={1.75} className={s.icon} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </section>
      </div>

      {drawer && (
        <>
          <div className={s.drawerScrim} onClick={() => setDrawerId(null)} />
          <aside className={s.drawer} aria-label={`${drawer.it.name} details`}>
            <div className={s.drawerHead}>
              <div className={s.drawerEyebrow}>{typeOf(drawer.it.type).label} · {drawer.s.name}</div>
              <button type="button" className={s.closeBtn} aria-label="Close" onClick={() => setDrawerId(null)}>
                <X size={18} strokeWidth={1.75} className={s.icon} />
              </button>
            </div>
            <div className={s.drawerBody}>
              <div className={s.drawerPic} style={bg(photoOf(drawer.it, opts))}>
                {drawer.it.type === 'sofa' && <SofaBlueprint modules={drawer.it.modules} maxW={400} maxH={200} showLabels />}
                {drawer.it.type !== 'sofa' && !photoOf(drawer.it, opts) && <span className={s.drawerInitial}>{initialOf(drawer.it.name)}</span>}
              </div>
              <div>
                <div className={s.drawerName}>{drawer.it.name}</div>
                <div className={s.drawerCode}>{drawer.it.code || '—'}</div>
              </div>
              <div className={s.kvTable}>
                {detailRows(drawer.it).map((row) => (
                  <div key={row.k} className={s.kvRow}><span className={s.kvKey}>{row.k}</span><span className={s.kvVal}>{row.v}</span></div>
                ))}
              </div>
              {drawer.it.type === 'sofa' && (
                <div className={s.compsBlock}>
                  <div className={s.compsTitle}>Compartments · left to right</div>
                  {drawer.it.modules.map((m, i) => {
                    const info = moduleInfo(m, opts.moduleLabel(m));
                    return (
                      <div key={`${m}-${i}`} className={s.compRow}>
                        <span className={s.compN}>{i + 1}</span>
                        <span className={s.compId}>{m}</span>
                        <span className={s.compLabel}>{info.label}</span>
                        <span className={s.compDim}>{info.dim}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className={s.drawerFoot}>
              <button type="button" className={s.removeOutline} onClick={() => setConfirmId(drawer.it.id)}>
                <Trash2 size={15} strokeWidth={1.75} className={s.icon} />Remove from display
              </button>
            </div>
          </aside>
        </>
      )}

      {confirm && (
        <div className={s.dialogScrim}>
          <div className={s.dialog} role="alertdialog" aria-label="Remove from display?">
            <div className={s.dialogTitle}>Remove from display?</div>
            <div className={s.dialogText}>
              {`${confirm.it.name} (${specOf(confirm.it)}) will be taken off ${confirm.s.name}'s display list.`}
            </div>
            <div className={s.dialogActions}>
              <button type="button" className={s.ghostBtn} onClick={() => setConfirmId(null)}>Keep</button>
              <button type="button" className={s.dangerBtn} disabled={remove.isPending} onClick={() => void doRemove()}>Remove</button>
            </div>
          </div>
        </div>
      )}

      {addOpen && (
        <AddDisplayModal
          showroom={showroom}
          opts={opts}
          onClose={() => setAddOpen(false)}
          onAdded={(name) => { setAddOpen(false); toast(`${name} added to ${showroom.name}`); }}
        />
      )}

      {showroomDialog}
    </>
  );
};
