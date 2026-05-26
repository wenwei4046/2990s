// ----------------------------------------------------------------------------
// Fabric Converter — minimal master view (renamed from Fabric Tracking 2026-05-26).
//
// 5 columns: Fabric Code · Description (editable) · Supplier Code (editable) ·
// Sofa Tier · Bedframe Tier · (delete). Tiers cycle PRICE_1 → 2 → 3 on click.
//
// Commander 2026-05-26 history:
//   • Drop "All Categories" dropdown
//   • Rename from "Fabric Tracking" to "Fabric Converter"
//   • Description must be editable
//   • PR #43 — add "+ New Fabric" + per-row delete (was missing!)
//
// The table is shared with Products → Maintenance → Fabrics via
// components/FabricsTable.tsx — changes here reflect there automatically.
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Search, Plus, X } from 'lucide-react';
import { Button } from '@2990s/design-system';
import {
  useFabricTrackings,
  useCreateFabric,
  type FabricCategoryValue,
  type FabricTier,
} from '../lib/fabric-queries';
import { FabricsTable } from '../components/FabricsTable';
import styles from './FabricTracking.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

const CATEGORIES: { value: FabricCategoryValue; label: string }[] = [
  { value: 'B.M-FABR', label: 'B.M-FABR · Bedframe Main' },
  { value: 'S-FABR',   label: 'S-FABR · Secondary' },
  { value: 'S.M-FABR', label: 'S.M-FABR · Sofa Main' },
  { value: 'LINING',   label: 'LINING' },
  { value: 'WEBBING',  label: 'WEBBING' },
];

export const FabricTracking = () => {
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);

  const { data: fabrics, isLoading, error } = useFabricTrackings({
    search: search.trim() || undefined,
  });

  const rows = useMemo(() => fabrics ?? [], [fabrics]);

  return (
    <div className={styles.page}>
      <div className={styles.titleBlock}>
        <h1 className={styles.title}>Fabric Converter</h1>
        <p className={styles.subtitle}>
          Fabric master — drives sofa + bedframe pricing tier and the supplier code printed on POs.
          Click Description / Supplier Code to edit. Same data shows in Products → Maintenance → Fabrics.
        </p>
      </div>

      <div className={styles.filterRow}>
        <div className={styles.searchBox}>
          <Search size={16} strokeWidth={1.75} className={styles.searchIcon} />
          <input
            type="search"
            className={styles.searchInput}
            placeholder="Search by code or description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button variant="primary" size="md" onClick={() => setCreating(true)}>
          <Plus {...ICON} />
          <span>New Fabric</span>
        </Button>
      </div>

      <FabricsTable rows={rows} isLoading={isLoading} error={error} />

      {creating && <NewFabricDialog onClose={() => setCreating(false)} />}
    </div>
  );
};

const NewFabricDialog = ({ onClose }: { onClose: () => void }) => {
  const create = useCreateFabric();
  const [form, setForm] = useState({
    fabricCode: '',
    fabricDescription: '',
    fabricCategory: '' as FabricCategoryValue | '',
    supplierCode: '',
    sofaPriceTier: 'PRICE_2' as FabricTier,
    bedframePriceTier: 'PRICE_2' as FabricTier,
  });

  const set = <K extends keyof typeof form>(k: K, v: typeof form[K]) =>
    setForm((s) => ({ ...s, [k]: v }));

  const submit = () => {
    if (!form.fabricCode.trim()) {
      alert('Fabric Code is required.');
      return;
    }
    create.mutate({
      fabricCode: form.fabricCode.trim(),
      fabricDescription: form.fabricDescription.trim() || undefined,
      fabricCategory: form.fabricCategory || undefined,
      supplierCode: form.supplierCode.trim() || undefined,
      sofaPriceTier: form.sofaPriceTier,
      bedframePriceTier: form.bedframePriceTier,
    }, {
      onSuccess: onClose,
      onError: (e) => alert(`Create failed: ${e instanceof Error ? e.message : String(e)}`),
    });
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 50,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{
          width: 520, maxWidth: '95vw', background: 'var(--c-cream)',
          padding: 'var(--space-5)', borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-3)',
        }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className={styles.title} style={{ fontSize: 'var(--fs-22)' }}>New Fabric</h2>
          <button type="button" className={styles.searchInput} style={{ width: 32, height: 32, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }} onClick={onClose}>
            <X {...ICON} />
          </button>
        </div>

        <p className={styles.subtitle} style={{ marginTop: 4, marginBottom: 'var(--space-3)' }}>
          Will appear immediately in both Fabric Converter + Products → Maintenance → Fabrics.
        </p>

        <label style={{ display: 'block', marginBottom: 'var(--space-3)' }}>
          <div style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', marginBottom: 4 }}>Fabric Code *</div>
          <input className={styles.searchInput} style={{ width: '100%' }}
            value={form.fabricCode} placeholder="AVANI 09 / AH-2 / NEW-FABRIC-001"
            autoFocus
            onChange={(e) => set('fabricCode', e.target.value)} />
        </label>

        <label style={{ display: 'block', marginBottom: 'var(--space-3)' }}>
          <div style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', marginBottom: 4 }}>Description</div>
          <input className={styles.searchInput} style={{ width: '100%' }}
            value={form.fabricDescription} placeholder="e.g. IVORY / FABRIC"
            onChange={(e) => set('fabricDescription', e.target.value)} />
        </label>

        <label style={{ display: 'block', marginBottom: 'var(--space-3)' }}>
          <div style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', marginBottom: 4 }}>Category</div>
          <select className={styles.searchInput} style={{ width: '100%' }}
            value={form.fabricCategory}
            onChange={(e) => set('fabricCategory', e.target.value as FabricCategoryValue | '')}>
            <option value="">— (none) —</option>
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>

        <label style={{ display: 'block', marginBottom: 'var(--space-3)' }}>
          <div style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', marginBottom: 4 }}>Supplier Code (their SKU)</div>
          <input className={styles.searchInput} style={{ width: '100%' }}
            value={form.supplierCode} placeholder="Optional — supplier's own code"
            onChange={(e) => set('supplierCode', e.target.value)} />
        </label>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
          <label>
            <div style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', marginBottom: 4 }}>Sofa Tier</div>
            <select className={styles.searchInput} style={{ width: '100%' }}
              value={form.sofaPriceTier}
              onChange={(e) => set('sofaPriceTier', e.target.value as FabricTier)}>
              <option value="PRICE_1">Price 1</option>
              <option value="PRICE_2">Price 2</option>
              <option value="PRICE_3">Price 3</option>
            </select>
          </label>
          <label>
            <div style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', marginBottom: 4 }}>Bedframe Tier</div>
            <select className={styles.searchInput} style={{ width: '100%' }}
              value={form.bedframePriceTier}
              onChange={(e) => set('bedframePriceTier', e.target.value as FabricTier)}>
              <option value="PRICE_1">Price 1</option>
              <option value="PRICE_2">Price 2</option>
              <option value="PRICE_3">Price 3</option>
            </select>
          </label>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', marginTop: 'var(--space-5)' }}>
          <Button variant="ghost" size="md" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="md" onClick={submit} disabled={create.isPending}>
            {create.isPending ? 'Saving…' : 'Create Fabric'}
          </Button>
        </div>
      </div>
    </div>
  );
};
