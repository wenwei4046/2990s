// 2990's POS — catalog data, staff, sample customers
// Every product: RM2,990. Always.

const PRICE = 2990;

const STAFF = [
  { id: 'aw',  name: 'Aisyah Wong',     role: 'Senior Sales',   pin: '2990', initials: 'AW', color: '#E86B3A' },
  { id: 'jm',  name: 'Jia Ming Tan',    role: 'Showroom Lead',  pin: '1234', initials: 'JM', color: '#A6471E' },
  { id: 'rl',  name: 'Rafiq Lim',       role: 'Sales',          pin: '4321', initials: 'RL', color: '#2F5D4F' },
  { id: 'sn',  name: 'Sarah Nurul',     role: 'Sales',          pin: '0000', initials: 'SN', color: '#1F3A8A' },
];

const CATEGORIES = [
  { id: 'all',       label: 'All',           icon: 'layout-grid' },
  { id: 'mattress',  label: 'Mattresses',    icon: 'bed-double' },
  { id: 'sofa',      label: 'Sofas',         icon: 'sofa' },
  { id: 'bedframe',  label: 'Bed frames',    icon: 'bed' },
  // Categories below are hidden from the catalog while their ranges are
  // still being finalised — they appear in the sidebar under a separate
  // "To be confirmed" heading so the rail doesn't look empty.
  { id: 'dining',    label: 'Dining',        icon: 'utensils', tbc: true },
  { id: 'bathroom',  label: 'Bathroom',      icon: 'bath',     tbc: true },
  { id: 'kids',      label: 'Kids zone',     icon: 'baby',     tbc: true },
  { id: 'accessory', label: 'Accessories',   icon: 'lamp',     tbc: true },
];

// Photo pool — reuse the brand imagery; some entries duplicate by design.
const IMG = {
  bedroomWarm:    'assets/imagery/bedroom-warm.jpg',
  sofaWarm:       'assets/imagery/sofa-warm.jpg',
  bedBlueDuvet:   'assets/imagery/bed-blue-duvet.jpg',
  bedBluePlatform:'assets/imagery/bed-blue-platform.jpg',
  duvetStripe:    'assets/imagery/duvet-stripe.jpg',
  childrensRoom:  'assets/imagery/childrens-room.jpg',
  interiorLR:     'assets/imagery/interior-living-room.jpg',
  lifestyle1:     'assets/imagery/lifestyle-1.jpg',
  lifestyle2:     'assets/imagery/lifestyle-2.jpg',
  lifestyle3:     'assets/imagery/lifestyle-3.jpg',
  showroom:       'assets/imagery/showroom-entry.jpg',
  family:         'assets/imagery/family-kids-window.jpg',
  boxBlue:        'assets/imagery/box-blue-trend.jpg',
  boxGreen:       'assets/imagery/box-green-christmas.jpg',
};

// ──────────────────────────────────────────────────────────────────
// Pricing libraries — structural definitions shared across SKUs.
// Each Sofa Model carries its OWN copy of these (per-Model pricing),
// stored on the product as `pricing.compartments`, `pricing.bundles`.
// Mattress + Bedframe use size variants stored as `pricing.sizes`.
// Backend SKU Master inserts/edits these per-SKU; POS reads them.
// ──────────────────────────────────────────────────────────────────
const SOFA_COMPARTMENT_LIBRARY = [
  { id: '1A-L',  group: '1-seater',  label: '1A · Left arm',     defaultPrice: 1490 },
  { id: '1A-R',  group: '1-seater',  label: '1A · Right arm',    defaultPrice: 1490 },
  { id: '1NA',   group: '1-seater',  label: '1NA · No arms',     defaultPrice:  990 },
  { id: '2A-L',  group: '2-seater',  label: '2A · Left arm',     defaultPrice: 1990 },
  { id: '2A-R',  group: '2-seater',  label: '2A · Right arm',    defaultPrice: 1990 },
  { id: '2NA',   group: '2-seater',  label: '2NA · No arms',     defaultPrice: 1490 },
  { id: '1C-NW', group: 'Corner',    label: '1C · NW corner',    defaultPrice: 1490 },
  { id: '1C-NE', group: 'Corner',    label: '1C · NE corner',    defaultPrice: 1490 },
  { id: '1C-SE', group: 'Corner',    label: '1C · SE corner',    defaultPrice: 1490 },
  { id: '1C-SW', group: 'Corner',    label: '1C · SW corner',    defaultPrice: 1490 },
  { id: 'L-L',   group: 'L-Shape',   label: 'L · Left',          defaultPrice: 1490 },
  { id: 'L-R',   group: 'L-Shape',   label: 'L · Right',         defaultPrice: 1490 },
  { id: 'WC-45', group: 'Accessory', label: 'Wood console · 45cm', defaultPrice: 590 },
];

const SOFA_BUNDLE_LIBRARY = [
  { id: '1S',  label: '1-Seater', sub: 'Single seat',           defaultPrice: 1490 },
  { id: '2S',  label: '2-Seater', sub: 'Two seats',             defaultPrice: 1990 },
  { id: '3S',  label: '3-Seater', sub: 'Three seats',           defaultPrice: 2490 },
  { id: '2+L', label: '2 + L',    sub: '2-seater with chaise',  defaultPrice: 2990 },
  { id: '3+L', label: '3 + L',    sub: '3-seater with chaise',  defaultPrice: 3990 },
];

const MATTRESS_SIZE_LIBRARY = [
  { id: 'single',       label: 'Single',       dim: '92×190'  },
  { id: 'super-single', label: 'Super single', dim: '107×190' },
  { id: 'queen',        label: 'Queen',        dim: '152×190' },
  { id: 'king',         label: 'King',         dim: '183×190' },
];

const BEDFRAME_SIZE_LIBRARY = [
  { id: 'single',       label: 'Single',       dim: '92×190'  },
  { id: 'super-single', label: 'Super single', dim: '107×190' },
  { id: 'queen',        label: 'Queen',        dim: '152×190' },
  { id: 'king',         label: 'King',         dim: '183×190' },
];

const RECLINER_DEFAULT_PRICE = 990;

// Default pricing factories — used when seeding a new Model or when a SKU
// has no pricing configured yet. All compartments/bundles/sizes start as
// `active: true`; the coordinator can toggle off what doesn't apply to the Model.
function defaultSofaPricing(overrides = {}) {
  return {
    compartments: SOFA_COMPARTMENT_LIBRARY.map(c => ({
      id: c.id, active: true, price: (overrides.compartments?.[c.id]?.price ?? c.defaultPrice),
    })),
    bundles: SOFA_BUNDLE_LIBRARY.map(b => ({
      id: b.id, active: true, price: (overrides.bundles?.[b.id]?.price ?? b.defaultPrice),
    })),
    reclinerUpgrade: overrides.reclinerUpgrade ?? RECLINER_DEFAULT_PRICE,
  };
}
function defaultMattressPricing(overrides = {}) {
  return {
    sizes: MATTRESS_SIZE_LIBRARY.map(s => ({
      id: s.id, active: true, price: (overrides[s.id] ?? 2990),
    })),
  };
}
function defaultBedframePricing(overrides = {}) {
  return {
    sizes: BEDFRAME_SIZE_LIBRARY.map(s => ({
      id: s.id, active: true, price: (overrides[s.id] ?? 2990),
    })),
  };
}

// Pricing summary for SKU table display. Returns { from, to } in MYR or null.
function pricingRange(product) {
  if (!product?.pricing) return null;
  if (product.cat === 'sofa') {
    const all = [
      ...(product.pricing.compartments || []).filter(x => x.active).map(x => x.price),
      ...(product.pricing.bundles || []).filter(x => x.active).map(x => x.price),
    ].filter(n => Number.isFinite(n) && n > 0);
    if (!all.length) return null;
    return { from: Math.min(...all), to: Math.max(...all) };
  }
  if (product.cat === 'mattress' || product.cat === 'bedframe') {
    const prices = (product.pricing.sizes || [])
      .filter(s => s.active).map(s => s.price)
      .filter(n => Number.isFinite(n) && n > 0);
    if (!prices.length) return null;
    return { from: Math.min(...prices), to: Math.max(...prices) };
  }
  return null;
}

const PRODUCTS = [
  // Mattresses
  { id: 'm-cloud',      sku: 'MAT-001', cat: 'mattress', name: 'Cloud Series Mattress',     series: 'White Series',  size: 'Queen, 152×190',  detail: 'Pocket spring · gel-infused memory foam · cool knit', img: IMG.bedroomWarm,    stock: 12, pricing: defaultMattressPricing({ single: 1990, 'super-single': 2490, queen: 2990, king: 3490 }) },
  { id: 'm-oak',        sku: 'MAT-002', cat: 'mattress', name: 'Oak Comfort Mattress',      series: 'Earth Warm',    size: 'King, 183×190',   detail: 'Hybrid latex · medium-firm · oeko-tex cover',         img: IMG.bedBlueDuvet,   stock: 7, pricing: defaultMattressPricing({ single: 2490, 'super-single': 2990, queen: 3490, king: 3990 }) },
  { id: 'm-linen',      sku: 'MAT-003', cat: 'mattress', name: 'Linen Daybreak Mattress',   series: 'Earth Warm',    size: 'Single, 92×190',  detail: 'Soft top · breathable linen · 5-zone support',        img: IMG.duvetStripe,    stock: 18, pricing: defaultMattressPricing({ single: 1490, 'super-single': 1990, queen: 2490, king: 2990 }) },
  { id: 'm-dusk',       sku: 'MAT-004', cat: 'mattress', name: 'Dusk Memory Mattress',      series: 'Trend 26',      size: 'Queen, 152×190',  detail: 'Memory foam · medium · cooling cover',                img: IMG.bedBluePlatform,stock: 5, pricing: defaultMattressPricing({ single: 2290, 'super-single': 2790, queen: 3290, king: 3790 }) },

  // Sofas
  { id: 's-noor',       sku: 'SOF-101', cat: 'sofa',     name: 'Noor 3-seater Sofa',         series: 'White Series',  size: '210cm · 3-seat',   detail: 'Boucle cream · solid oak frame · feather wrap',     img: IMG.sofaWarm,       stock: 3, pricing: defaultSofaPricing() },
  { id: 's-tanah',      sku: 'SOF-102', cat: 'sofa',     name: 'Tanah Modular Sofa',         series: 'Earth Warm',    size: '260cm · L-shape',  detail: 'Sand linen · modular · stain-resistant',           img: IMG.interiorLR,     stock: 4, pricing: (() => { const p = defaultSofaPricing({ compartments: { '1A-L': { price: 1690 }, '1A-R': { price: 1690 }, '2A-L': { price: 2190 }, '2A-R': { price: 2190 }, 'L-L': { price: 1690 }, 'L-R': { price: 1690 } }, bundles: { '3+L': { price: 4290 }, '2+L': { price: 3190 } } }); /* Tanah doesn't ship corners */ p.compartments.forEach(c => { if (c.id.startsWith('1C-')) c.active = false; }); return p; })() },
  { id: 's-rumah',      sku: 'SOF-103', cat: 'sofa',     name: 'Rumah 2-seater Loveseat',    series: 'Earth Warm',    size: '160cm · 2-seat',   detail: 'Walnut leather · brass legs · slow-aged',          img: IMG.lifestyle1,     stock: 6, pricing: (() => { const p = defaultSofaPricing({ compartments: { '1A-L': { price: 1890 }, '1A-R': { price: 1890 }, '2A-L': { price: 2390 }, '2A-R': { price: 2390 }, '1NA': { price: 1190 }, '2NA': { price: 1690 } }, bundles: { '1S': { price: 1890 }, '2S': { price: 2390 }, '3S': { price: 2890 } } }); /* Rumah is a small loveseat — no L-shape, no corners */ p.compartments.forEach(c => { if (c.id.startsWith('1C-') || c.id.startsWith('L-') || c.id === 'WC-45') c.active = false; }); p.bundles.forEach(b => { if (b.id === '2+L' || b.id === '3+L') b.active = false; }); return p; })() },
  { id: 's-petang',     sku: 'SOF-104', cat: 'sofa',     name: 'Petang Lounge Chair',        series: 'White Series',  size: '78cm · armchair',  detail: 'Cream wool · curved oak · swivel base',            img: IMG.lifestyle2,     stock: 11, pricing: (() => { const p = defaultSofaPricing({ compartments: { '1A-L': { price: 1690 }, '1A-R': { price: 1690 }, '1NA': { price: 1290 } }, reclinerUpgrade: 0 }); /* Petang is a single armchair only */ p.compartments.forEach(c => { if (!['1A-L', '1A-R', '1NA'].includes(c.id)) c.active = false; }); p.bundles.forEach(b => { b.active = (b.id === '1S'); }); return p; })() },

  // Bed frames
  { id: 'b-kayu',       sku: 'BED-201', cat: 'bedframe', name: 'Kayu Platform Bed',          series: 'Earth Warm',    size: 'Queen',            detail: 'Solid ash · slatted base · low profile',           img: IMG.bedBluePlatform,stock: 8, pricing: defaultBedframePricing({ single: 1990, 'super-single': 2490, queen: 2990, king: 3490 }) },
  { id: 'b-tenun',      sku: 'BED-202', cat: 'bedframe', name: 'Tenun Upholstered Bed',      series: 'White Series',  size: 'King',             detail: 'Quilted boucle · channel headboard · oak feet',    img: IMG.bedroomWarm,    stock: 6, pricing: defaultBedframePricing({ single: 2990, 'super-single': 3490, queen: 3990, king: 4490 }) },
  { id: 'b-oasis',      sku: 'BED-203', cat: 'bedframe', name: 'Oasis Storage Bed',          series: 'Earth Warm',    size: 'Queen · storage',  detail: 'Lift-up base · 240L storage · linen finish',       img: IMG.lifestyle3,     stock: 5, pricing: (() => { const p = defaultBedframePricing({ queen: 3490, king: 3990 }); /* Oasis only ships Queen + King */ p.sizes.forEach(s => { if (s.id === 'single' || s.id === 'super-single') s.active = false; }); return p; })() },

  // Dining
  { id: 'd-meja',       sku: 'DIN-301', cat: 'dining',   name: 'Meja Round Dining Table',    series: 'Earth Warm',    size: 'Ø120cm · seats 4',  detail: 'Solid oak · seamless top · fluted base',           img: IMG.interiorLR,     stock: 4 },
  { id: 'd-makan',      sku: 'DIN-302', cat: 'dining',   name: 'Makan Extending Table',      series: 'Earth Warm',    size: '160→210cm · seats 6–8', detail: 'Walnut · butterfly leaf · brass joinery',     img: IMG.lifestyle1,     stock: 2 },
  { id: 'd-kerusi',     sku: 'DIN-303', cat: 'dining',   name: 'Kerusi Dining Chair (set 2)',series: 'White Series',  size: 'Set of 2',          detail: 'Bent ash · woven seat · cream',                    img: IMG.lifestyle2,     stock: 14 },

  // Bathroom — White Series
  { id: 'w-tub',        sku: 'BTH-401', cat: 'bathroom', name: 'Aliran Soaking Tub',         series: 'White Series',  size: '170cm freestanding',detail: 'Acrylic · matte stone finish · slip-resistant',    img: IMG.lifestyle3,     stock: 3 },
  { id: 'w-vanity',     sku: 'BTH-402', cat: 'bathroom', name: 'Pancur Vanity 1200',         series: 'White Series',  size: '120cm · 2 drawer',  detail: 'Oak veneer · stone top · soft-close',              img: IMG.duvetStripe,    stock: 6 },
  { id: 'w-shower',     sku: 'BTH-403', cat: 'bathroom', name: 'Hujan Rain Shower System',   series: 'White Series',  size: '300mm head',        detail: 'Brushed brass · thermostatic · ceiling-mount',     img: IMG.lifestyle2,     stock: 9 },

  // Kids
  { id: 'k-bunk',       sku: 'KID-501', cat: 'kids',     name: 'Bukit Bunk Bed',             series: 'Kids Zone',     size: 'Twin / Twin',       detail: 'Solid pine · ladder · trundle option',             img: IMG.childrensRoom,  stock: 4 },
  { id: 'k-desk',       sku: 'KID-502', cat: 'kids',     name: 'Belajar Study Desk',         series: 'Kids Zone',     size: '110cm',             detail: 'Height-adjust · oak top · cable tidy',             img: IMG.family,         stock: 7 },
  { id: 'k-toychest',   sku: 'KID-503', cat: 'kids',     name: 'Mainan Toy Chest',           series: 'Kids Zone',     size: '90cm wide',         detail: 'Soft-close lid · safety hinges · oak',             img: IMG.childrensRoom,  stock: 10 },

  // Accessories
  { id: 'a-rug',        sku: 'ACC-601', cat: 'accessory',name: 'Pasir Wool Rug',             series: 'Earth Warm',    size: '200×290cm',         detail: 'Hand-tufted wool · sand · low pile',               img: IMG.lifestyle1,     stock: 8 },
  { id: 'a-lamp',       sku: 'ACC-602', cat: 'accessory',name: 'Cahaya Floor Lamp',          series: 'White Series',  size: '160cm tall',        detail: 'Linen shade · oak stem · dimmable',                img: IMG.lifestyle2,     stock: 12 },
  { id: 'a-throw',      sku: 'ACC-603', cat: 'accessory',name: 'Selimut Throw Blanket',      series: 'Earth Warm',    size: '130×170cm',         detail: 'Wool blend · oat · woven trim',                    img: IMG.duvetStripe,    stock: 22 },
  { id: 'a-cushion',    sku: 'ACC-604', cat: 'accessory',name: 'Bantal Cushion (set 2)',     series: 'Earth Warm',    size: 'Set of 2 · 50×50',  detail: 'Linen · feather fill · hidden zip',                img: IMG.lifestyle3,     stock: 30 },
  { id: 'a-coffee',     sku: 'ACC-605', cat: 'accessory',name: 'Kopi Coffee Table',          series: 'Earth Warm',    size: 'Ø90cm',             detail: 'Travertine · brass collar · solid base',           img: IMG.interiorLR,     stock: 5 },
  { id: 'a-mirror',     sku: 'ACC-606', cat: 'accessory',name: 'Cermin Arch Mirror',         series: 'White Series',  size: '180×80cm',          detail: 'Solid oak frame · float-mount · arch top',         img: IMG.bedBlueDuvet,   stock: 9 },
];

const SERIES_OPTIONS = ['All series', 'White Series', 'Earth Warm', 'Trend 26', 'Kids Zone'];

const PAYMENT_METHODS = [
  { id: 'credit',     label: 'Credit Card',         icon: 'credit-card', hint: 'Approval code from terminal' },
  { id: 'debit',      label: 'Debit Card',          icon: 'credit-card', hint: 'Approval code from terminal' },
  { id: 'installment',label: 'Installment',         icon: 'calendar-clock', hint: 'Bank instalment plan · approval code' },
  { id: 'transfer',   label: 'Bank Transfer',       icon: 'qr-code', hint: 'DuitNow / FPX · transaction reference' },
];

const ADDONS = [
  { id: 'dispose-mattress', label: 'Dispose old mattress', hint: 'RM120 per piece · we collect & dispose responsibly', price: 120, icon: 'recycle', kind: 'qty', perItemPrice: 120, defaultQty: 1, qtyLabel: 'Mattresses' },
  { id: 'dispose-bedframe', label: 'Dispose old bedframe', hint: 'RM120 per piece · we collect & dispose responsibly', price: 120, icon: 'recycle', kind: 'qty', perItemPrice: 120, defaultQty: 1, qtyLabel: 'Bedframes' },
  { id: 'lift',      label: 'Lift access — 3rd floor & above', hint: 'RM50 per floor per item · for buildings without service lift', price: 0, icon: 'arrow-up-from-line', kind: 'floors', perFloorItem: 50, defaultFloors: 3, defaultItems: 1 },
];

Object.assign(window, {
  PRICE, STAFF, CATEGORIES, PRODUCTS, SERIES_OPTIONS, PAYMENT_METHODS, ADDONS, IMG,
  // Pricing libraries (structural — used by SKU Master to render the form)
  SOFA_COMPARTMENT_LIBRARY, SOFA_BUNDLE_LIBRARY,
  MATTRESS_SIZE_LIBRARY, BEDFRAME_SIZE_LIBRARY,
  RECLINER_DEFAULT_PRICE,
  // Pricing helpers
  defaultSofaPricing, defaultMattressPricing, defaultBedframePricing,
  pricingRange,
});
