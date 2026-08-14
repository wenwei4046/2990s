// ----------------------------------------------------------------------------
// CampaignPromosTab — admin surface for fixed-value marketing vouchers
// ("RM 500 Home Voucher"), migration 0212. Tab 9 of Products.
//
// WHY THIS IS NOT PART OF "PWP & Promo": every other promo in this system is a
// SWAP (reprice a line to pwp_price_sen) or a FREEBIE (reprice to 0). None
// carries a money value. A voucher is a flat deduction spread proportionally
// across the order's lines, so it shares no data model and no rules with PWP.
//
// Money is entered and displayed in RM; the API speaks sen (`valueCenti`). The
// conversion lives here and nowhere else — see rmToCenti / centiToRm.
// ----------------------------------------------------------------------------

import { useState } from 'react';
import { Plus, Pencil, X, Receipt, Undo2 } from 'lucide-react';
import { Button } from '@2990s/design-system';
import {
  useCampaignPromos,
  useCreateCampaignPromo,
  useUpdateCampaignPromo,
  useCampaignRedemptions,
  useReleaseCampaignPromo,
  type CampaignPromo,
  type CampaignRedemption,
  type CampaignPromoInput,
} from '../../lib/products/campaign-promo-queries';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

const centiToRm = (c: number): string => (c / 100).toFixed(2);
/** RM string → sen. Rounds, so "500.005" cannot smuggle a fractional sen in. */
const rmToCenti = (rm: string): number => Math.round(Number(rm || 0) * 100);

const DEFAULT_TERMS = `1. You may apply this voucher as a deduction to an existing order or new order.
2. This voucher is eligible for all 2990's products.
3. The voucher is not redeemable for cash and cannot be refunded.
4. 2990's is not liable for any damages incurred during the purchase, redemption, or use of the voucher, loss of the voucher, or unauthorized use by individuals not approved by you.
5. 2990's reserves the right to modify, change, amend, terminate, or cancel these terms and conditions at its sole discretion without prior notice.`;

interface Draft extends CampaignPromoInput {
  id?: string;
  /** Kept as the raw input string so a half-typed "50." doesn't snap to 0. */
  valueRm: string;
}

const emptyDraft = (): Draft => ({
  name: '',
  valueRm: '',
  valueCenti: 0,
  stockTotal: 0,
  minPurchaseQty: 0,
  maxPerOrder: 1,
  terms: DEFAULT_TERMS,
  active: false,
});

const toDraft = (c: CampaignPromo): Draft => ({
  id: c.id,
  name: c.name,
  valueRm: centiToRm(c.valueCenti),
  valueCenti: c.valueCenti,
  stockTotal: c.stockTotal,
  minPurchaseQty: c.minPurchaseQty,
  maxPerOrder: c.maxPerOrder,
  terms: c.terms,
  active: c.active,
});

const label: React.CSSProperties = {
  display: 'block',
  fontSize: 'var(--fs-12)',
  color: 'var(--fg-muted)',
  marginBottom: 4,
};
const input: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid var(--line-strong)',
  borderRadius: 'var(--radius-sm)',
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--fs-14)',
};

export function CampaignPromosTab({ canEdit }: { canEdit: boolean }) {
  const { data: campaigns = [], isLoading, error } = useCampaignPromos();
  const create = useCreateCampaignPromo();
  const update = useUpdateCampaignPromo();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [ledgerFor, setLedgerFor] = useState<CampaignPromo | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const onSave = async () => {
    if (!draft) return;
    setSaveError(null);
    const payload: CampaignPromoInput = {
      name: draft.name.trim(),
      valueCenti: rmToCenti(draft.valueRm),
      stockTotal: Math.max(0, Math.floor(draft.stockTotal)),
      minPurchaseQty: Math.max(0, Math.floor(draft.minPurchaseQty)),
      maxPerOrder: Math.max(1, Math.floor(draft.maxPerOrder)),
      terms: draft.terms,
      active: draft.active,
    };
    if (!payload.name || payload.valueCenti <= 0) {
      setSaveError('A name and a value above RM 0 are required.');
      return;
    }
    try {
      if (draft.id) await update.mutateAsync({ id: draft.id, patch: payload });
      else await create.mutateAsync(payload);
      setDraft(null);
    } catch (e) {
      // The API returns actionable codes — surface them rather than "failed".
      // stock_below_used means someone tried to cut stock under what has
      // already gone out; the ledger is append-only, so that is a refusal.
      const msg = e instanceof Error ? e.message : 'save_failed';
      setSaveError(
        msg.startsWith('stock_below_used')
          ? 'Cannot reduce stock below the number already redeemed. Raise it instead, or leave it as is.'
          : msg,
      );
    }
  };

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
        <h3 style={{ fontSize: 'var(--fs-13)', fontWeight: 600, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', margin: 0 }}>
          Campaign Promos
        </h3>
        {canEdit && (
          <Button variant="secondary" onClick={() => { setSaveError(null); setDraft(emptyDraft()); }}>
            <Plus {...ICON} /> New voucher
          </Button>
        )}
      </div>

      <p style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-soft)', marginTop: 0, marginBottom: 'var(--space-4)' }}>
        A fixed-value voucher the salesperson can apply to any order. The amount is spread across
        the order&rsquo;s items in proportion to their price. Stock counts down as vouchers are used.
        Cancelling an order does <strong>not</strong> put its voucher back &mdash; open Redemptions
        and release that row by hand. Replenish by raising the stock number.
      </p>

      {isLoading && <div style={{ color: 'var(--fg-muted)' }}>Loading…</div>}
      {error && (
        <div style={{ color: 'var(--c-burnt, #A6471E)', marginBottom: 'var(--space-3)' }}>
          Couldn&rsquo;t load campaigns: {String((error as Error).message)}
        </div>
      )}

      {!isLoading && campaigns.length === 0 && (
        <div style={{ padding: 'var(--space-5)', textAlign: 'center', color: 'var(--fg-muted)', border: '1px dashed var(--line-strong)', borderRadius: 'var(--radius-md)' }}>
          No campaign promos yet.{canEdit ? ' Click "New voucher" to create one.' : ''}
        </div>
      )}

      {campaigns.map((c) => (
        <div
          key={c.id}
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: 'var(--space-3)', border: '1px solid var(--line)',
            borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-2)',
            opacity: c.active ? 1 : 0.55,
          }}
        >
          <div>
            <div style={{ fontWeight: 600 }}>
              {c.name}
              {c.active ? '' : ' · inactive'}
              {c.remaining === 0 && c.stockTotal > 0 && (
                <span style={{ marginLeft: 8, fontSize: 'var(--fs-12)', color: 'var(--c-burnt, #A6471E)' }}>
                  fully redeemed
                </span>
              )}
            </div>
            <div style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
              RM {centiToRm(c.valueCenti)} · {c.remaining} of {c.stockTotal} left
              {c.minPurchaseQty > 0 && ` · min ${c.minPurchaseQty} item(s)`}
              {' · one per order'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <Button variant="secondary" onClick={() => setLedgerFor(c)}>
              <Receipt {...ICON} /> Redemptions
            </Button>
            {canEdit && (
              <Button variant="secondary" onClick={() => { setSaveError(null); setDraft(toDraft(c)); }}>
                <Pencil {...ICON} /> Edit
              </Button>
            )}
          </div>
        </div>
      ))}

      {draft && (
        <Modal title={draft.id ? 'Edit voucher' : 'New voucher'} onClose={() => setDraft(null)}>
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            <div>
              <label style={label}>Name (shown to the salesperson)</label>
              <input style={input} value={draft.name} placeholder="RM 500 Home Voucher"
                onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
              <div>
                <label style={label}>Value (RM)</label>
                <input style={input} inputMode="decimal" value={draft.valueRm} placeholder="500.00"
                  onChange={(e) => setDraft({ ...draft, valueRm: e.target.value })} />
              </div>
              <div>
                <label style={label}>Quantity available</label>
                <input style={input} inputMode="numeric" value={draft.stockTotal}
                  onChange={(e) => setDraft({ ...draft, stockTotal: Number(e.target.value || 0) })} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
              <div>
                <label style={label}>Minimum items in order</label>
                <input style={input} inputMode="numeric" value={draft.minPurchaseQty}
                  onChange={(e) => setDraft({ ...draft, minPurchaseQty: Number(e.target.value || 0) })} />
              </div>
              {/* Not an input. The cart holds ONE applied voucher (a single
                  AppliedVoucher, not a list), so a value above 1 was accepted
                  here, displayed in the list as "up to N per order", and then
                  silently ignored at handover. Showing the limit as fixed is
                  honest; the column stays in the schema for when multi-voucher
                  is actually built. */}
              <div>
                <label style={label}>Max vouchers per order</label>
                <div style={{ ...input, color: 'var(--fg-muted)', background: 'var(--bg-sunken, transparent)' }}>
                  1 — one voucher per order
                </div>
              </div>
            </div>
            <div>
              <label style={label}>
                Terms &amp; conditions — copied onto each redemption, so editing this never changes
                what a past customer agreed to
              </label>
              <textarea style={{ ...input, minHeight: 160, fontFamily: 'var(--font-sans)' }}
                value={draft.terms}
                onChange={(e) => setDraft({ ...draft, terms: e.target.value })} />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--fs-14)' }}>
              <input type="checkbox" checked={draft.active}
                onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
              Active — salespeople can apply this now
            </label>
            {saveError && (
              <div style={{ color: 'var(--c-burnt, #A6471E)', fontSize: 'var(--fs-13)' }}>{saveError}</div>
            )}
            <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
              <Button variant="secondary" onClick={() => setDraft(null)}>Cancel</Button>
              <Button onClick={() => void onSave()} disabled={create.isPending || update.isPending}>
                {create.isPending || update.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {ledgerFor && (
        <RedemptionLedger campaign={ledgerFor} canEdit={canEdit} onClose={() => setLedgerFor(null)} />
      )}
    </section>
  );
}

/* The ledger is the whole reason sales don't have to match customers by hand —
   every claim records the order number and the customer it went to.
   It is also the ONLY place a voucher can be put back: nothing returns stock
   automatically, because the order lives in Houzs and Houzs cannot reach this
   table. See useReleaseCampaignPromo for why that is structural, not a TODO. */
function RedemptionLedger({ campaign, canEdit, onClose }: {
  campaign: CampaignPromo; canEdit: boolean; onClose: () => void;
}) {
  const { data: rows = [], isLoading } = useCampaignRedemptions(campaign.id);
  return (
    <Modal title={`Redemptions — ${campaign.name}`} onClose={onClose}>
      {isLoading ? (
        <div style={{ color: 'var(--fg-muted)' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ color: 'var(--fg-muted)' }}>Not redeemed yet.</div>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--space-2)', maxHeight: 420, overflowY: 'auto' }}>
          {rows.map((r) => (
            <RedemptionRow key={r.id} row={r} canEdit={canEdit} />
          ))}
        </div>
      )}
    </Modal>
  );
}

/* One row, with its own confirm state so releasing one never arms another.
   Release moves real stock, so it is deliberately two clicks — the ledger is
   the audit trail and an accidental release writes a released_at into it. */
function RedemptionRow({ row: r, canEdit }: { row: CampaignRedemption; canEdit: boolean }) {
  const release = useReleaseCampaignPromo();
  const [arming, setArming] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const releasable = canEdit && r.status !== 'RELEASED';

  const onRelease = async () => {
    setErr(null);
    try {
      await release.mutateAsync({
        redemptionId: r.id,
        reason: `released by hand from the admin ledger (was ${r.status})`,
      });
      setArming(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'release_failed');
    }
  };

  return (
    <div style={{ padding: 'var(--space-2) var(--space-3)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', opacity: r.status === 'RELEASED' ? 0.55 : 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', alignItems: 'center' }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 'var(--fs-13)' }}>
            {r.so_doc_no ?? '(order not completed)'}
            {r.status !== 'APPLIED' && (
              <span style={{ marginLeft: 8, fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
                {r.status === 'RESERVED' ? 'reserved — order never landed' : 'released'}
              </span>
            )}
          </div>
          <div style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
            {r.customer_name ?? '—'}{r.customer_phone ? ` · ${r.customer_phone}` : ''}
            {r.redeemed_by_name ? ` · by ${r.redeemed_by_name}` : ''}
            {r.release_reason ? ` · ${r.release_reason}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>RM {centiToRm(r.applied_centi)}</span>
          {releasable && !arming && (
            <Button variant="ghost" onClick={() => setArming(true)}>
              <Undo2 {...ICON} /> Release
            </Button>
          )}
          {releasable && arming && (
            <>
              <Button variant="secondary" onClick={() => setArming(false)}>Cancel</Button>
              <Button onClick={() => void onRelease()} disabled={release.isPending}>
                {release.isPending ? 'Releasing…' : 'Confirm — put 1 back'}
              </Button>
            </>
          )}
        </div>
      </div>
      {arming && !err && (
        <div style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', marginTop: 6 }}>
          Returns one voucher to the pool. Do this only once the order really is cancelled in
          HouzsERP — nothing here can check that for you.
        </div>
      )}
      {err && (
        <div style={{ fontSize: 'var(--fs-12)', color: 'var(--c-burnt, #A6471E)', marginTop: 6 }}>{err}</div>
      )}
    </div>
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
        style={{ background: 'var(--bg-surface, #fff)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-5)', width: 'min(640px, 100%)', maxHeight: '90vh', overflowY: 'auto' }}
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
