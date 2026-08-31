// ----------------------------------------------------------------------------
// OPEX ▸ Setup ▸ Salespeople.
//
// THE REGISTER IS THE SCHEME. A person with no active row here earns nothing on
// the Commission tab — and, less obviously, their sales do not count toward
// their showroom's total either, because a showroom total is the sum of its
// REGISTERED members' product sales. So an unregistered top seller can hold a
// whole showroom under its target and quietly cut everyone else's rate.
//
// That is not a bug to route around; it is the rule the engine was signed off
// with (Loo 2026-06-14, "algorithm A"). The fix is always the same: register
// everyone who should earn. The warning below says so on screen.
//
// Level decides the override only:
//   Sales   — earns their own commission.
//   Manager — also earns the override, on their showroom (or, in reporting-chain
//             mode, on their downline).
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Plus, Trash2, UserRound } from 'lucide-react';
import {
  useCommissionProfiles, useCreateCommissionProfile,
  useDeleteCommissionProfile, useUpdateCommissionProfile, type HrTier,
} from '../../lib/commission-api';
import { useAllStaff } from '../../lib/staff';
import { useVenues } from '../../lib/so-maintenance/venues-queries';
import { hrErrorMessage } from '../../lib/hr-wire';
import styles from './Opex.module.css';

export const SetupSalespeople = ({ canManage }: { canManage: boolean }) => {
  const { data: profiles, isLoading, error } = useCommissionProfiles();
  /* ── ONE branch list, not two (Loo 2026-08-31) ─────────────────────────────
     The branch a salesperson earns under is the SAME list the order form's
     VENUE dropdown reads — `/venues`, maintained in SO Maintenance. It used to
     be 2990's separate `showrooms` table, and the two had already drifted into
     three names for one address: the commission screen said "Showroom KL", the
     order form said "2990s PJ", and 2990's own venue list said "PJ Showroom",
     all at 51 Jln Utara, PJS 12, Petaling Jaya.

     Keeping two lists means a new branch has to be added twice and will drift
     again, which is exactly what Loo asked to end ("确保和 venue 是一样的，
     因为以后会有其他分行"). Adding a branch in SO Maintenance now makes it
     assignable here, with no second step.

     ⚠️ WHAT THIS DOES NOT CHANGE: commission still groups by the branch a
     salesperson is ASSIGNED to, not by the venue stamped on each order. For
     someone who works one branch those are the same thing; for a floater they
     are not. Making the totals follow the order's venue is a different change
     to the engine. */
  const { data: venues, isLoading: showroomsLoading } = useVenues();
  const showrooms = venues;
  const { data: allStaff, isLoading: staffLoading } = useAllStaff();
  const pickersLoading = showroomsLoading || staffLoading;
  const create = useCreateCommissionProfile();
  const update = useUpdateCommissionProfile();
  const remove = useDeleteCommissionProfile();

  const [staffId, setStaffId] = useState('');
  const [tier, setTier] = useState<HrTier>('sales');
  const [showroomId, setShowroomId] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  const showroomName = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of showrooms ?? []) m.set(s.id, s.name);
    return m;
  }, [showrooms]);

  /* A profile written before the branch list moved holds an id from the old
     `showrooms` table, which no venue can match. Shown with its stored name and
     flagged rather than silently blanked — the person still earns, and the row
     is one re-pick away from being right. */
  const unmatched = (id: string) => !showroomsLoading && !showroomName.has(id);

  /* Somebody already on the scheme must not appear in the picker: the server
     answers a duplicate with a 409, and offering the choice at all is how you
     get there. */
  const registered = useMemo(
    () => new Set((profiles ?? []).map((p) => p.staffId)),
    [profiles],
  );
  const assignable = (allStaff ?? []).filter((s) => !registered.has(s.id));

  const add = async () => {
    setAddError(null);
    if (!staffId) { setAddError('Pick the salesperson to add.'); return; }
    if (!showroomId) { setAddError('Pick the branch they earn under.'); return; }
    try {
      /* The names are SNAPSHOTTED on write. There is nothing to join to — the
         staff row is in Houzs and the profile is here — and a payroll record
         should keep saying what it said when it was approved. */
      await create.mutateAsync({
        staffId,
        staffName: assignable.find((s) => s.id === staffId)?.name ?? '',
        staffCode: '',
        tier,
        showroomId,
        showroomName: showroomName.get(showroomId) ?? '',
      });
      setStaffId('');
    } catch (e) {
      setAddError(hrErrorMessage(e));
    }
  };

  if (isLoading) return <p className={styles.muted}>Loading…</p>;
  if (error) return <p className={styles.error}>{hrErrorMessage(error)}</p>;

  const rows = profiles ?? [];
  const activeCount = rows.filter((r) => r.active).length;

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>
          <UserRound size={16} strokeWidth={1.75} /> Salespeople on the scheme
        </h2>
        <span className={styles.chip}>{activeCount} active</span>
      </div>
      <p className={styles.cardHint}>
        Only the people listed here earn commission, and only their sales count toward a
        branch&rsquo;s target. Add everyone who should earn before reading a period. The branch
        list is the same one the order form&rsquo;s <strong>Venue</strong> dropdown reads — add a
        new branch in SO Maintenance and it appears here.
      </p>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Salesperson</th>
              <th>Level</th>
              <th>Branch (venue)</th>
              <th>Status</th>
              {canManage && <th />}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className={p.active ? undefined : styles.rowMuted}>
                <td>
                  {p.staffName || <span className={styles.code}>{p.staffId}</span>}
                  {p.staffCode ? <> <span className={styles.code}>{p.staffCode}</span></> : null}
                </td>
                <td>
                  {canManage ? (
                    <select
                      value={p.tier}
                      disabled={update.isPending}
                      onChange={(e) => void update.mutateAsync({ id: p.id, tier: e.target.value as HrTier })}
                    >
                      <option value="sales">Sales</option>
                      <option value="manager">Manager</option>
                    </select>
                  ) : (
                    p.tier === 'manager' ? 'Manager' : 'Sales'
                  )}
                </td>
                <td>
                  {canManage ? (
                    <select
                      value={showroomName.has(p.showroomId) ? p.showroomId : ''}
                      disabled={update.isPending || showroomsLoading}
                      onChange={(e) => void update.mutateAsync({
                        id: p.id,
                        showroomId: e.target.value,
                        showroomName: showroomName.get(e.target.value) ?? '',
                      })}
                    >
                      {unmatched(p.showroomId) && (
                        <option value="">{p.showroomName || 'Not in the venue list'} — re-pick</option>
                      )}
                      {(showrooms ?? []).map((v) => (
                        <option key={v.id} value={v.id}>{v.name}</option>
                      ))}
                    </select>
                  ) : (
                    showroomName.get(p.showroomId) || p.showroomName
                      || <span className={styles.code}>{p.showroomId}</span>
                  )}
                  {unmatched(p.showroomId) && (
                    <> <span className={styles.chip}>not in the venue list</span></>
                  )}
                </td>
                <td>
                  <span className={`${styles.chip} ${p.active ? styles.chipHit : styles.chipOff}`}>
                    {p.active ? 'Active' : 'Off'}
                  </span>
                </td>
                {canManage && (
                  <td className={styles.num}>
                    <div className={styles.actions}>
                      <button
                        type="button" className={styles.btn}
                        disabled={update.isPending}
                        onClick={() => void update.mutateAsync({ id: p.id, active: !p.active })}
                      >
                        {p.active ? 'Turn off' : 'Turn on'}
                      </button>
                      <button
                        type="button" className={styles.iconBtn}
                        aria-label={`Remove ${p.staffName || p.staffId}`}
                        disabled={remove.isPending}
                        onClick={() => {
                          if (window.confirm(
                            `Remove ${p.staffName || 'this person'} from the commission scheme?\n\nThey stop earning, and their sales stop counting toward the showroom target. Turning them off instead keeps the record.`,
                          )) void remove.mutateAsync(p.id);
                        }}
                      >
                        <Trash2 size={16} strokeWidth={1.75} />
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr className={styles.rowMuted}>
                <td colSpan={canManage ? 5 : 4}>
                  — Nobody is on the scheme, so the Commission tab will be empty.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {canManage && (
        <>
          {addError && <p className={styles.error}>{addError}</p>}
          <div className={styles.fieldGrid}>
            <label className={styles.field}>
              <span className={styles.label}>Salesperson</span>
              <select
                value={staffId} disabled={pickersLoading}
                onChange={(e) => setStaffId(e.target.value)}
              >
                <option value="">{pickersLoading ? 'Loading…' : '— select —'}</option>
                {assignable.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Level</span>
              <select value={tier} onChange={(e) => setTier(e.target.value as HrTier)}>
                <option value="sales">Sales</option>
                <option value="manager">Manager — also earns the override</option>
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Branch (venue)</span>
              <select
                value={showroomId} disabled={pickersLoading}
                onChange={(e) => setShowroomId(e.target.value)}
              >
                <option value="">{pickersLoading ? 'Loading…' : '— select —'}</option>
                {(showrooms ?? []).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
            <div className={styles.field}>
              <span className={styles.label}>&nbsp;</span>
              <div className={styles.actions}>
                <button
                  type="button" className={styles.btn}
                  disabled={create.isPending} onClick={() => void add()}
                >
                  <Plus size={16} strokeWidth={1.75} /> Add salesperson
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
