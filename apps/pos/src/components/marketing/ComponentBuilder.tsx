// Component Builder — the full-screen "Step 1 · Components" overlay (design
// screen 05). Since 2026-10-09 (owner: "same as the original space planning —
// can rotate and edit") the canvas IS the POS Custom build, in its layoutOnly
// mode: drag to lay out with the snap, rotate a module or the whole sofa,
// select the whole sofa or Edit modules, remove, the cm dimension lines, the
// arm check, Expand room, Clear all. Nothing prices, and the auto-convert to a
// combo's SKU breakdown is off (owner 2026-10-09: that exists to match combo
// pricing; this is for procurement, so what is laid out is what is bought).
//
// Seat, fabric, colour and leg on this screen are the PARENT form's fields,
// two-way — the builder holds only the layout, until Save components.
//
// Rendered through a portal to <body>: the Marketing page's element reset
// (`.root :where(button…)` in marketing.module.css) must not reach the
// canvas's own controls, or they would stop looking like the POS's. The top
// bar keeps the reset by carrying `.root` itself.

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft } from 'lucide-react';
import { orderSofaCellsLeftToRight, type Cell, type SofaProductPricing } from '@2990s/shared';
import { CustomBuilder, centerCellsInRoom } from '../../pages/CustomBuilder';
import { cellsFromComboModules } from '../../lib/sofa-combo-cells';
import type { SofaCustomizerData } from '../../lib/queries';
import { seatDepth, type SofaLayout } from './marketing-model';
import s from './marketing.module.css';

/** A sofa being bought, not sold: nothing on the canvas carries a price. */
const NO_PRICING: SofaProductPricing = { compartments: [], bundles: [], reclinerUpgradeSen: 0, seatUpgradeLabel: null, combos: [] };
const noop = () => {};

const newId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** What Save components hands back: the layout, and its left-to-right read
 *  (the order the POS's own labels and Quick Picks use). */
export interface BuiltSofa { layout: SofaLayout; modules: string[] }

export interface BuilderProps {
  context: string;
  /** The layout saved last time. */
  initialLayout: SofaLayout | null | undefined;
  /** A record saved before the canvas has only its module list. */
  initialModules: readonly string[];
  /** The master compartment pool, as the canvas's palette takes it. */
  pool: SofaCustomizerData;
  seats: string[];
  seat: string;
  onSeat: (v: string) => void;
  fabrics: string[];
  fabric: string;
  onFabric: (v: string) => void;
  colours: string[];
  colour: string;
  onColour: (v: string) => void;
  legs: string[];
  leg: string;
  onLeg: (v: string) => void;
  onCancel: () => void;
  onSave: (built: BuiltSofa) => void;
}

/** The cells the canvas opens with: the saved layout as it was, or a bare
 *  module list laid out as Quick Pick lays out a combo, centred in the room. */
function startCells(layout: SofaLayout | null | undefined, modules: readonly string[], depth: string): Cell[] {
  if (layout && layout.length) return layout.map((c) => ({ ...c, id: c.id || newId() }));
  if (!modules.length) return [];
  return centerCellsInRoom(cellsFromComboModules(modules.map((m) => [m]), depth), depth).map((c) => ({ ...c, id: newId() }));
}

export const ComponentBuilder = (p: BuilderProps) => {
  const depth = seatDepth(p.seat);
  const [cells, setCells] = useState<Cell[]>(() => startCells(p.initialLayout, p.initialModules, depth));

  const save = () => {
    if (!cells.length) return;
    p.onSave({
      // Positions exactly as the canvas holds them — the snap made them flush.
      layout: cells.map((c) => ({ id: c.id, moduleId: c.moduleId, x: c.x, y: c.y, rot: c.rot })),
      modules: orderSofaCellsLeftToRight(cells, depth).map((c) => c.moduleId),
    });
  };

  // The parent form's fabric, colour and leg, where the POS rail has its
  // fabric picker.
  const railBlock = (
    <div className={s.root}>
      <div className={`${s.builderSection} ${s.builderSectionFirst}`}>
        <div className={s.builderSectionHead}>
          <span className={s.builderEyebrow}>Fabric series</span>
          <span className={s.builderSynced}>Synced with the form</span>
        </div>
        <div className={s.chipRow}>
          {p.fabrics.map((f) => (
            <button key={f} type="button" className={`${s.fabricChip} ${p.fabric === f ? s.pickOn : ''}`} onClick={() => p.onFabric(f)}>
              {f}
            </button>
          ))}
        </div>
      </div>
      <div className={s.builderSection}>
        <span className={s.builderEyebrow}>Colour</span>
        {p.colours.length === 0 && <span className={s.builderHint}>Pick a fabric series first</span>}
        <div className={s.chipRow}>
          {p.colours.map((c) => (
            <button key={c} type="button" className={`${s.colourChip} ${p.colour === c ? s.pickOn : ''}`} onClick={() => p.onColour(c)}>
              {c}
            </button>
          ))}
        </div>
      </div>
      <div className={s.legRow}>
        <span className={s.legRowLabel}>Leg height</span>
        <select className={s.legSelect} value={p.leg} onChange={(e) => p.onLeg(e.target.value)} aria-label="Leg height">
          <option value="">Confirm later</option>
          {p.legs.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    </div>
  );

  return createPortal(
    <div className={s.builder} role="dialog" aria-label="Build components">
      <div className={`${s.root} ${s.builderBar}`}>
        <div className={s.builderBarLeft}>
          <button type="button" className={s.closeBtn} aria-label="Back" onClick={p.onCancel}>
            <ArrowLeft size={20} strokeWidth={1.75} className={s.icon} />
          </button>
          <span className={s.builderContext}>{p.context}</span>
          <div className={s.seatSeg}>
            {p.seats.map((v) => (
              <button key={v} type="button" className={`${s.seatChip} ${p.seat === v ? s.seatChipOn : ''}`} onClick={() => p.onSeat(v)}>
                {v}
              </button>
            ))}
          </div>
          <span className={s.seatLabel}>Seat</span>
        </div>
        <div className={s.builderBarRight}>
          <button
            type="button"
            className={`${s.saveCompBtn} ${cells.length ? s.saveCompBtnOn : ''}`}
            onClick={save}
          >
            Save components
          </button>
        </div>
      </div>

      <div className={s.builderStage}>
        <CustomBuilder
          layoutOnly={{ railBlock }}
          productId=""
          productName=""
          pricing={NO_PRICING}
          depth={depth}
          cells={cells}
          setCells={setCells}
          onAdded={noop}
          modelCustomizer={p.pool}
        />
      </div>
    </div>,
    document.body,
  );
};
