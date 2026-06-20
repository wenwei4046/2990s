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
import { useConfirm } from '../components/ConfirmDialog';
import { fmtCenti } from '@2990s/shared';
import styles from './Hr.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

// editable %-rate field (stored as bps). Mounts only once config is loaded.
const RateField = ({ label, bps, editable, onSave }: { label: string; bps: number; editable: boolean; onSave: (bps: number) => void }) => {
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
        disabled={!editable}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => onSave(Math.round(Number(v) * 100))}
      />
    </div>
  );
};

// editable RM-threshold field (stored as centi)
const CentiField = ({ label, centi, editable, onSave }: { label: string; centi: number; editable: boolean; onSave: (centi: number) => void }) => {
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
        disabled={!editable}
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
  const askConfirm = useConfirm();
  /* Edit→Save (Commander 2026-06-15 — no 裸奔): tier / showroom / active and the
     commission rates used to auto-commit on change/blur. An explicit Edit mode
     now buffers every change; NOTHING persists until Save. Cancel discards. */
  type HrCfgDraft = {
    baseBps?: number; personalKpiBonusBps?: number; personalKpiThresholdCenti?: number;
    showroomKpiBonusBps?: number; showroomKpiThresholdCenti?: number;
    overrideBaseBps?: number; overrideKpiBonusBps?: number;
  };
  const [editMode, setEditMode] = useState(false);
  const [profileDraft, setProfileDraft] = useState<Record<string, { tier?: string; showroomId?: string; active?: boolean }>>({});
  const [cfgDraft, setCfgDraft] = useState<HrCfgDraft>({});
  const [saving, setSaving] = useState(false);
  const stageProfile = (id: string, patch: { tier?: string; showroomId?: string; active?: boolean }) =>
    setProfileDraft((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  const stageCfg = (key: keyof HrCfgDraft, val: number) => setCfgDraft((prev) => ({ ...prev, [key]: val }));
  const dirtyCount = Object.keys(profileDraft).length + Object.keys(cfgDraft).length;
  const saveEdits = async () => {
    setSaving(true);
    try {
      for (const [id, patch] of Object.entries(profileDraft)) await updateProfile.mutateAsync({ id, ...patch });
      if (Object.keys(cfgDraft).length) await updateConfig.mutateAsync(cfgDraft);
      setProfileDraft({}); setCfgDraft({}); setEditMode(false);
    } finally { setSaving(false); }
  };
  const cancelEdits = () => { setProfileDraft({}); setCfgDraft({}); setEditMode(false); };

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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 className={styles.title}>HR Settings</h1>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          {editMode ? (
            <>
              <button className={styles.btn} onClick={cancelEdits} disabled={saving}>Cancel</button>
              <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={saveEdits} disabled={saving || dirtyCount === 0}>
                {saving ? 'Saving…' : dirtyCount > 0 ? `Save (${dirtyCount})` : 'Save'}
              </button>
            </>
          ) : (
            <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => setEditMode(true)}>Edit</button>
          )}
        </div>
      </div>

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
                  <select className={styles.input} disabled={!editMode}
                    value={profileDraft[p.id]?.tier ?? p.tier}
                    onChange={(e) => stageProfile(p.id, { tier: e.target.value })}>
                    <option value="sales">sales</option>
                    <option value="manager">manager</option>
                  </select>
                </td>
                <td>
                  <select className={styles.input} disabled={!editMode}
                    value={profileDraft[p.id]?.showroomId ?? p.showroomId}
                    onChange={(e) => stageProfile(p.id, { showroomId: e.target.value })}>
                    {(pickers.data?.showrooms ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </td>
                <td>
                  <input className={styles.checkbox} type="checkbox" disabled={!editMode}
                    checked={profileDraft[p.id]?.active ?? p.active}
                    onChange={(e) => stageProfile(p.id, { active: e.target.checked })} />
                </td>
                <td>
                  <button className={styles.iconBtn} onClick={async () => { if (await askConfirm({ title: 'Remove this salesperson?', body: 'They will be removed from the commission list.', confirmLabel: 'Remove', danger: true })) deleteProfile.mutate(p.id); }} aria-label="Remove salesperson">
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
            <RateField label="Base %" editable={editMode} bps={cfgDraft.baseBps ?? cfg.baseBps} onSave={(v) => stageCfg('baseBps', v)} />
            <RateField label="Personal KPI +%" editable={editMode} bps={cfgDraft.personalKpiBonusBps ?? cfg.personalKpiBonusBps} onSave={(v) => stageCfg('personalKpiBonusBps', v)} />
            <CentiField label="Personal threshold RM" editable={editMode} centi={cfgDraft.personalKpiThresholdCenti ?? cfg.personalKpiThresholdCenti} onSave={(v) => stageCfg('personalKpiThresholdCenti', v)} />
            <RateField label="Showroom KPI +%" editable={editMode} bps={cfgDraft.showroomKpiBonusBps ?? cfg.showroomKpiBonusBps} onSave={(v) => stageCfg('showroomKpiBonusBps', v)} />
            <CentiField label="Showroom threshold RM" editable={editMode} centi={cfgDraft.showroomKpiThresholdCenti ?? cfg.showroomKpiThresholdCenti} onSave={(v) => stageCfg('showroomKpiThresholdCenti', v)} />
            <RateField label="Override base %" editable={editMode} bps={cfgDraft.overrideBaseBps ?? cfg.overrideBaseBps} onSave={(v) => stageCfg('overrideBaseBps', v)} />
            <RateField label="Override KPI +%" editable={editMode} bps={cfgDraft.overrideKpiBonusBps ?? cfg.overrideKpiBonusBps} onSave={(v) => stageCfg('overrideKpiBonusBps', v)} />
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
                <td className={styles.num}>{fmtCenti(it.bonusCenti)}</td>
                <td>{it.active ? 'Yes' : 'No'}</td>
                <td>
                  <button className={styles.iconBtn} onClick={async () => { if (await askConfirm({ title: 'Remove this item KPI?', confirmLabel: 'Remove', danger: true })) deleteItemKpi.mutate(it.id); }} aria-label="Remove item KPI">
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
