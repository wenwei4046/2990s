/* TEMP dev harness (2026-06-29) — reproduce the "faint lines behind HEADREST"
 * bug in isolation. Renders the real CustomBuilder with a single HEADREST cell.
 * NOT shipped — route is dev-only and this file is removed before merge. */
import { useState } from 'react';
import { CustomBuilder } from '../CustomBuilder';
import type { Cell, Depth, SofaProductPricing } from '@2990s/shared';
import type { SofaCustomizerData } from '../../lib/queries';

const DEPTH: Depth = '28';

const PRICING: SofaProductPricing = {
  compartments: [{ compartmentId: 'HEADREST', active: true, price: 500 }],
  bundles: [],
  reclinerUpgradePrice: 0,
  combos: [],
  fabricTier: 'PRICE_1',
  comboHeight: '28',
  baseModel: '',
};

const CUSTOMIZER: SofaCustomizerData = {
  compartments: [
    { code: 'HEADREST', normalizedCode: 'HEADREST', label: 'Headrest', priceSen: 50000, imageUrl: null, group: 'Accessory' },
  ],
  sellingRows: [{ code: 'HEADREST', sellPriceSen: 50000, seatHeightPrices: null }],
  sizes: ['28'],
  legHeights: [],
  specials: [],
  fabricIds: [],
  modelId: 'dev-annsa',
  modelName: 'Annsa (dev)',
  modelCode: 'ANNSA',
};

export function HeadrestHarness() {
  const [cells, setCells] = useState<Cell[]>([
    { id: 'h1', moduleId: 'HEADREST', x: 250, y: 180, rot: 0 },
  ]);
  return (
    <div style={{ padding: 16 }}>
      <CustomBuilder
        productId="mfg-dev-annsa"
        productName="Annsa (dev)"
        pricing={PRICING}
        depth={DEPTH}
        cells={cells}
        setCells={setCells}
        onAdded={() => {}}
        modelCustomizer={CUSTOMIZER}
        baseModel="ANNSA"
        modelId="dev-annsa"
      />
    </div>
  );
}
