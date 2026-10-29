import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import styles from './FabricAllowedSection.module.css';

/* FABRICS section for the Modular drawer (Chairman 2026-06-01). On/off is per
   COLOUR (the single authority), grouped under its SERIES header. The chip text
   is the code + colour name (e.g. "CG-002 Sand"); the toggle value is the colour CODE
   (fabric_colours.colour_id, e.g. "CG-002") stored in allowed_options.fabrics. */
export const FabricAllowedSection = ({
  series,
  coloursBySeries,
  isLoading = false,
  error,
  isTicked,
  onToggle,
  onSetAll,
}: {
  series: { id: string; label: string }[];
  coloursBySeries: Map<string, { colourId: string; label: string }[]>;
  isLoading?: boolean;
  error?: unknown;
  isTicked: (code: string) => boolean;
  onToggle: (code: string) => void;
  onSetAll: (codes: string[], on: boolean) => void;
}) => {
  const withColours = series.filter((s) => (coloursBySeries.get(s.id) ?? []).length > 0);
  // Every series starts collapsed.
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const setOpenFor = (id: string, on: boolean) => setOpen((prev) => {
    const next = new Set(prev);
    if (on) next.add(id); else next.delete(id);
    return next;
  });
  // Per-series "All on / All off" — bulk-toggle just that series' colour codes.
  const bulkBtn = (codes: string[], label: string, on: boolean, after?: () => void) => (
    <button
      type="button"
      onClick={() => { onSetAll(codes, on); after?.(); }}
      style={{
        padding: '2px 10px', borderRadius: 999, border: '1px solid var(--line)',
        background: 'transparent', color: 'var(--c-ink)', cursor: 'pointer',
        fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-12)', fontWeight: 600,
      }}
    >{label}</button>
  );
  return (
    <div style={{ marginBottom: 'var(--space-4)' }}>
      <div style={{
        fontFamily: 'var(--font-button)', fontSize: 'var(--fs-12)', fontWeight: 600,
        letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--fg-muted)',
        marginBottom: 'var(--space-2)',
      }}>Fabrics</div>
      {isLoading ? (
        <div style={{ fontSize: 'var(--fs-13)', color: 'var(--fg-muted)' }}>Loading fabrics…</div>
      ) : error ? (
        <div role="alert" style={{ fontSize: 'var(--fs-13)', color: 'var(--c-burnt)' }}>
          Could not load fabric series: {error instanceof Error ? error.message : String(error)}
        </div>
      ) : withColours.length === 0 ? (
        <div style={{ fontSize: 'var(--fs-13)', color: 'var(--fg-muted)' }}>
          No fabrics yet — add them in the Backend Fabric Converter.
        </div>
      ) : withColours.map((s) => {
        const chips = coloursBySeries.get(s.id) ?? [];
        const codes = chips.map((c) => c.colourId);
        const isOpen = open.has(s.id);
        const panelId = `fabric-series-${s.id}`;
        return (
        <div key={s.id} style={{ marginBottom: 'var(--space-3)' }}>
          {/* Row click toggles. The button has no onClick; its clicks bubble here. */}
          <div className={styles.seriesRow} onClick={() => setOpenFor(s.id, !isOpen)}>
            <button
              type="button"
              aria-expanded={isOpen}
              aria-controls={panelId}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)',
                padding: 0, border: 'none', background: 'transparent', cursor: 'pointer',
                fontFamily: 'inherit', fontSize: 'var(--fs-12)', fontWeight: 600, color: 'var(--c-ink)',
              }}
            >
              <ChevronDown
                size={16}
                strokeWidth={1.75}
                aria-hidden
                style={{ transform: isOpen ? 'none' : 'rotate(-90deg)', transition: 'transform 180ms ease' }}
              />
              {s.label}{' '}
              <span style={{ fontWeight: 400, color: 'var(--fg-muted)' }}>
                {codes.filter(isTicked).length}/{codes.length} active
              </span>
            </button>
            {/* Don't let these toggle the row. */}
            <span style={{ display: 'inline-flex', gap: 'var(--space-1)', marginLeft: 'auto' }} onClick={(e) => e.stopPropagation()}>
              {bulkBtn(codes, 'All on', true, () => setOpenFor(s.id, true))}
              {bulkBtn(codes, 'All off', false)}
            </span>
          </div>
          {/* 0fr/1fr animates the height; inert skips hidden chips on Tab. */}
          <div
            id={panelId}
            inert={!isOpen}
            style={{ display: 'grid', gridTemplateRows: isOpen ? '1fr' : '0fr', transition: 'grid-template-rows 180ms ease' }}
          >
          <div style={{ overflow: 'hidden' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
            {chips.map((c) => {
              const on = isTicked(c.colourId);
              return (
                <button
                  key={c.colourId}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onToggle(c.colourId)}
                  title={c.colourId}
                  style={{
                    padding: '4px 12px', borderRadius: 999,
                    border: `1px solid ${on ? 'var(--c-orange)' : 'var(--line)'}`,
                    background: on ? 'var(--c-orange)' : 'var(--c-cream)',
                    color: on ? 'var(--c-paper)' : 'var(--c-ink)',
                    fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-13)', fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'background 120ms ease, color 120ms ease, border-color 120ms ease',
                  }}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
          </div>
          </div>
        </div>
        );
      })}
    </div>
  );
};
