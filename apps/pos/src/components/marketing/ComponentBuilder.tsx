// Component Builder — the full-screen "Step 1 · Components" overlay (design
// screen 05). Mirrors the POS Custom Build: tap a Maintenance module to append
// it to the run, left to right. Seat, fabric, colour and leg on this screen
// are the PARENT form's fields, two-way — the builder holds only the module run.

import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { shapeName } from './marketing-model';
import { MODULE_GROUP_ORDER, type ModuleOption } from './marketing-options';
import { SofaBlueprint } from './SofaBlueprint';
import s from './marketing.module.css';

export interface BuilderProps {
  context: string;
  initial: string[];
  modules: ModuleOption[];
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
  onSave: (mods: string[]) => void;
}

export const ComponentBuilder = (p: BuilderProps) => {
  const [mods, setMods] = useState<string[]>([...p.initial]);
  const groups = MODULE_GROUP_ORDER
    .map((label) => ({ label, items: p.modules.filter((m) => m.group === label) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className={s.builder} role="dialog" aria-label="Build components">
      <div className={s.builderBar}>
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
          {mods.length > 0 && <button type="button" className={s.clearBtn} onClick={() => setMods([])}>Clear</button>}
          <button
            type="button"
            className={`${s.saveCompBtn} ${mods.length ? s.saveCompBtnOn : ''}`}
            onClick={() => { if (mods.length) p.onSave(mods); }}
          >
            Save components
          </button>
        </div>
      </div>

      <div className={s.builderBody}>
        <aside className={s.builderRail}>
          <div className={s.builderRailHead}>
            <span className={s.builderEyebrow}>Modules</span>
            <span className={s.builderTapHint}>Tap to add</span>
          </div>
          {groups.map((g) => (
            <div key={g.label} className={s.moduleGroup}>
              <span className={s.moduleGroupLabel}>{g.label}</span>
              {g.items.map((m) => (
                <button key={m.id} type="button" className={s.moduleBtn} onClick={() => setMods((x) => [...x, m.id])}>
                  <span className={s.moduleTile}>
                    <span className={s.moduleArt} style={{ backgroundImage: `url("${m.art}")` }} />
                  </span>
                  <span className={s.moduleText}>
                    <span className={s.moduleId}>{m.id}</span>
                    <span className={s.moduleLabel}>{m.label}</span>
                    {m.dim && <span className={s.moduleDim}>{m.dim}</span>}
                  </span>
                  <span className={s.modulePlus}>+</span>
                </button>
              ))}
            </div>
          ))}
          {groups.length === 0 && <span className={s.builderHint}>No sofa components in Maintenance yet.</span>}

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
        </aside>

        <section className={s.canvasCol}>
          <div className={s.canvasHead}>
            <div>
              <div className={s.canvasEyebrow}>Custom build · Tap to lay out</div>
              <div className={s.canvasTitle}>{mods.length ? shapeName(mods) : 'Empty room'}</div>
            </div>
            <span className={s.canvasCount}>{mods.length} component{mods.length === 1 ? '' : 's'}</span>
          </div>
          <div className={s.canvas}>
            {mods.length === 0 ? (
              <div className={s.canvasEmpty}>
                <div className={s.canvasEmptyTitle}>Empty room</div>
                <div className={s.canvasEmptySub}>Pick modules from the left to start building.</div>
              </div>
            ) : (
              <>
                <SofaBlueprint modules={mods} maxW={720} maxH={300} showLabels />
                <div className={s.chosenRow}>
                  {mods.map((m, i) => (
                    <span key={`${m}-${i}`} className={s.chosenChip}>
                      {/* Number, dot and code are separate flex items so the
                          chip's 6px gap spaces them — "1 . 2A(LHF)", as the
                          design draws it. */}
                      <span>{i + 1}</span>.<span>{m}</span>
                      <button
                        type="button"
                        className={s.chosenX}
                        aria-label={`Remove ${m}`}
                        onClick={() => setMods((x) => x.filter((_, j) => j !== i))}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
