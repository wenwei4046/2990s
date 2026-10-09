// A laid-out sofa, drawn the way the POS draws one (owner 2026-10-09: the
// Marketing builder IS the Custom build canvas now, so its previews must show
// what was laid out — a chaise turned 90°, a corner — which a left-to-right
// blueprint cannot). SofaCellsPreview is the Quick Pick preview; it is given
// the art the canvas draws with. A record saved before the canvas has only its
// module list, laid out here the way Quick Pick lays out a combo (left to
// right, a corner as an L).

import { useMemo, type CSSProperties } from 'react';
import { SofaCellsPreview } from '../SofaCellsPreview';
import { cellsFromComboModules } from '../../lib/sofa-combo-cells';
import type { SofaLayout } from './marketing-model';
import s from './marketing.module.css';

/** Room for the W × D dimension lines SofaCellsPreview draws outside the sofa. */
const DIMS_PADDING: CSSProperties = { padding: '42px 46px 8px 8px' };

export const SofaLayoutPreview = ({ layout, modules, depth, art, dims = false, pad = 4 }: {
  layout: SofaLayout | null | undefined;
  modules: readonly string[];
  /** Seat depth the modules are measured at — seatDepth(seat). */
  depth: string;
  art: (code: string) => string;
  /** Draw the length × depth cm lines (the bigger previews). */
  dims?: boolean;
  pad?: number;
}) => {
  const cells = useMemo(
    () => (layout && layout.length ? layout : cellsFromComboModules(modules.map((m) => [m]), depth)),
    [layout, modules, depth],
  );
  if (!cells.length) return <span className={s.layoutEmpty}>No compartments yet</span>;
  return (
    <div className={s.layoutBox} style={dims ? DIMS_PADDING : { padding: pad }}>
      <div className={s.layoutFit}>
        <SofaCellsPreview cells={cells} depth={depth} artSrc={art} showDims={dims} tileBundles={false} />
      </div>
    </div>
  );
};
