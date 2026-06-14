import { useEffect, useState } from 'react';
import { Navigate } from 'react-router';
import { Plus, Trash2 } from 'lucide-react';
import {
  useHrProfiles, useCreateHrProfile, useUpdateHrProfile, useDeleteHrProfile,
  useHrConfig, useUpdateHrConfig,
  useHrItemKpi, useCreateHrItemKpi, useDeleteHrItemKpi,
  useHrPickers, type HrPickerRef,
} from '../lib/hr-queries';
import { useAuth, isAdminLevel } from '../lib/auth';
import styles from './Hr.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

// editable %-rate field (stored as bps). Mounts only once config is loaded.
const RateField = ({ label, bps, onSave }: { label: string; bps: number; onSave: (bps: number) => void }) => {
  const [v, setV] = useState((bps / 100).toString());
  // resync when the server value changes (e.g. after save/refetch or a concurrent edit)
  useEffect(() => setV((bps / 100).toString()), [bps]);
  return (
    <div className={styles.field}>
      <span className={styles.label}>{label}</span>
      <input
        className={styles.input}
        type="number"
        step="0.1"
        min={0}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => onSave(Math.round(Number(v) * 100))}
      />
    </div>
  );
};

// editable RM-threshold field (stored as centi)
const CentiField = ({ label, centi, onSave }: { label: string; centi: number; onSave: (centi: number) => void }) => {
  const [v, setV] = useState((centi / 100).toString());
  useEffect(() => setV((centi / 100).toString()), [centi]);
  return (
    <div className={styles.field}>
      <span className={styles.label}>{label}</span>
      <input
        className={styles.input}
        type="number"
        min={0}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => onSave(Math.round(Number(v) * 100))}
      />
    </div>
  );
};

/* HR rate/profile editing is admin + super_admin only. sales_director gets the
   HR Commission view (read-only) but is bounced from the settings editor — the
   API rejects its mutations with 403 anyway (2026-06-15). */
export const HrSettings = () => {
  const { staff } = useAuth();
  if (staff && !isAdminLevel(staff.role)) return <Navigate to="/hr/commission" replace />;
  return <HrSettingsInner />;
};

const HrSettingsInner = () => {
  const profiles = useHrProfiles();
  const pickers = useHrPickers();
  const createProfile = useCreateHrProfile();
  const updateProfile = useUpdateHrProfile();
  const deleteProfile = useDeleteHrProfile();

  const config = useHrConfig();
  const updateConfig = useUpdateHrConfig();

  const itemKpi = useHrItemKpi();
  const createItemKpi = useCreateHrItemKpi();
  const deleteItemKpi = useDeleteHrItemKpi();

  const [newStaff, setNewStaff] = useState('');
  const [newTier, setNewTier] = useState<'sales' | 'manager'>('sales');
  const [newShowroom, setNewShowroom] = useState('');

  const [flagType, setFlagType] = useState<'product' | 'fabric' | 'special'>('product');
  const [flagRef, setFlagRef] = useState('');
  const [flagBonusRM, setFlagBonusRM] = useState('');

  const refList: HrPickerRef[] =
    flagType === 'product' ? pickers.data?.products ?? []
    : flagType === 'fabric' ? pickers.data?.fabrics ?? []
    : pickers.data?.specials ?? [];

  const cfg = config.data?.config;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>HR Settings</h1>

      {/* 1 · Salespeople */}
      <div className={styles.card}>
        <div className={styles.showroomHead}><span className={styles.showroomName}>Salespeople</span></div>
        <table className={styles.table}>
          <thead><tr><th>Name</th><th>Tier</th><th>Showroom</th><th>Active</th><th></th></tr></thead>
          <tbody>
            {(profiles.data?.profiles ?? []).map((p) => (
              <tr key={p.id}>
                <td>{p.staffName} <span className={styles.subtle}>{p.staffCode}</span></td>
                <td>
                  <select className={styles.input} value={p.tier}
                    onChange={(e) => updateProfile.mutate({ id: p.id, tier: e.target.value })}>
                    <option value="sales">sales</option>
                    <option value="manager">manager</option>
                  </select>
                </td>
                <td>
                  <select className={styles.input} value={p.showroomId}
                    onChange={(e) => updateProfile.mutate({ id: p.id, showroomId: e.target.value })}>
                    {(pickers.data?.showrooms ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </td>
                <td>
                  <input className={styles.checkbox} type="checkbox" checked={p.active}
                    onChange={(e) => updateProfile.mutate({ id: p.id, active: e.target.checked })} />
                </td>
                <td>
                  <button className={styles.iconBtn} onClick={() => deleteProfile.mutate(p.id)} aria-label="Remove salesperson">
                    <Trash2 {...ICON} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className={`${styles.toolbar} ${styles.panelBody}`}>
          <div className={styles.field}>
            <span className={styles.label}>Staff</span>
            <select className={styles.input} value={newStaff} onChange={(e) => setNewStaff(e.target.value)}>
              <option value="">Select…</option>
              {(pickers.data?.staff ?? []).map((s) => <option key={s.id} value={s.id}>{s.name} ({s.role})</option>)}
            </select>
          </div>
          <div className={styles.field}>
            <span className={styles.label}>Tier</span>
            <select className={styles.input} value={newTier} onChange={(e) => setNewTier(e.target.value as 'sales' | 'manager')}>
              <option value="sales">sales</option><option value="manager">manager</option>
            </select>
          </div>
          <div className={styles.field}>
            <span className={styles.label}>Showroom</span>
            <select className={styles.input} value={newShowroom} onChange={(e) => setNewShowroom(e.target.value)}>
              <option value="">Select…</option>
              {(pickers.data?.showrooms ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <button className={`${styles.btn} ${styles.btnPrimary}`} disabled={!newStaff || !newShowroom}
            onClick={() => {
              createProfile.mutate({ staffId: newStaff, tier: newTier, showroomId: newShowroom });
              setNewStaff(''); setNewShowroom('');
            }}>
            <Plus {...ICON} /> Add
          </button>
        </div>
      </div>

      {/* 2 · Commission rates */}
      <div className={styles.card}>
        <div className={styles.showroomHead}><span className={styles.showroomName}>Commission rates</span></div>
        {cfg && (
          <div className={`${styles.toolbar} ${styles.panelBody}`}>
            <RateField label="Base %" bps={cfg.baseBps} onSave={(v) => updateConfig.mutate({ baseBps: v })} />
            <RateField label="Personal KPI +%" bps={cfg.personalKpiBonusBps} onSave={(v) => updateConfig.mutate({ personalKpiBonusBps: v })} />
            <CentiField label="Personal threshold RM" centi={cfg.personalKpiThresholdCenti} onSave={(v) => updateConfig.mutate({ personalKpiThresholdCenti: v })} />
            <RateField label="Showroom KPI +%" bps={cfg.showroomKpiBonusBps} onSave={(v) => updateConfig.mutate({ showroomKpiBonusBps: v })} />
            <CentiField label="Showroom threshold RM" centi={cfg.showroomKpiThresholdCenti} onSave={(v) => updateConfig.mutate({ showroomKpiThresholdCenti: v })} />
            <RateField label="Override base %" bps={cfg.overrideBaseBps} onSave={(v) => updateConfig.mutate({ overrideBaseBps: v })} />
            <RateField label="Override KPI +%" bps={cfg.overrideKpiBonusBps} onSave={(v) => updateConfig.mutate({ overrideKpiBonusBps: v })} />
          </div>
        )}
      </div>

      {/* 3 · Item KPIs */}
      <div className={styles.card}>
        <div className={styles.showroomHead}><span className={styles.showroomName}>Item KPIs</span></div>
        <table className={styles.table}>
          <thead><tr><th>Type</th><th>Item</th><th>Bonus / unit</th><th>Active</th><th></th></tr></thead>
          <tbody>
            {(itemKpi.data?.items ?? []).map((it) => (
              <tr key={it.id}>
                <td>{it.flagType}</td>
                <td>{it.label || it.ref}</td>
                <td className={styles.num}>RM {(it.bonusCenti / 100).toFixed(2)}</td>
                <td>{it.active ? 'Yes' : 'No'}</td>
                <td>
                  <button className={styles.iconBtn} onClick={() => deleteItemKpi.mutate(it.id)} aria-label="Remove item KPI">
                    <Trash2 {...ICON} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className={`${styles.toolbar} ${styles.panelBody}`}>
          <div className={styles.field}>
            <span className={styles.label}>Type</span>
            <select className={styles.input} value={flagType}
              onChange={(e) => { setFlagType(e.target.value as 'product' | 'fabric' | 'special'); setFlagRef(''); }}>
              <option value="product">product</option><option value="fabric">fabric</option><option value="special">special</option>
            </select>
          </div>
          <div className={styles.field}>
            <span className={styles.label}>Item</span>
            <select className={styles.input} value={flagRef} onChange={(e) => setFlagRef(e.target.value)}>
              <option value="">Select…</option>
              {refList.map((r) => <option key={r.ref} value={r.ref}>{r.label}</option>)}
            </select>
          </div>
          <div className={styles.field}>
            <span className={styles.label}>Bonus RM / unit</span>
            <input className={styles.input} type="number" min={0} value={flagBonusRM} onChange={(e) => setFlagBonusRM(e.target.value)} />
          </div>
          <button className={`${styles.btn} ${styles.btnPrimary}`} disabled={!flagRef || !(Number(flagBonusRM) > 0)}
            onClick={() => {
              const bonus = Number(flagBonusRM);
              if (!flagRef || !(bonus > 0)) return;
              const label = refList.find((r) => r.ref === flagRef)?.label ?? flagRef;
              createItemKpi.mutate({ flagType, ref: flagRef, label, bonusCenti: Math.round(bonus * 100) });
              setFlagRef(''); setFlagBonusRM('');
            }}>
            <Plus {...ICON} /> Add
          </button>
        </div>
      </div>
    </div>
  );
};
