import { useMemo } from 'react';
import { useFabricLibrary, useFabricColours, useUpdateFabricLibraryTier, type FabricLibraryRow } from '../../lib/queries';
import { useFabricSeriesNames } from '../../lib/fabric-series-queries';
import { groupFabricPricingSeries } from '../../lib/fabric-series-groups';

type TierField = 'sofaTier' | 'bedframeTier';
type Tier = 'PRICE_1' | 'PRICE_2' | 'PRICE_3';
const NEXT: Record<string, Tier> = { PRICE_1: 'PRICE_2', PRICE_2: 'PRICE_3', PRICE_3: 'PRICE_1' };

// Display groups keep every original selling-library ID. Grouping never changes
// a price; an explicit tier click updates all members through the existing API.
export function FabricSeriesTierTable({ canEdit }: { canEdit: boolean }) {
  const fabrics = useFabricLibrary();
  const colours = useFabricColours();
  const names = useFabricSeriesNames();
  const updateTier = useUpdateFabricLibraryTier();
  const groups = useMemo(
    () => groupFabricPricingSeries(fabrics.data ?? [], colours.data ?? [], names.data ?? []),
    [fabrics.data, colours.data, names.data],
  );
  const loading = fabrics.isLoading || colours.isLoading || names.isLoading;
  const loadError = fabrics.error || colours.error || names.error;

  const tierButton = (group: { label: string; fabrics: FabricLibraryRow[] }, field: TierField) => {
    const tiers = new Set(group.fabrics.map((f) => f[field] ?? 'PRICE_1'));
    const tier = tiers.size === 1 ? [...tiers][0]! : null;
    const label = tier ? `Price ${tier.replace('PRICE_', '')}` : 'Mixed';
    const next = tier ? NEXT[tier] ?? 'PRICE_1' : 'PRICE_1';
    const context = field === 'sofaTier' ? 'Sofa' : 'Bedframe';
    return (
      <button
        type="button"
        disabled={!canEdit || updateTier.isPending || !!loadError}
        aria-label={`${group.label} ${context.toLowerCase()} tier: ${label}`}
        title={canEdit ? `Set all fabrics in this series to Price ${next.replace('PRICE_', '')}` : undefined}
        onClick={() => updateTier.mutate({ ids: group.fabrics.map((f) => f.id), field, tier: next })}
        style={{
          padding: '4px 10px', fontSize: 'var(--fs-13)', borderRadius: 'var(--radius-md)',
          border: '1px solid var(--line)', cursor: canEdit ? 'pointer' : 'default',
          background: tier !== 'PRICE_1' ? 'var(--c-cream)' : 'transparent',
          fontWeight: tier !== 'PRICE_1' ? 600 : 400,
        }}
      >{label}</button>
    );
  };

  return (
    <>
      <h3 style={{ fontSize: 'var(--fs-15)', fontWeight: 600, margin: 'var(--space-6) 0 var(--space-1)' }}>Fabric tiers</h3>
      <p style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', marginBottom: 'var(--space-3)' }}>
        {canEdit
          ? 'Click a tier to cycle Price 1 → 2 → 3 for the whole series. Sofa and bedframe are independent. Mixed means the fabrics have different tiers; click to set Price 1.'
          : 'Read-only — only Master Admin can change fabric tiers.'}
      </p>
      {(loadError || updateTier.isError) && (
        <div role="alert" style={{ color: 'var(--c-burnt, #A6471E)', fontSize: 'var(--fs-13)', marginBottom: 'var(--space-3)' }}>
          {loadError
            ? `Could not load fabric series: ${String((loadError as Error).message ?? loadError)}`
            : `Tier change failed: ${String((updateTier.error as Error)?.message ?? updateTier.error)}`}
        </div>
      )}
      {loading ? (
        <div style={{ color: 'var(--fg-muted)' }}>Loading fabrics…</div>
      ) : loadError ? null : groups.length === 0 ? (
        <div style={{ color: 'var(--fg-muted)' }}>No fabrics yet — add them in the Backend Fabric Converter.</div>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 560 }}>
          <thead>
            <tr style={{ textAlign: 'left', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
              <th style={{ padding: '6px 8px' }}>Series</th>
              <th style={{ padding: '6px 8px' }}>Sofa tier</th>
              <th style={{ padding: '6px 8px' }}>Bedframe tier</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <tr key={group.id} style={{ borderTop: '1px solid var(--line)' }}>
                <td style={{ padding: '6px 8px', fontSize: 'var(--fs-14)' }}>
                  {group.label}
                  {group.shared && <div style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Shared tier</div>}
                </td>
                <td style={{ padding: '6px 8px' }}>{tierButton(group, 'sofaTier')}</td>
                <td style={{ padding: '6px 8px' }}>{tierButton(group, 'bedframeTier')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
