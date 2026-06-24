export * from './format';
export * from './phone';
export * from './pricing';
export * from './mfg-pricing';
export * from './sofa-build';
export * from './sofa-combo-pricing';
export * from './sofa-quick-presets';
export * from './order-rules';
export * from './variant-key';
export * from './schemas';
export * from './variant-summary'; // Commander 2026-05-28
export * from './so-variant-rule'; // 2026-06-04 — POS/Backend variant vocabulary unified
export * from './fabric-tier-addon';
export * from './fabric-tier-override-resolve';
export * from './adjustment-reasons'; // 2026-06-04 — stock adjustment reason codes
export * from './inventory-adjustment'; // 2026-06-09 — adjustment variant+batch gate
export * from './sofa-tier'; // 2026-06-09 — sofa price-tier recognition for SKU import
export * from './service-sku'; // 2026-06-05 — SERVICE SKU vocabulary + guards (SO-SKU spec P1)
export * from './service-lines'; // 2026-06-05 — fee/addon → SERVICE line builders (SO-SKU spec P2)
export * from './so-sofa-split'; // 2026-06-05 — sofa build → per-module line split (SO-SKU spec P3)
export * from './one-shot-sku'; // 2026-06-08 — one-shot SKU code/name helpers (remark → auto-SKU)
export * from './maintenance-pools'; // 2026-06-12 — maintenance option ACTIVE toggles (picker-level filter)
export * from './free-gift'; // 2026-06-14 — default free gift pure module (parse/desired/validate)
export * from './free-item-campaign'; // 2026-06-17 — free item campaign matcher (campaignsCoveringLine) + delivery filtering
export * from './hr-commission'; // 2026-06-14 — HR commission math + KPI line matcher
export * from './effective-delivery'; // 2026-06-19 — PO effective (latest revised) delivery date
export * from './rule-target'; // 2026-06-20 — unified rule targeting (variant/compartment matcher)
export * from './special-delivery-match'; // 2026-06-20 — model-agnostic delivery trigger matcher (reuses rule-target)
export * from './customer-demographics'; // 2026-06-25 — race/age-frame constants + validators (marketing capture)
export * from './sales-analysis'; // 2026-06-25 — Sales Analysis pure aggregation core (Part B)
