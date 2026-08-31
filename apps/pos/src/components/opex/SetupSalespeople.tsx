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
  useCreateHrProfile, useDeleteHrProfile, useHrPickers, useHrProfiles, useUpdateHrProfile,
  type HrTier,
} from '../../lib/hr-commission-queries';
import { hrErrorMessage } from '../../lib/hr-wire';
import styles from './Opex.module.css';

export const SetupSalespeople = ({ canManage }: { canManage: boolean }) => {
  const { data: profiles, isLoading, error } = useHrProfiles();
  // Always fetched — the showroom NAME column needs it even for a read-only viewer.
  const { data: pickers, isLoading: pickersLoading } = useHrPickers();
  const create = useCreateHrProfile();
  const update = useUpdateHrProfile();
  const remove = useDeleteHrProfile();

  const [staffId, setStaffId] = useState('');
  const [tier, setTier] = useState<HrTier>('sales');
  const [showroomId, setShowroomId] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  const showroomName = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of pickers?.showrooms ?? []) m.set(s.id, s.name);
    return m;
  }, [pickers]);

  /* Somebody already on the scheme must not appear in the picker: the server
     answers a duplicate with a 409, and offering the choice at all is how you
     get there. */
  const registered = useMemo(
    () => new Set((profiles ?? []).map((p) => p.staffId)),
    [profiles],
  );
  const assignable = (pickers?.staff ?? []).filter((s) => !registered.has(s.id));

  const add = async () => {
    setAddError(null);
    if (!staffId) { setAddError('Pick the salesperson to add.'); return; }
    if (!showroomId) { setAddError('Pick the showroom they earn under.'); return; }
    try {
      await create.mutateAsync({ staffId, tier, showroomId });
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
        showroom&rsquo;s target. Add everyone who should earn before reading a period.
      </p>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Salesperson</th>
              <th>Level</th>
              <th>Showroom</th>
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
                <td>{showroomName.get(p.showroomId) ?? <span className={styles.code}>{p.showroomId}</span>}</td>
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
                  <option key={s.id} value={s.id}>
                    {s.name}{s.staffCode ? ` · ${s.staffCode}` : ''}
                  </option>
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
              <span className={styles.label}>Showroom</span>
              <select
                value={showroomId} disabled={pickersLoading}
                onChange={(e) => setShowroomId(e.target.value)}
              >
                <option value="">{pickersLoading ? 'Loading…' : '— select —'}</option>
                {(pickers?.showrooms ?? []).map((s) => (
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
