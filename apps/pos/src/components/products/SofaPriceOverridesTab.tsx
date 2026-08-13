// ----------------------------------------------------------------------------
// SofaPriceOverridesTab — stop-gap selling prices for sofa module SKUs the
// Houzs catalogue serves as null (migration 0213).
//
// This is a REPAIR surface, not a pricing surface. Nobody should invent a
// figure here: the number comes from the drift rejection the salesperson just
// hit, which names the SKU, the tablet's total and the server's. The gap is
// the missing module's price. The UI says so, because the one way to misuse
// this table is to guess.
//
// Money is entered and shown in RM; the API speaks sen. The conversion lives
// here and nowhere else.
// ----------------------------------------------------------------------------

import { useState } from 'react';
import { Plus, Pencil, Trash2, X } from 'lucide-react';
import { Button } from '@2990s/design-system';
import {
  useSofaPriceOverrides,
  useSaveSofaPriceOverride,
  useDeleteSofaPriceOverride,
  type SofaPriceOverride,
} from '../../lib/products/sofa-price-override-queries';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

const centiToRm = (c: number): string => (c / 100).toFixed(2);
const rmToCenti = (rm: string): number => Math.round(Number(rm || 0) * 100);

const label: React.CSSProperties = {
  display: 'block', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', marginBottom: 4,
};
const input: React.CSSProperties = {
  width: '100%', padding: '8px 10px', border: '1px solid var(--line-strong)',
  borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-14)',
};

interface Draft {
  itemCode: string;
  priceRm: string;
  note: string;
  /** Editing an existing row — the code is the primary key, so it's locked. */
  existing: boolean;
}

export function SofaPriceOverridesTab({ canEdit }: { canEdit: boolean }) {
  const { data: rows = [], isLoading, error } = useSofaPriceOverrides();
  const save = useSaveSofaPriceOverride();
  const del = useDeleteSofaPriceOverride();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const onSave = async () => {
    if (!draft) return;
    setSaveError(null);
    const itemCode = draft.itemCode.trim().toUpperCase();
    const sellPriceCenti = rmToCenti(draft.priceRm);
    if (!itemCode) { setSaveError('The module SKU code is required.'); return; }
    if (sellPriceCenti <= 0) { setSaveError('Enter a price above RM 0.'); return; }
    try {
      await save.mutateAsync({ itemCode, sellPriceCenti, note: draft.note.trim() });
      setDraft(null);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'save_failed');
    }
  };

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
        <h3 style={{ fontSize: 'var(--fs-13)', fontWeight: 600, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', margin: 0 }}>
          Sofa module price fixes
        </h3>
        {canEdit && (
          <Button variant="secondary" onClick={() => { setSaveError(null); setDraft({ itemCode: '', priceRm: '', note: '', existing: false }); }}>
            <Plus {...ICON} /> Add fix
          </Button>
        )}
      </div>

      <p style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-soft)', marginTop: 0, marginBottom: 'var(--space-4)' }}>
        Some sofa modules have no price in the product catalogue, so the tablet quotes a sofa
        lower than HouzsERP does and the order is refused at handover
        (&ldquo;price is out of date&rdquo;). A fix here fills that gap so the tablet shows the
        right price from the start.
      </p>

      <div style={{ padding: 'var(--space-3)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-4)', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
        <strong style={{ color: 'var(--fg)' }}>Don&rsquo;t guess a price.</strong> Take it from the
        refusal message: it shows the tablet&rsquo;s total and HouzsERP&rsquo;s. The difference is
        what the missing module is worth. Example &mdash; <em>tablet RM 990 vs server RM 1,980</em>{' '}
        on a build of L(LHF) + STOOL + L(RHF), where only L(LHF) is priced at RM 990, means
        <strong> UBORR-L(RHF) = RM 990</strong>. If the figure is wrong the order simply gets
        refused again with the correct one &mdash; nothing is charged incorrectly.
      </div>

      {isLoading && <div style={{ color: 'var(--fg-muted)' }}>Loading…</div>}
      {error && (
        <div style={{ color: 'var(--c-burnt, #A6471E)', marginBottom: 'var(--space-3)' }}>
          Couldn&rsquo;t load: {String((error as Error).message)}
        </div>
      )}

      {!isLoading && rows.length === 0 && (
        <div style={{ padding: 'var(--space-5)', textAlign: 'center', color: 'var(--fg-muted)', border: '1px dashed var(--line-strong)', borderRadius: 'var(--radius-md)' }}>
          No fixes recorded.{canEdit ? ' Add one when a sofa is refused at handover.' : ''}
        </div>
      )}

      {rows.map((r: SofaPriceOverride) => (
        <div
          key={r.itemCode}
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: 'var(--space-3)', border: '1px solid var(--line)',
            borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-2)',
          }}
        >
          <div>
            <div style={{ fontWeight: 600 }}>{r.itemCode}</div>
            <div style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
              RM {centiToRm(r.sellPriceCenti)}
              {r.note ? ` · ${r.note}` : ''}
            </div>
          </div>
          {canEdit && (
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <Button
                variant="secondary"
                onClick={() => {
                  setSaveError(null);
                  setDraft({ itemCode: r.itemCode, priceRm: centiToRm(r.sellPriceCenti), note: r.note, existing: true });
                }}
              >
                <Pencil {...ICON} /> Edit
              </Button>
              {confirmDelete === r.itemCode ? (
                <>
                  <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button>
                  <Button
                    onClick={() => { void del.mutateAsync(r.itemCode).finally(() => setConfirmDelete(null)); }}
                    disabled={del.isPending}
                  >
                    {del.isPending ? 'Removing…' : 'Confirm remove'}
                  </Button>
                </>
              ) : (
                <Button variant="ghost" onClick={() => setConfirmDelete(r.itemCode)}>
                  <Trash2 {...ICON} /> Remove
                </Button>
              )}
            </div>
          )}
        </div>
      ))}

      {draft && (
        <Modal title={draft.existing ? `Edit ${draft.itemCode}` : 'Add a price fix'} onClose={() => setDraft(null)}>
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            <div>
              <label style={label}>
                Module SKU code — exactly as the refusal message shows it
              </label>
              <input
                style={{ ...input, ...(draft.existing ? { background: 'var(--bg-muted, #f5f5f5)' } : {}) }}
                value={draft.itemCode}
                placeholder="UBORR-L(RHF)"
                disabled={draft.existing}
                onChange={(e) => setDraft({ ...draft, itemCode: e.target.value })}
              />
            </div>
            <div>
              <label style={label}>Price (RM)</label>
              <input style={input} inputMode="decimal" value={draft.priceRm} placeholder="990.00"
                onChange={(e) => setDraft({ ...draft, priceRm: e.target.value })} />
            </div>
            <div>
              <label style={label}>
                Where this number came from — keep it, it&rsquo;s the only record of how the
                figure was worked out
              </label>
              <textarea
                style={{ ...input, minHeight: 80, fontFamily: 'var(--font-sans)' }}
                value={draft.note}
                placeholder="SO drift 2026-08-13: server 1980 − L(LHF) 990 − STOOL 0"
                onChange={(e) => setDraft({ ...draft, note: e.target.value })}
              />
            </div>
            {saveError && (
              <div style={{ color: 'var(--c-burnt, #A6471E)', fontSize: 'var(--fs-13)' }}>{saveError}</div>
            )}
            <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
              <Button variant="secondary" onClick={() => setDraft(null)}>Cancel</Button>
              <Button onClick={() => void onSave()} disabled={save.isPending}>
                {save.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{ position: 'fixed', inset: 0, background: 'rgba(34,31,32,0.35)', display: 'grid', placeItems: 'center', zIndex: 50, padding: 'var(--space-4)' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--bg-surface, #fff)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-5)', width: 'min(560px, 100%)', maxHeight: '90vh', overflowY: 'auto' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
          <h3 style={{ margin: 0, fontSize: 'var(--fs-18)', fontFamily: 'var(--font-title)' }}>{title}</h3>
          <button type="button" aria-label="Close" onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-muted)' }}>
            <X {...ICON} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
