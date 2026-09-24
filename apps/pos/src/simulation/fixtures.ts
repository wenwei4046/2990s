/** Fictional, local-only data for exercising the real POS screens. Prices use
 * the existing API's sen/RM units. No live identifiers, customer data or URLs. */
export const SIMULATION_STAFF = { id: 'demo-sales', staffCode: 'DEMO', staff_code: 'DEMO', name: 'Demo Sales', role: 'sales', initials: 'DS', color: '#AD461B', showroomId: 'demo-showroom', has_pin: true };
export const DEMO_PWP_CODE = 'PWP-DEMO-BED';
const timestamp = '2026-09-01T00:00:00.000Z';
const fabricCodes = {
  CG: ['CG-001', 'CG-002', 'CG-003', 'CG-004'],
  EZ: Array.from({ length: 12 }, (_, i) => `EZ${String(i + 1).padStart(3, '0')}`),
  BF: Array.from({ length: 18 }, (_, i) => `BF-${String(i + 1).padStart(2, '0')}`).filter((x) => x !== 'BF-15'),
};
export const moduleCodes = ['1A(LHF)', '1A(RHF)', '1B(LHF)', '1B(RHF)', '1NA', '1S', '2A(LHF)', '2A(RHF)', '2NA', 'CNR', 'STOOL'];
const gaps = Array.from({ length: 17 }, (_, i) => `${i + 4}`);
const legs = ['No Leg', '1', '2', '4'];
const divans = ['4', '5', '6', '8', '10', '12', '14', '16'];
const commonModel = { active: true, branding: '2990', created_at: timestamp, updated_at: timestamp, photo_url: null, default_free_gifts: [] };
export const models = [
  { ...commonModel, id: 'demo-model-booqit', name: 'BOOQIT', model_code: 'BOOQIT', category: 'SOFA', description: 'Modular comfort, arranged your way.', allowed_options: { compartments: moduleCodes, sizes: ['24', '28'], fabrics: [...fabricCodes.CG, ...fabricCodes.EZ], leg_heights: ['6'], specials: ['SOFA-FULL', 'PACK-BACK'] } },
  { ...commonModel, id: 'demo-model-akka', name: 'AKKA-FIRM', model_code: 'AKKA-FIRM', category: 'MATTRESS', description: 'Firm support. Queen and King sizes.', allowed_options: { sizes: ['Q', 'K'], thickness: '31' } },
  { ...commonModel, id: 'demo-model-aria', name: 'ARIA', model_code: 'ARIA', category: 'BEDFRAME', description: 'Choose your fabric, gap, legs and divan height.', allowed_options: { sizes: ['Q', 'K'], fabrics: fabricCodes.BF, gaps, leg_heights: legs, divan_heights: divans, specials: ['DIVAN-COVER', 'HB-COVER', 'DRAWER-L', 'DRAWER-R', 'DRAWER-F', 'HB-STRAIGHT'] } },
  { ...commonModel, id: 'demo-model-protector-k', name: 'King waterproof mattress protector', model_code: 'PROTECTOR-K', category: 'ACCESSORY', description: 'Waterproof protection for a King mattress', allowed_options: {} },
  { ...commonModel, id: 'demo-model-protector-q', name: 'Queen waterproof mattress protector', model_code: 'PROTECTOR-Q', category: 'ACCESSORY', description: 'Waterproof protection for a Queen mattress', allowed_options: {} },
  { ...commonModel, id: 'demo-model-pillow', name: 'Contour pillow', model_code: 'CONTOUR-PILLOW', category: 'ACCESSORY', description: 'Supportive contour pillow', allowed_options: {} },
];
const sku = (id: string, code: string, name: string, category: string, modelIndex: number, price: number, size: string | null = null, pwp: number | null = null) => ({
  id, code, name, category, model_id: models[modelIndex]!.id, base_model: models[modelIndex]!.model_code, description: models[modelIndex]!.description ?? 'Fictional demonstration product', branding: '2990', size_code: size, size_label: size === 'K' ? 'King · 183×190 cm' : size === 'Q' ? 'Queen · 152×190 cm' : null,
  sell_price_sen: price, pwp_price_sen: pwp, base_price_sen: null, price1_sen: null, seat_height_prices: null as null | Array<{ height: string; tier: string; sellingPriceSen: number }>, included_addons: [], default_free_gifts: [], retail_product_id: null, status: 'ACTIVE', pos_active: true, unit_m3_milli: 0, sku_code: code, sub_assemblies: null, pieces: null, default_variants: null, updated_at: timestamp, product_models: models[modelIndex]!,
});
const modulePrices = [199000, 199000, 199000, 199000, 149000, 199000, 299000, 299000, 249000, 149000, 99000];
export const products = [
  ...moduleCodes.map((code, i) => ({ ...sku(`mfg-demo-booqit-${i}`, `BOOQIT-${code}`, `BOOQIT ${code}`, 'SOFA', 0, modulePrices[i]!), seat_height_prices: ['24', '28'].map((height) => ({ height, tier: 'PRICE_1', sellingPriceSen: modulePrices[i]! })) })),
  sku('mfg-demo-akka-k', 'AKKA-FIRM MATT (K)', '2990 AKKA-FIRM MATTRESS (183X190X31CM)', 'MATTRESS', 1, 299000, 'K'),
  sku('mfg-demo-akka-q', 'AKKA-FIRM MATT (Q)', '2990 AKKA-FIRM MATTRESS (152X190X31CM)', 'MATTRESS', 1, 299000, 'Q'),
  sku('mfg-demo-aria-k', 'ARIA-(K)', 'ARIA BEDFRAME KING', 'BEDFRAME', 2, 299000, 'K', 149000),
  sku('mfg-demo-aria-q', 'ARIA-(Q)', 'ARIA BEDFRAME QUEEN', 'BEDFRAME', 2, 299000, 'Q', 149000),
  sku('mfg-demo-protector-k', 'PROTECTOR-K', 'King waterproof mattress protector', 'ACCESSORY', 3, 15900),
  sku('mfg-demo-protector-q', 'PROTECTOR-Q', 'Queen waterproof mattress protector', 'ACCESSORY', 4, 15900),
  sku('mfg-demo-pillow', 'CONTOUR-PILLOW', 'Contour pillow', 'ACCESSORY', 5, 9900),
];
export const categories = [['sofa', 'Sofas', 'sofa'], ['mattress', 'Mattresses', 'bed-double'], ['bedframe', 'Bedframes', 'bed'], ['accessory', 'Accessories', 'package']].map(([id, label, icon], sortOrder) => ({ id, label, icon, tbc: false, sortOrder }));
export const fabrics = [['CG', 'CG', 'PRICE_1'], ['EZ', 'EZ', 'PRICE_2'], ['BF', 'BF', 'PRICE_1']].map(([id, label, tier], sortOrder) => ({ id, label, tier: 'standard', defaultSurcharge: 0, active: true, sortOrder, sofaTier: tier, bedframeTier: tier }));
const colours = ['#e5dfd1', '#c5b9a8', '#8c9291', '#5e6565', '#a39883', '#e6ddd0', '#b8c4b7', '#8b9ea1', '#b7aa9f', '#6e7674', '#747578', '#444c53'];
export const fabricColours = Object.entries(fabricCodes).flatMap(([fabricId, codes]) => codes.map((colourId, sortOrder) => ({ fabricId, colourId, label: ['Pearl', 'Sand', 'Stone', 'Grey'][sortOrder % 4], swatchHex: colours[sortOrder % colours.length], active: true, sortOrder })));
const option = (value: string, sellingPriceSen = 0) => ({ value, sellingPriceSen, priceSen: 0, active: true });
export const maintenance = {
  gaps, legHeights: legs.map((v) => option(v)), divanHeights: divans.map((v) => option(v, Math.max(0, Number(v) - 8) / 2 * 12500)), totalHeights: [], specials: [], sofaSpecials: [], sofaLegHeights: [option('6')], sofaSizes: ['24', '28'], sofaCompartments: moduleCodes, mattressSizes: ['Q', 'K'], bedframeSizes: ['Q', 'K'], brandings: ['2990'], supplierCategories: [],
  sofaCompartmentMeta: Object.fromEntries(moduleCodes.map((code) => [code, { description: code === 'CNR' ? 'Corner' : code === 'STOOL' ? 'Ottoman' : code }])),
};
export const sizeLibrary = [{ id: 'queen', label: 'Queen', widthCm: 152, lengthCm: 190, sortOrder: 0 }, { id: 'king', label: 'King', widthCm: 183, lengthCm: 190, sortOrder: 1 }];
export const combos = [
  { id: 'demo-combo-corner', label: '1B(LHF) + CNR + 2A(RHF)', modules: [['1B(LHF)'], ['CNR'], ['2A(RHF)']] },
  { id: 'demo-combo-straight', label: '1A(LHF) + 1NA + 1A(RHF)', modules: [['1A(LHF)'], ['1NA'], ['1A(RHF)']] },
].map((c) => ({ ...c, baseModel: 'BOOQIT', tier: null, customerId: null, pricesByHeight: {}, sellingPricesByHeight: { '24': 299000, '28': 299000 }, pwpPricesByHeight: { '24': 199000, '28': 199000 }, effectiveFrom: '2020-01-01', deletedAt: null, notes: '', createdAt: timestamp, updatedAt: timestamp, createdBy: null }));
export const quickPicks = combos.map((c, sortOrder) => ({ id: `pick-${c.id}`, baseModel: 'BOOQIT', label: c.label, modules: c.modules, depth: '28', sortOrder, createdAt: timestamp, createdBy: null }));
export const specialAddons = [
  ['SOFA-FULL', 'Sofa Full Fabric', 25000, 'SOFA'], ['PACK-BACK', 'Separate Backrest Packing', 25000, 'SOFA'],
  ['DIVAN-COVER', 'Divan Fully Cover', 12500, 'BEDFRAME'], ['HB-COVER', 'HB Fully Cover', 12500, 'BEDFRAME'],
  ['DRAWER-L', 'Left Drawer', 25000, 'BEDFRAME'], ['DRAWER-R', 'Right Drawer', 25000, 'BEDFRAME'], ['DRAWER-F', 'Front Drawer', 25000, 'BEDFRAME'], ['HB-STRAIGHT', 'HB Straight', 25000, 'BEDFRAME'],
].map(([code, label, sellingPriceSen, category], sortOrder) => ({ id: `demo-special-${code}`, code, label, sellingPriceSen, soDescription: label, costPriceSen: 0, categories: [category], optionGroups: [], active: true, sortOrder }));
export const addons = [
  { id: 'dispose-mattress', label: 'Dispose old mattress', description: 'Remove one old mattress', price: 100, kind: 'qty', serviceSku: 'SVC-DISPOSE-MATTRESS', perFloorItem: null },
  { id: 'dispose-bedframe', label: 'Dispose old bedframe', description: 'Remove one old bedframe', price: 100, kind: 'qty', serviceSku: 'SVC-DISPOSE-BEDFRAME', perFloorItem: null },
  { id: 'lift-carry', label: 'Staircase carry', description: 'First 2 floors included', price: 0, kind: 'floors_items', serviceSku: 'SVC-LIFT-CARRY', perFloorItem: 100 },
].map((a, sortOrder) => ({ ...a, icon: 'package', category: 'service', unit: 'item', defaultQty: 1, stock: null, enabled: true, showAtHandover: true, sortOrder }));
export const deliveryFees = { baseFee: 0, crossCategoryFee: 0, mattressBedframeLeadDays: 14, sofaLeadDays: 30 };
export const tierFees = { sofaTier2Delta: 125, sofaTier3Delta: 250, bedframeTier2Delta: 125, bedframeTier3Delta: 250 };
export const modelGifts = [{ modelId: 'demo-model-akka', modelName: 'AKKA-FIRM', modelCode: 'AKKA-FIRM', category: 'MATTRESS', updatedAt: timestamp, gifts: [
  { giftProductId: 'mfg-demo-protector-k', qty: 1, campaignName: 'Sleep essentials', condition: { scope: 'variant' as const, sizeCodes: ['K'] } },
  { giftProductId: 'mfg-demo-protector-q', qty: 1, campaignName: 'Sleep essentials', condition: { scope: 'variant' as const, sizeCodes: ['Q'] } },
  { giftProductId: 'mfg-demo-pillow', qty: 2, campaignName: 'Sleep essentials' },
] }];
export const pwpRules = [{ id: 'demo-pwp-rule', triggerCategory: 'MATTRESS', triggerEligibleModelIds: ['demo-model-akka'], triggerComboIds: [], triggerSizeCodes: [], triggerCompartments: [], rewardCategory: 'BEDFRAME', eligibleRewardModelIds: ['demo-model-aria'], rewardComboIds: [], rewardSizeCodes: [], rewardCompartments: [], qtyPerTrigger: 1, type: 'pwp', active: true, createdAt: timestamp, updatedAt: timestamp }];
export const demoPwp = { code: DEMO_PWP_CODE, ruleId: 'demo-pwp-rule', rewardCategory: 'BEDFRAME', eligibleRewardModelIds: ['demo-model-aria'], rewardComboIds: [], type: 'pwp', status: 'AVAILABLE', cartLineKey: null as string | null, triggerItemCode: null as string | null, sourceDocNo: null as string | null, customerId: null as string | null };
export const demoRewardCodes = [demoPwp,
  { ...demoPwp, code: 'PWP-DEMO-SOFA', ruleId: 'demo-pwp-sofa-rule', rewardCategory: 'SOFA', eligibleRewardModelIds: ['demo-model-booqit'], rewardComboIds: combos.map((c) => c.id) },
  { ...demoPwp, code: 'PROMO-DEMO-MATT', ruleId: 'demo-promo-rule', rewardCategory: 'MATTRESS', eligibleRewardModelIds: ['demo-model-akka'], type: 'promo' },
];
export const freeItemCampaigns = [{ id: 'demo-free-pillow', name: 'Demo complimentary sleep accessory', active: true, maxFreeQty: 2, eligible: models.filter((m) => m.category === 'ACCESSORY').map((m) => ({ scope: 'model' as const, modelId: m.id })) }];
const dropdowns: Record<string, string[]> = { customer_type: ['NEW', 'EXISTING'], building_type: ['Condo', 'Landed', 'Apartment'], relationship: ['Spouse', 'Parent', 'Sibling', 'Friend'], payment_method: ['Cash', 'Merchant', 'Online', 'Installment'], payment_merchant: ['GHL', 'MBB', 'PBB', 'HLB'], online_type: ['Bank Transfer', 'TNG', 'Cheque'], installment_plan: ['One-off', '3 months', '6 months', '12 months'], venue: ['Demo Showroom'] };
export const dropdownOptions = Object.fromEntries(Object.entries(dropdowns).map(([category, values]) => [category, values.map((value, sortOrder) => ({ id: `demo-${category}-${sortOrder}`, category, value, label: value === 'Online' ? 'Bank transfer' : value, active: true, sortOrder }))]));
export const venues = [{ id: 'demo-venue', name: 'Demo Showroom', address: '1 Demo Lane, 47300 Petaling Jaya, Selangor', active: true, created_at: timestamp }];
export const localities = [{ state: 'Selangor', city: 'Petaling Jaya', postcode: '47300' }, { state: 'Selangor', city: 'Shah Alam', postcode: '40000' }, { state: 'Kuala Lumpur', city: 'Kuala Lumpur', postcode: '50000' }, { state: 'Johor', city: 'Johor Bahru', postcode: '80000' }, { state: 'Pulau Pinang', city: 'George Town', postcode: '10000' }];
export const demoCustomer = { debtorName: 'Demo Customer', phone: '+60120000000', email: 'demo@example.test', customerType: 'NEW', address1: '1 Demo Lane', address2: '', city: 'Petaling Jaya', postcode: '47300', customerState: 'Selangor', buildingType: 'Landed', emergencyContactName: 'Demo Contact', emergencyContactPhone: '+60120000001', emergencyContactRelationship: 'Spouse', customerId: 'demo-customer', race: 'Chinese', birthday: '1990-01-01', gender: 'Male', lastDocNo: 'DEMO-SO-0000', lastOrderAt: timestamp };
export const campaigns = [{ id: 'demo-home-100', name: 'DEMO HOME RM100', valueCenti: 10000, stockTotal: 100, stockUsed: 0, remaining: 100, minPurchaseQty: 1, maxPerOrder: 1, terms: 'Local demonstration voucher. RM100 off eligible products.', active: true, createdAt: timestamp, updatedAt: timestamp }];
