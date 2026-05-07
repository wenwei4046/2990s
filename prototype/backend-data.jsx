// 2990's Backend Portal — Order Coordinator role
// Shared data: staff, lanes, sample orders flowing in from the showroom POS

const BE_PRICE = 2990;

const COORDINATOR = {
  id: 'oc-mei',
  name: 'Mei Lin Chua',
  role: 'Order Coordinator',
  initials: 'ML',
  email: 'meilin@2990s.com',
  color: '#A6471E',
};

// 6 status lanes — flow defined by the user
const LANES = [
  { id: 'received',     num: '01', title: 'Order received',        sub: 'Placed at the showroom · awaiting coordinator triage',         icon: 'inbox' },
  { id: 'proceed',      num: '02', title: 'Proceed requested',     sub: 'Sales pressed Proceed · ready to be picked up by ops',         icon: 'arrow-right-circle' },
  { id: 'logistics',    num: '03', title: 'Awaiting logistics',    sub: 'In stock check / re-ordering with supplier',                   icon: 'package-search' },
  { id: 'ready',        num: '04', title: 'Ready to dispatch',     sub: 'Stock secured at warehouse · awaiting dispatch slot',          icon: 'package-check' },
  { id: 'dispatched',   num: '05', title: 'Dispatched',            sub: 'Driver assigned · time confirmed with customer',               icon: 'truck' },
  { id: 'delivered',    num: '06', title: 'Delivered',             sub: 'Showroom marks delivered after DO is signed',                  icon: 'circle-check-big', terminal: true },
];

// Slip verification states (verify only — coordinator does not approve)
const SLIP_VERIFY = {
  none:     { label: 'No slip',         tone: 'muted',  icon: 'file-question' },
  pending:  { label: 'Awaiting check',  tone: 'warn',   icon: 'clock' },
  verified: { label: 'Verified',        tone: 'ok',     icon: 'shield-check' },
  flagged:  { label: 'Flagged',         tone: 'bad',    icon: 'flag' },
};

// Drivers — managed in the Settings page; assigned to orders at dispatch time.
const SEED_DRIVERS = [
  { id: 'DRV-01', name: 'Razali Ibrahim',   phone: '+60 12 887 4421', icNumber: '850412-08-5532', vehicle: 'Lorry · WXY 2241',     active: true,  createdAt: Date.now() - 60*86400*1000 },
  { id: 'DRV-02', name: 'Steven Tan Boon Hock', phone: '+60 16 442 8910', icNumber: '880207-14-6678', vehicle: 'Van · WPK 8830',  active: true,  createdAt: Date.now() - 40*86400*1000 },
  { id: 'DRV-03', name: 'Faizal Mohd Yusof',phone: '+60 11 998 2244', icNumber: '910928-10-3211', vehicle: 'Lorry · WTC 1102',     active: true,  createdAt: Date.now() - 14*86400*1000 },
];

// Sample order add-on catalog (used to seed orders below)
const BE_ADDONS = [
  { id: 'dispose-mattress', label: 'Dispose old mattress', desc: 'We collect & dispose responsibly', price: 120, unit: 'piece', stock: '∞', enabled: true,  icon: 'recycle' },
  { id: 'dispose-bedframe', label: 'Dispose old bedframe', desc: 'We collect & dispose responsibly', price: 120, unit: 'piece', stock: '∞', enabled: true,  icon: 'recycle' },
  { id: 'lift',             label: 'Lift access — 3rd floor & above', desc: 'Per floor per item', price: 50, unit: 'floor·item', stock: '∞', enabled: true, icon: 'arrow-up-from-line' },
  { id: 'assemble',         label: 'Bed frame assembly', desc: 'On-site assembly by delivery team', price: 80, unit: 'piece', stock: '∞', enabled: true,  icon: 'wrench' },
  { id: 'wrap',             label: 'Mattress protector wrap', desc: 'Vacuum-sealed protective wrap', price: 35, unit: 'piece', stock: 240, enabled: true, icon: 'package' },
  { id: 'pillow-set',       label: 'Linen pillow pair', desc: 'Set of 2 linen pillows', price: 180, unit: 'set', stock: 18, enabled: false, icon: 'sparkles' },
];

// Backend starts empty for live testimony — orders flow in from the POS via
// localStorage. The original seed has been parked below in `_legacySeedBackendOrders`
// so we can re-enable it later if needed.
function seedBackendOrders() {
  return [];
}

function _legacySeedBackendOrders() {
  const today = new Date();
  const d = (offset) => { const x = new Date(today); x.setDate(x.getDate() + offset); return x; };

  return [
    {
      id: 'SO-2045', placedAt: d(0).getTime(), staff: 'Aisyah Wong', lane: 'received',
      customer: { name: 'Ng Choon Hwa', phone: '+60 12 887 1240', email: 'choonhwa@example.com', address: 'B-08-2, Setia Walk, Persiaran Wawasan', postcode: '47160', city: 'Puchong', state: 'Selangor' },
      cart: [{ id: 'b-tenun', qty: 1 }, { id: 'm-cloud', qty: 1 }, { id: 'a-throw', qty: 2 }],
      addons: [{ id: 'dispose-mattress', qty: 1 }, { id: 'lift', floors: 4, items: 2 }],
      subtotal: 11960, addonTotal: 520,
      paid: 6000, slipVerify: 'pending', slipUrl: null,
      delivery: { date: null, slot: null },
      paymentMethod: 'transfer', approvalCode: 'DUITNOW-9912043',
      notes: 'Customer requested call before delivery.',
    },
    {
      id: 'SO-2046', placedAt: d(0).getTime() - 3 * 3600 * 1000, staff: 'Sarah Nurul', lane: 'received',
      customer: { name: 'Adrian Goh', phone: '+60 16 224 5588', email: 'adrian.g@example.com', address: '32, Lorong Bayan Indah 3', postcode: '11900', city: 'Bayan Lepas', state: 'Penang' },
      cart: [{ id: 's-noor', qty: 1 }, { id: 'a-rug', qty: 1 }],
      addons: [{ id: 'dispose-mattress', qty: 0 }],
      subtotal: 5980, addonTotal: 0,
      paid: 5980, slipVerify: 'pending',
      delivery: { date: d(8), slot: '12:00 – 15:00' },
      paymentMethod: 'credit', approvalCode: 'AC-7821934',
    },
    {
      id: 'SO-2042', placedAt: d(-1).getTime(), staff: 'Jia Ming Tan', lane: 'proceed',
      customer: { name: 'Priya Naidu', phone: '+60 19 876 5432', email: 'priya@example.com', address: 'Lot 14, Jalan Damansara', postcode: '50490', city: 'Kuala Lumpur', state: 'KL' },
      cart: [{ id: 'b-tenun', qty: 1 }, { id: 'm-oak', qty: 1 }],
      addons: [{ id: 'dispose-bedframe', qty: 1 }, { id: 'assemble', qty: 1 }],
      subtotal: 5980, addonTotal: 200,
      paid: 5980, slipVerify: 'verified',
      delivery: { date: d(6), slot: '09:00 – 12:00' },
      paymentMethod: 'transfer', approvalCode: 'FPX-44210',
    },
    {
      id: 'SO-2041', placedAt: d(-2).getTime(), staff: 'Aisyah Wong', lane: 'proceed',
      customer: { name: 'Tan Wei Han', phone: '+60 12 345 6789', email: 'weihan@example.com', address: 'A-12-3, Mont Kiara Aman', postcode: '50480', city: 'Kuala Lumpur', state: 'KL' },
      cart: [{ id: 's-noor', qty: 1 }, { id: 'a-rug', qty: 1 }, { id: 'a-cushion', qty: 1 }],
      addons: [{ id: 'dispose-mattress', qty: 1 }, { id: 'lift', floors: 5, items: 2 }],
      subtotal: 8970, addonTotal: 620,
      paid: 8970, slipVerify: 'verified',
      delivery: { date: d(5), slot: '15:00 – 18:00' },
      paymentMethod: 'credit', approvalCode: 'AC-7711233',
    },
    {
      id: 'SO-2038', placedAt: d(-4).getTime(), staff: 'Aisyah Wong', lane: 'logistics',
      customer: { name: 'Lim Wei Ling', phone: '+60 12 222 3344', email: 'weiling@example.com', address: 'A-12-3, Mont Kiara Aman, Jalan Kiara 3', postcode: '50480', city: 'Kuala Lumpur', state: 'KL' },
      cart: [{ id: 's-tanah', qty: 1 }, { id: 'a-coffee', qty: 1 }, { id: 'a-cushion', qty: 1 }],
      addons: [{ id: 'lift', floors: 3, items: 1 }],
      subtotal: 8970, addonTotal: 150,
      paid: 8970, slipVerify: 'verified',
      delivery: { date: d(7), slot: '12:00 – 15:00' },
      paymentMethod: 'credit', approvalCode: 'AC-7821934',
      stockNote: 'Tanah modular — re-order placed 3 May, ETA 8 May',
    },
    {
      id: 'SO-2039', placedAt: d(-5).getTime(), staff: 'Rafiq Lim', lane: 'logistics',
      customer: { name: 'Daniel Chong', phone: '+60 16 778 1212', email: 'daniel@example.com', address: '8, Jalan SS2/24', postcode: '47300', city: 'Petaling Jaya', state: 'Selangor' },
      cart: [{ id: 'b-kayu', qty: 1 }, { id: 'm-cloud', qty: 1 }],
      addons: [],
      subtotal: 5980, addonTotal: 0,
      paid: 5980, slipVerify: 'verified',
      delivery: { date: d(3), slot: '09:00 – 12:00' },
      paymentMethod: 'credit',
      stockNote: 'In stock — pulled to staging',
    },
    {
      id: 'SO-2035', placedAt: d(-7).getTime(), staff: 'Sarah Nurul', lane: 'ready',
      customer: { name: 'Hafiz Rahman', phone: '+60 11 998 7766', email: 'hafiz@example.com', address: '42, Jalan Tropicana 2', postcode: '47410', city: 'Petaling Jaya', state: 'Selangor' },
      cart: [{ id: 'm-linen', qty: 2 }, { id: 'a-throw', qty: 1 }],
      addons: [{ id: 'dispose-mattress', qty: 2 }],
      subtotal: 8970, addonTotal: 240,
      paid: 8970, slipVerify: 'verified',
      delivery: { date: d(2), slot: '12:00 – 15:00' },
      paymentMethod: 'transfer',
    },
    {
      id: 'SO-2033', placedAt: d(-9).getTime(), staff: 'Jia Ming Tan', lane: 'dispatched',
      customer: { name: 'Yvonne Lai', phone: '+60 13 311 7890', email: 'yvonne@example.com', address: '17, Jalan PJU 7/3', postcode: '47800', city: 'Petaling Jaya', state: 'Selangor' },
      cart: [{ id: 's-petang', qty: 1 }, { id: 'a-lamp', qty: 1 }],
      addons: [],
      subtotal: 5980, addonTotal: 0,
      paid: 5980, slipVerify: 'verified',
      delivery: { date: d(1), slot: '09:00 – 12:00' },
      paymentMethod: 'credit',
      driver: 'Nazri (Truck KL-23)', confirmedWith: 'WhatsApp · 4 May 11:20',
    },
    {
      id: 'SO-2031', placedAt: d(-12).getTime(), staff: 'Sarah Nurul', lane: 'delivered',
      customer: { name: 'Aaron Yeo', phone: '+60 13 555 1010', email: 'aaron@example.com', address: '10, Persiaran Mahsuri', postcode: '11950', city: 'Bayan Lepas', state: 'Penang' },
      cart: [{ id: 'm-linen', qty: 2 }],
      addons: [],
      subtotal: 5980, addonTotal: 0,
      paid: 5980, slipVerify: 'verified',
      delivery: { date: d(-2), slot: '15:00 – 18:00' },
      deliveredAt: d(-2).getTime(),
      paymentMethod: 'transfer',
      doSigned: true,
    },
  ];
}

Object.assign(window, { BE_PRICE, COORDINATOR, LANES, SLIP_VERIFY, BE_ADDONS, SEED_DRIVERS, seedBackendOrders });
