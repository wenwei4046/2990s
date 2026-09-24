import { PAYMENT_METHOD_CODES } from '@2990s/shared/payment-methods';
import { missingVariantAxes } from '@2990s/shared/so-variant-rule';
import { computeMfgLinePrice, type MfgPricingProduct } from '@2990s/shared/mfg-pricing';
import { buildVariantSummary, matchComboSubset, campaignsCoveringLine, buildFreeGiftTriggers, validateFreeGiftClaims } from '@2990s/shared';
import { meetsProceedGate, meetsProcessingDatePaymentGate } from '@2990s/shared/order-rules';
import { splitSofaBuildIntoModuleLines } from '@2990s/shared/so-sofa-split';
import { planVoucher } from '../lib/voucher-apply';
// Pure calendar helper used by the actual API's board and sales summary. It
// performs no I/O and keeps inclusive MY-local date ranges consistent.
import { monthBoundsMy, rangeBoundsMy } from '../../../api/src/lib/my-time';
import * as fixtures from './fixtures';

// This module never calls fetch. Every response, including failures, is local.
// The bootstrap intercepts API traffic before importing the actual POS app.
export const SIMULATION_STORAGE_KEY = '2990:mobile-simulation:v1';
type Row = Record<string, any>;
type StoredOrder = { salesOrder: Row; items: Row[]; payments: Row[] };
type Store = { version: 1; serial: number; cart: { lines: Row[]; sourceQuoteId: string | null }; orders: StoredOrder[]; quotes: Row[]; picks: Row[]; pwp: Row[]; slips: Record<string, Row>; redemptions: Row[]; idempotency: Record<string, { body: string; docNo: string }> };
let memory: Store | undefined;
const audit: Array<{ method: string; path: string; status: number }> = [];
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const now = () => new Date().toISOString();
const today = () => now().slice(0, 10);
const uid = (kind: string) => {
  // A same-Wi-Fi HTTP preview is not a secure context, so randomUUID may be
  // absent even though getRandomValues is available. These are fictional
  // record identifiers, never credentials. Keep catalog initialization usable
  // without installing a crypto shim or changing production order hashing.
  const random = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `demo-${kind}-${random}`;
};
const money = (r: Row, field: string) => Number(r[`${field}Sen`] ?? r[`${field}Centi`] ?? 0);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-pos-simulation': 'local-only' } });
const failure = (error: string, reason: string, status = 400) => json({ error, reason, simulation: true }, status);

function lineFromPayload(row: Row, i: number): Row {
  const qty = Number(row.qty ?? 1);
  const unit = money(row, 'unitPrice');
  const discount = money(row, 'discount');
  const product = fixtures.products.find((p) => p.code === row.itemCode);
  return { id: uid(`line-${i}`), item_code: row.itemCode, item_group: row.itemGroup ?? product?.category.toLowerCase() ?? 'others', description: row.description ?? product?.name ?? row.itemCode, description2: row.description2 ?? (buildVariantSummary(row.itemGroup, row.variants) || null), qty, variants: clone(row.variants ?? {}), remark: row.remark ?? row.variants?.remark ?? null, unit_price_sen: unit, unit_price_centi: unit, discount_sen: discount, discount_centi: discount, total_sen: qty * unit - discount, total_centi: qty * unit - discount, cancelled: false, line_delivery_date: row.lineDeliveryDate ?? null };
}
function linesFromPayload(row: Row, index: number): Row[] {
  if (row.itemGroup !== 'sofa' || !row.variants?.cells?.length) return [lineFromPayload(row, index)];
  const product = fixtures.products.find((p) => p.code === row.itemCode);
  const split = splitSofaBuildIntoModuleLines({ baseModel: product?.base_model, cells: row.variants.cells, buildUnitPriceSen: money(row, 'unitPrice'), buildUnitCostSen: 0, modulePrices: Object.fromEntries(fixtures.products.filter((p) => p.category === 'SOFA').map((p) => [p.code.replace('BOOQIT-', ''), p.sell_price_sen])), depth: row.variants.depth, evenSplitPrice: Number(row.variants.extraAddonAmountRM ?? 0) > 0 });
  if (!split?.length) return [lineFromPayload(row, index)];
  const { cells: _cells, ...variants } = row.variants;
  return Array.from({ length: row.qty }, (_, unit) => {
    const buildKey = uid(`build-${index}-${unit}`);
    return split.map((s, i) => lineFromPayload({ ...row, itemCode: s.itemCode, description: s.description, qty: 1, unitPriceSen: s.unitPriceSen, discountSen: i === 0 && unit === 0 ? money(row, 'discount') : 0, variants: { ...variants, buildKey, cellIndex: s.cellIndex, x: s.x, y: s.y, rot: s.rot } }, i));
  }).flat();
}
function paymentFromPayload(row: Row, deposit = false): Row {
  const amount = money(row, 'amount');
  return { id: uid('payment'), paid_at: row.paidAt ?? today(), method: row.method ?? 'cash', amount_sen: amount, amount_centi: amount, approval_code: row.approvalCode ?? null, merchant_provider: row.merchantProvider ?? null, online_type: row.onlineType ?? null, installment_months: row.installmentMonths ?? null, slip_key: row.uploadSessionId ? `demo-slips/${row.uploadSessionId}` : null, upload_session_id: row.uploadSessionId ?? null, is_deposit: deposit, collected_by: 'demo-sales', created_at: now() };
}
function refreshTotals(order: StoredOrder) {
  const total = order.items.reduce((sum, l) => sum + (l.cancelled ? 0 : l.total_sen), 0);
  const paid = order.payments.reduce((sum, p) => sum + p.amount_sen, 0);
  Object.assign(order.salesOrder, { total_revenue_sen: total, total_revenue_centi: total, paid_sen_total: paid, paid_centi_total: paid, paid_sen: paid, paid_centi: paid, balance_sen: Math.max(0, total - paid), balance_centi: Math.max(0, total - paid), line_count: order.items.length, updated_at: now() });
}
function createStoredOrder(body: Row, docNo: string): StoredOrder {
  const items: Row[] = (body.items ?? []).flatMap(linesFromPayload);
  if (body.applyDeliveryFee) {
    const fee = fixtures.deliveryFees.baseFee + Math.max(0, Number(body.additionalDeliveryFee ?? 0));
    if (fee) items.push(lineFromPayload({ itemCode: 'SVC-DELIVERY', itemGroup: 'service', description: 'Delivery fee', qty: 1, unitPriceSen: Math.round(fee * 100) }, items.length));
  }
  for (const a of body.addons ?? []) {
    const catalog = fixtures.addons.find((x) => x.id === a.id);
    if (!catalog) continue;
    const qty = catalog.kind === 'floors_items' ? Math.max(0, Number(a.floorsCount ?? 0) - 2) * Number(a.itemsCount ?? 0) : Number(a.qty ?? 1);
    items.push(lineFromPayload({ itemCode: catalog.serviceSku, itemGroup: 'service', description: catalog.label, qty, unitPriceSen: (catalog.perFloorItem ?? catalog.price) * 100 }, items.length));
  }
  const paymentBodies = body.payments?.length ? body.payments : money(body, 'deposit') > 0 ? [{ ...body, method: body.paymentMethod, amountSen: money(body, 'deposit') }] : [];
  const order: StoredOrder = {
    salesOrder: { doc_no: docNo, debtor_name: body.debtorName, phone: body.phone ?? null, email: body.email ?? null, customer_id: body.customerId ?? 'demo-customer', customer_type: body.customerType ?? 'NEW', address1: body.address1 ?? null, address2: body.address2 ?? null, city: body.city ?? null, postcode: body.postcode ?? null, customer_state: body.customerState ?? null, building_type: body.buildingType ?? null, bill_to_address: body.billToAddress ?? null, emergency_contact_name: body.emergencyContactName ?? null, emergency_contact_phone: body.emergencyContactPhone ?? null, emergency_contact_relationship: body.emergencyContactRelationship ?? null, customer_race: body.customerRace ?? null, customer_birthday: body.customerBirthday ?? null, customer_gender: body.customerGender ?? null, customer_delivery_date: body.customerDeliveryDate ?? body.targetDate ?? null, target_date: body.targetDate ?? null, processing_date: body.processingDate ?? body.internalExpectedDd ?? null, internal_expected_dd: body.processingDate ?? body.internalExpectedDd ?? null, payment_method: body.paymentMethod ?? 'cash', approval_code: body.approvalCode ?? null, signature_b64: body.signatureB64 ?? null, note: body.note ?? null, so_date: today(), created_at: now(), status: 'CONFIRMED', proceeded_at: null, salesperson_id: 'demo-sales', salesperson_name: 'Demo Sales', staff_name: 'Demo Sales', venue_id: body.venueId ?? 'demo-venue', venue: body.venue ?? 'Demo Showroom', has_children: false },
    items,
    payments: paymentBodies.map((p: Row) => paymentFromPayload(p, true)),
  };
  refreshTotals(order);
  return order;
}
function initialStore(): Store {
  const seed = createStoredOrder({ ...fixtures.demoCustomer, customerRace: 'Chinese', customerBirthday: '1990-01-01', customerGender: 'Male', paymentMethod: 'cash', depositSen: 149500, note: 'Fictional sample order — local simulation only.', items: [{ itemCode: 'AKKA-FIRM MATT (K)', itemGroup: 'mattress', description: '2990 AKKA-FIRM MATTRESS (183X190X31CM)', qty: 1, unitPriceSen: 299000, variants: { sizeId: 'king', size: 'K', sizeCode: 'K' } }] }, 'DEMO-SO-0000');
  return { version: 1, serial: 1, cart: { lines: [], sourceQuoteId: null }, orders: [seed], quotes: [], picks: [], pwp: clone(fixtures.demoRewardCodes), slips: {}, redemptions: [], idempotency: {} };
}
function getStore(): Store {
  if (memory) return memory;
  try {
    const raw = localStorage.getItem(SIMULATION_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Store;
      if (parsed.version === 1 && Array.isArray(parsed.orders)) {
        // Add new fictional exercise vouchers without resetting an existing
        // salesperson's demo order/payment evidence or reviving a used code.
        for (const code of fixtures.demoRewardCodes) if (!parsed.pwp.some((c) => c.code === code.code)) parsed.pwp.push(clone(code));
        return memory = parsed;
      }
    }
  } catch { /* unavailable or corrupt demo storage: start isolated fresh */ }
  return memory = initialStore();
}
function save() { try { localStorage.setItem(SIMULATION_STORAGE_KEY, JSON.stringify(getStore())); } catch { /* in-memory simulator still works with browser storage disabled */ } }
export function resetSimulation() { memory = initialStore(); audit.length = 0; save(); }
export function getSimulationAudit() { return audit.map((x) => ({ ...x })); }
export function getSimulationSnapshot() { return clone(getStore()); }

function validatePayment(row: Row, store: Store): string | null {
  const amount = money(row, 'amount');
  if (!PAYMENT_METHOD_CODES.includes(row.method) || !Number.isInteger(amount) || amount <= 0) return 'Choose a payment method and a positive amount.';
  if (row.method === 'merchant' && !fixtures.dropdownOptions.payment_merchant!.some((m) => m.value === row.merchantProvider)) return 'Select the payment merchant.';
  if (row.method === 'installment' && ![3, 6, 12].includes(Number(row.installmentMonths))) return 'Select an installment term of 3, 6 or 12 months.';
  if (row.method !== 'cash' && (!row.approvalCode?.trim() || !store.slips[row.uploadSessionId]?.confirmed)) return 'Each non-cash payment requires its own reference and confirmed local proof.';
  return null;
}
function dateIssue(header: Row, items: Row[]): Response | null {
  const process = header.processing_date ?? header.internal_expected_dd;
  const delivery = header.customer_delivery_date;
  if (!!process !== !!delivery) return failure('processing_delivery_must_pair', 'Processing and delivery dates must be entered together.');
  if (process && (process < today() || delivery < today())) return failure('processing_date_past', 'Processing and delivery dates cannot be in the past.');
  if (process && process > delivery) return failure('invalid_dates', 'Processing date cannot follow delivery date.');
  if (process) {
    const offenders = items.filter((l) => missingVariantAxes(l.item_group, l.variants).length).map((l) => ({ itemCode: l.item_code, group: l.item_group, missing: missingVariantAxes(l.item_group, l.variants).map((a) => a.key) }));
    if (offenders.length) return json({ error: 'variants_incomplete', offenders, simulation: true }, 409);
    if (!meetsProcessingDatePaymentGate(header.paid_sen_total, header.total_revenue_sen)) return failure('processing_date_deposit_required', 'At least 30% must be paid before setting the Processing Date.', 409);
  }
  return null;
}
function variantSurcharge(item: Row, variants: Row): number {
  const category = String(item.item_group).toUpperCase() as MfgPricingProduct['category'];
  const specials = fixtures.specialAddons.map((s) => ({ value: String(s.code), priceSen: 0, sellingPriceSen: Number(s.sellingPriceSen) }));
  const priced = computeMfgLinePrice({ product: { category, basePriceSen: null }, qty: 1, divanHeight: variants.divanHeight, legHeight: variants.legHeight, sofaLegHeight: variants.sofaLegHeight, totalHeight: variants.totalHeight, specials: variants.specials ?? [], fabric: { tier: null, surchargeSen: String(variants.fabricCode ?? variants.colourId ?? '').startsWith('EZ') ? 12500 : 0 } }, { ...fixtures.maintenance, specials, sofaSpecials: specials });
  return priced.unitPriceSen + Math.round(Number(variants.extraAddonAmountRM ?? 0) * 100);
}
function itemEditIssue(order: StoredOrder): Response | null {
  if (order.salesOrder.status !== 'CONFIRMED') return failure('so_locked', 'Only a confirmed, editable order can change products.', 409);
  if (order.salesOrder.processing_date && order.salesOrder.processing_date < today()) return failure('so_locked_processing', 'The Processing Date has passed; products and dates are locked.', 409);
  return null;
}
function filteredProducts(params: URLSearchParams) {
  return fixtures.products.filter((p) => (!params.get('id') || p.id === params.get('id')) && (!params.get('modelId') || p.model_id === params.get('modelId')) && (!params.get('baseModel') || p.base_model === params.get('baseModel')) && (!params.get('category') || p.category === params.get('category')) && (!params.get('search') || `${p.name} ${p.code}`.toLowerCase().includes(params.get('search')!.toLowerCase())));
}
function catalogPhotos(rows: typeof fixtures.products) {
  const origin = typeof location === 'undefined' ? 'http://localhost' : location.origin;
  return rows.map((p) => ({ ...p, product_models: { ...p.product_models, photo_url: `${origin}/catalog/${p.category === 'SOFA' ? 'sofa-5539.jpg' : p.category === 'MATTRESS' ? 'mattress-2990s-firm.jpg' : p.category === 'BEDFRAME' ? 'bedframe-khj57.png' : 'mattress-bed.png'}` } }));
}

async function dispatch(path: string, params: URLSearchParams, method: string, body: Row, headers: Headers, rawBody: string): Promise<Response> {
  const store = getStore();
  if (path === '/simulation/audit') return json(getSimulationAudit());
  if (path === '/simulation/reset' && method === 'POST') { resetSimulation(); return json({ ok: true }); }
  if (path === '/auth/me') return json({ user: { id: 'demo-sales', name: 'Demo Sales', permissions: [], capabilities: { 'org.sales.staff': true, 'scm.sales.viewAll': false }, scmConfigWriter: false } });
  if (path === '/staff' || path === '/staff/pickable' || path === '/pos/sales-staff') return json({ staff: [fixtures.SIMULATION_STAFF] });
  if (path === '/pos/verify-pin' || path === '/pos/set-pin' || path === '/pos/my-pin') return json({ ok: true, valid: true });
  if (path === '/categories') return json({ categories: fixtures.categories });
  if (path === '/products') return json({ products: [] }); // Actual mfg catalogue is authoritative.
  if (path === '/pos-pools/mfg-catalog') return json({ products: catalogPhotos(filteredProducts(params)) });
  if (path === '/mfg-products') return json({ products: filteredProducts(params) });
  if (path === '/product-models') return json({ models: fixtures.models.filter((m) => !params.get('category') || m.category === params.get('category')) });
  if (/^\/product-models\/[^/]+$/.test(path) && method === 'GET') {
    const model = fixtures.models.find((m) => m.id === path.split('/')[2]);
    return model ? json({ model, skus: fixtures.products.filter((p) => p.model_id === model.id) }) : failure('not_found', 'Demo model not found.', 404);
  }
  if (/^\/mfg-products\/[^/]+\/price-history$/.test(path)) return json({ history: [] });
  if (path === '/fabric-library') return json({ fabrics: fixtures.fabrics });
  if (path === '/fabric-colours') return json({ colours: fixtures.fabricColours });
  if (path === '/pos-pools/size-library') return json({ rows: fixtures.sizeLibrary });
  if (path === '/maintenance-config/resolved') return json({ data: fixtures.maintenance, effectiveFrom: '2020-01-01', hasPendingPriceChange: false, pendingEffectiveFrom: null });
  if (path === '/pos-pools/sofa-combos' || path === '/sofa-combos') return json({ rules: fixtures.combos });
  if (path === '/sofa-quick-picks') return json({ picks: fixtures.quickPicks });
  if (path.startsWith('/personal-quick-picks')) {
    if (method === 'POST') { const pick = { ...body, id: uid('pick'), modules: body.modules.map((m: string | string[]) => Array.isArray(m) ? m : [m]), sortOrder: store.picks.length, createdAt: now() }; store.picks.push(pick); save(); return json(pick, 201); }
    if (method === 'DELETE') { store.picks = store.picks.filter((p) => p.id !== path.split('/')[2]); save(); return json({ ok: true }); }
    return json({ picks: store.picks.filter((p) => !params.get('baseModel') || p.baseModel === params.get('baseModel')) });
  }
  if (['/pos-pools/bedframe-colours', '/pos-pools/bedframe-options', '/pos-pools/product-bundles', '/pos-pools/product-compartments', '/pos-pools/product-fabrics', '/pos-pools/product-bedframe-colours', '/pos-pools/product-size-variants'].includes(path)) return json({ rows: [] }); // Legacy UUID pools are unused by these mfg fixtures.
  if (path === '/special-addons') return json({ addons: fixtures.specialAddons });
  if (path === '/addons') return json({ addons: fixtures.addons });
  if (path === '/model-free-gifts') return json(fixtures.modelGifts);
  if (path === '/free-item-campaigns') return json(fixtures.freeItemCampaigns);
  if (path === '/delivery-fees') return json(fixtures.deliveryFees);
  if (path === '/fabric-tier-addon') return json(fixtures.tierFees);
  if (['/delivery-fees/special', '/fabric-tier-addon/special', '/fabric-tier-addon/compartment-special'].includes(path)) return json([]);
  if (path === '/so-dropdown-options') return json({ options: fixtures.dropdownOptions });
  if (path === '/so-settings') return json({ settings: [] });
  if (path === '/localities') return json({ localities: fixtures.localities });
  if (path === '/venues') return json({ venues: fixtures.venues });
  if (path === '/inventory/warehouses') return json({ warehouses: [{ id: 'demo-warehouse', name: 'Demo Warehouse', code: 'DEMO', active: true }] });
  if (path === '/state-warehouse-mappings') return json({ mappings: [] });
  if (path === '/mfg-sales-orders/active-venue') return json({ venueId: 'demo-venue', venueName: 'Demo Showroom', projectName: null, source: 'SHOWROOM' });
  if (path === '/pos-cart') {
    if (method === 'PUT') { store.cart = { lines: clone(body.lines ?? []), sourceQuoteId: body.sourceQuoteId ?? null }; save(); }
    return json(store.cart);
  }
  if (path === '/pwp-rules') return json({ rules: fixtures.pwpRules });
  if (path === '/pwp-codes/mine') return json({ codes: store.pwp.filter((p) => p.status === 'RESERVED') });
  if (path.startsWith('/pwp-codes/by-so/')) return json({ codes: store.pwp.filter((p) => p.sourceDocNo === decodeURIComponent(path.split('/').pop()!)) });
  if (path === '/pwp-codes/reserve') {
    if (method === 'DELETE') { store.pwp = store.pwp.filter((p) => p.cartLineKey !== params.get('cartLineKey') || p.status === 'USED'); save(); return json({ ok: true }); }
    const product = fixtures.products.find((p) => p.id === body.productId);
    const desired = product?.category === 'MATTRESS' && !body.rewardLine ? Math.max(0, Number(body.qty)) : 0;
    const current = store.pwp.filter((p) => p.cartLineKey === body.cartLineKey && p.status === 'RESERVED');
    for (let n = current.length; n < desired; n++) store.pwp.push({ ...clone(fixtures.demoPwp), code: `PWP-DEMO-${store.serial++}`, status: 'RESERVED', cartLineKey: body.cartLineKey, triggerItemCode: product!.code });
    if (desired < current.length) { const remove = new Set(current.slice(desired).map((p) => p.code)); store.pwp = store.pwp.filter((p) => !remove.has(p.code)); }
    save(); return json({ codes: store.pwp.filter((p) => p.cartLineKey === body.cartLineKey && p.status === 'RESERVED') });
  }
  if (path.startsWith('/pwp-codes/')) {
    const code = store.pwp.find((p) => p.code === decodeURIComponent(path.split('/')[2]!).toUpperCase());
    const valid = !!code && ['AVAILABLE', 'RESERVED'].includes(code.status) && (!params.get('rewardCategory') || params.get('rewardCategory') === code.rewardCategory) && (!params.get('rewardModelId') || code.eligibleRewardModelIds.includes(params.get('rewardModelId'))) && (!params.get('rewardComboId') || !code.rewardComboIds.length || code.rewardComboIds.includes(params.get('rewardComboId')));
    const scope = code ? { rewardCategory: code.rewardCategory, eligibleRewardModelIds: code.eligibleRewardModelIds, rewardComboIds: code.rewardComboIds, status: code.status, type: code.type } : {};
    return json(valid ? { ...scope, valid: true, pwpPriceSen: code!.type === 'promo' ? 0 : code!.rewardCategory === 'SOFA' ? 199000 : 149000, customerMatches: true } : { ...scope, valid: false, reason: !code ? 'No such PWP code.' : code.status === 'USED' ? 'This PWP code has already been used.' : `This code is for an eligible ${code.rewardCategory.toLowerCase()}.` });
  }
  if (path === '/campaign-promos') return json({ campaigns: fixtures.campaigns.map((c) => { const stockUsed = store.redemptions.filter((r) => r.campaign_id === c.id && r.status !== 'RELEASED').length; return { ...c, stockUsed, remaining: c.stockTotal - stockUsed }; }) });
  if (path === '/campaign-promos/redemptions') return json({ redemptions: store.redemptions });
  if (/^\/campaign-promos\/[^/]+\/claim$/.test(path) && method === 'POST') {
    const campaign = fixtures.campaigns.find((c) => c.id === path.split('/')[2]);
    if (!campaign) return failure('campaign_unavailable', 'Unknown local demo voucher.');
    const remaining = campaign.stockTotal - store.redemptions.filter((r) => r.campaign_id === campaign.id && r.status !== 'RELEASED').length;
    const fingerprint = JSON.stringify(store.cart.lines);
    const outstanding = store.redemptions.filter((r) => r.campaign_id === campaign.id && r.status === 'RESERVED' && r.cart_fingerprint === fingerprint).length;
    if (outstanding >= campaign.maxPerOrder) return failure('campaign_limit', 'This order already has its maximum voucher reservation.', 409);
    const lines = store.cart.lines.map((line) => {
      const cfg = line.config ?? {};
      const isSofa = cfg.kind === 'sofa';
      const product = fixtures.products.find((p) => p.id === cfg.productId);
      const split = isSofa ? splitSofaBuildIntoModuleLines({ baseModel: product?.base_model, cells: cfg.cells, buildUnitPriceSen: Number(cfg.total ?? 0) * 100, buildUnitCostSen: 0, modulePrices: Object.fromEntries(fixtures.products.filter((p) => p.category === 'SOFA').map((p) => [p.code.replace('BOOQIT-', ''), p.sell_price_sen])), depth: cfg.depth, evenSplitPrice: Number(cfg.extraAddonAmountRM ?? 0) > 0 }) : null;
      return { key: line.key, qty: line.qty, lineTotalCenti: Number(cfg.total ?? 0) * Number(line.qty) * 100, isSofaBuild: isSofa, ...(split?.[0] ? { sofaLeadModuleCenti: split[0].unitPriceSen } : {}) };
    });
    const plan = planVoucher({ ...campaign, remaining }, lines);
    if (!plan.ok) return failure('campaign_unavailable', plan.message, 409);
    if (body.appliedCenti !== plan.appliedCenti) return failure('campaign_amount_changed', 'The voucher amount no longer matches this cart.', 409);
    const r = { id: uid('redemption'), campaign_id: campaign.id, status: 'RESERVED', applied_centi: plan.appliedCenti, terms_snapshot: campaign.terms, created_at: now(), cart_fingerprint: fingerprint };
    store.redemptions.push(r); save(); return json({ redemptionId: r.id, appliedCenti: r.applied_centi, termsSnapshot: campaign.terms });
  }
  if (/^\/campaign-promos\/redemptions\/[^/]+\/(confirm|release)$/.test(path)) {
    const row = store.redemptions.find((r) => r.id === path.split('/')[3]);
    if (!row) return failure('not_found', 'Local voucher reservation not found.', 404);
    Object.assign(row, path.endsWith('/confirm') ? { status: 'APPLIED', so_doc_no: body.soDocNo, customer_name: body.customerName, customer_phone: body.customerPhone } : { status: 'RELEASED', release_reason: body.reason, released_at: now() }); save(); return json({ ok: true });
  }
  if (path === '/quotes' || path.startsWith('/quotes/')) {
    const id = path.split('/')[2];
    if (method === 'GET') return json({ quotes: store.quotes });
    if (method === 'POST') { const quote = { id: uid('quote'), created_by: 'demo-sales', showroom_id: 'demo-showroom', customer_name: body.customerName, customer_phone: body.customerPhone ?? null, customer_email: body.customerEmail ?? null, cart: body.cart, addons: [], subtotal: body.subtotal, addon_total: 0, total: body.total, pricing_version: 'simulation', expires_at: null, promoted_to_order_id: null, created_at: now(), updated_at: now() }; store.quotes.push(quote); save(); return json(quote, 201); }
    if (method === 'DELETE') store.quotes = store.quotes.filter((q) => q.id !== id);
    if (method === 'PATCH') { const quote = store.quotes.find((q) => q.id === id); if (quote) Object.assign(quote, body, { updated_at: now() }); }
    save(); return json({ ok: true });
  }
  if (path === '/slips/init' && method === 'POST') { const id = uid('slip'); store.slips[id] = { ...body, uploaded: false, confirmed: false }; save(); return json({ uploadSessionId: id, r2Key: `demo-slips/${id}`, putUrl: `/api/scm/slips/${id}/upload` }); }
  if (/^\/slips\/[^/]+\/(upload|confirm)$/.test(path)) {
    const slip = store.slips[path.split('/')[2]!];
    if (!slip) return failure('slip_not_found', 'Local upload session not found.', 404);
    if (path.endsWith('/upload')) { slip.uploaded = true; save(); return json({ ok: true }); }
    if (!slip.uploaded) return failure('slip_not_uploaded', 'Attach a local demonstration proof first.');
    slip.confirmed = true; save(); return json({ ok: true, uploadSessionId: path.split('/')[2], r2Key: `demo-slips/${path.split('/')[2]}` });
  }
  if (path === '/mfg-sales-orders/customer-search') return json({ customers: fixtures.demoCustomer.debtorName.toLowerCase().includes((params.get('name') ?? '').toLowerCase()) ? [fixtures.demoCustomer] : [] });
  if (path === '/mfg-sales-orders/mine') {
    const search = (params.get('q') ?? '').toLowerCase();
    const orders = store.orders.filter(({ salesOrder: o }) => search ? `${o.doc_no} ${o.debtor_name} ${o.phone}`.toLowerCase().includes(search) : (!params.get('from') || o.so_date >= params.get('from')!) && (!params.get('to') || o.so_date <= params.get('to')!));
    return json({ salesOrders: orders.slice().reverse().map((o) => ({ ...o.salesOrder, items: o.items })) });
  }
  if (path === '/pos/sales-stats') {
    const from = params.get('from');
    const to = params.get('to');
    const myNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const bounds = from || to ? rangeBoundsMy(from, to) : monthBoundsMy(myNow.getUTCFullYear(), myNow.getUTCMonth());
    const orders = store.orders.filter(({ salesOrder: order }) =>
      !['CANCELLED', 'ON_HOLD', 'DRAFT'].includes(order.status)
      && (!bounds.startUtc || order.created_at >= bounds.startUtc)
      && (!bounds.endUtc || order.created_at < bounds.endUtc),
    );
    const total = orders.reduce((sum, order) => sum + order.salesOrder.total_revenue_sen / 100, 0);
    const service = orders.reduce((sum, order) => sum + order.items.reduce((lineSum, item) => lineSum + (!item.cancelled && item.item_group === 'service' ? item.total_sen / 100 : 0), 0), 0);
    const products = Math.max(0, total - service);
    return json({ monthLabel: bounds.label, monthStart: bounds.startUtc, monthEnd: bounds.endUtc, staffName: 'Demo Sales', showroomScope: 'showroom', showroomTotal: total, showroomCount: orders.length, personalTotal: total, personalCount: orders.length, showroomProducts: products, showroomService: service, showroomKpi: 0, personalProducts: products, personalService: service, personalKpi: 0 });
  }
  if (path === '/mfg-sales-orders/cross-category-eligibility') {
    const match = store.orders.find((o) => o.salesOrder.doc_no === params.get('docNo') && o.salesOrder.phone === params.get('phone'));
    return json({ eligible: !!match, debtorName: match?.salesOrder.debtor_name ?? null, message: match ? null : 'No matching earlier local order for this phone number.' });
  }
  if (path === '/mfg-sales-orders/cross-category-match') {
    const match = store.orders.slice().reverse().find((o) => o.salesOrder.debtor_name.toLowerCase() === params.get('name')?.toLowerCase() && o.salesOrder.phone === params.get('phone'));
    return json({ found: !!match, docNo: match?.salesOrder.doc_no, debtorName: match?.salesOrder.debtor_name });
  }
  if (path === '/mfg-sales-orders' && method === 'POST') {
    const idempotency = headers.get('Idempotency-Key');
    const previous = idempotency ? store.idempotency[idempotency] : undefined;
    if (previous) return previous.body === rawBody ? json({ docNo: previous.docNo }) : failure('idempotency_key_reused', 'Different payload under the same demo request key.', 409);
    if (!String(body.debtorName ?? '').trim() || !Array.isArray(body.items) || !body.items.length) return failure('invalid_order', 'Customer and at least one configured item are required.');
    if (!!body.customerDeliveryDate !== !!(body.processingDate ?? body.internalExpectedDd)) return failure('processing_delivery_must_pair', 'Processing and delivery dates must be entered together.');
    if (body.processingDate && body.processingDate > body.customerDeliveryDate) return failure('invalid_dates', 'Processing date cannot follow delivery date.');
    if (body.processingDate || body.internalExpectedDd) {
      const offenders = body.items.filter((l: Row) => missingVariantAxes(l.itemGroup, l.variants).length).map((l: Row) => ({ itemCode: l.itemCode, group: l.itemGroup, missing: missingVariantAxes(l.itemGroup, l.variants).map((a) => a.key) }));
      if (offenders.length) return json({ error: 'variants_incomplete', offenders, simulation: true }, 409);
    }
    for (const l of body.items) if (!Number.isFinite(money(l, 'unitPrice')) || Number(l.qty) <= 0 || money(l, 'unitPrice') < 0 || money(l, 'discount') > Number(l.qty) * money(l, 'unitPrice')) return failure('invalid_items', 'Check quantity, price and discount.');
    const usedCodes = new Set<string>();
    for (const line of body.items) {
      const product = fixtures.products.find((p) => p.code === line.itemCode);
      const freeId = line.variants?.freeItem?.campaignId;
      if (freeId) {
        const applicable = campaignsCoveringLine({ category: line.itemGroup, modelId: product?.model_id ?? null, sizeCode: product?.size_code ?? null, builtModuleIds: (line.variants?.cells ?? []).map((c: Row) => c.moduleId) }, fixtures.freeItemCampaigns, new Map(fixtures.combos.map((c) => [c.id, c.modules]))).find((c) => c.id === freeId);
        if (!applicable || line.qty > applicable.maxFreeQty || money(line, 'unitPrice') !== 0) return failure('free_item_not_eligible', 'This item or quantity does not qualify for the selected free-item campaign.');
        if (line.variants?.pwpCode) return failure('free_and_pwp_exclusive', 'A free item and a voucher reward cannot be applied to the same line.');
        line.variants.freeItem.campaignName = applicable.name;
      }
      const code = line.variants?.pwpCode;
      if (!code) continue;
      const voucher = store.pwp.find((p) => p.code === code);
      if (!voucher || voucher.status === 'USED' || usedCodes.has(code) || line.qty !== 1 || line.itemGroup.toUpperCase() !== voucher.rewardCategory || !voucher.eligibleRewardModelIds.includes(product?.model_id)) return failure('pwp_code_rejected', 'One available code may be used for one eligible reward only.');
      if (voucher.rewardComboIds.length && !fixtures.combos.some((c) => voucher.rewardComboIds.includes(c.id) && matchComboSubset((line.variants?.cells ?? []).map((cell: Row) => cell.moduleId), c.modules))) return failure('pwp_code_rejected', 'Choose a sofa layout covered by this voucher.');
      usedCodes.add(code);
    }
    const triggers = buildFreeGiftTriggers(body.items.map((line: Row, i: number) => {
      const p = fixtures.products.find((p) => p.code === line.itemCode);
      return { triggerKey: line.cartLineKey ?? `line-${i}`, itemCode: line.itemCode, category: line.itemGroup.toUpperCase(), qty: line.qty, modelId: p?.model_id ?? null, sizeCode: p?.size_code ?? null, buildKey: line.cartLineKey ?? `line-${i}`, isFreeGift: !!line.variants?.freeGift, builtCompartments: (line.variants?.cells ?? []).map((c: Row) => c.moduleId), gifts: fixtures.modelGifts.find((g) => g.modelId === p?.model_id)?.gifts ?? [] };
    }));
    const claims = body.items.flatMap((line: Row, idx: number) => line.variants?.freeGift ? [{ idx, giftProductId: line.variants.freeGift.giftProductId, qty: line.qty }] : []);
    if (validateFreeGiftClaims(claims, triggers).rejected.length) return failure('free_gift_not_eligible', 'The included gift no longer matches its qualifying product.');
    const payments: Row[] = body.payments?.length ? body.payments : money(body, 'deposit') ? [{ ...body, method: body.paymentMethod, amountSen: money(body, 'deposit') }] : [];
    for (const p of payments) { const issue = validatePayment(p, store); if (issue) return failure('invalid_payments', issue); }
    const docNo = `DEMO-SO-${String(store.serial++).padStart(4, '0')}`;
    const order = createStoredOrder(body, docNo);
    const paid = order.salesOrder.paid_sen_total;
    if (paid < Math.ceil(order.salesOrder.total_revenue_sen * 0.5) || paid > order.salesOrder.total_revenue_sen) return failure('invalid_deposit', 'Collect between 50% and 100% of the payable total.');
    const dates = dateIssue(order.salesOrder, order.items); if (dates) return dates;
    if (meetsProceedGate({ hasCustomerName: !!order.salesOrder.debtor_name, hasEmail: !!order.salesOrder.email, hasAddress: !!order.salesOrder.address1, hasPostcode: !!order.salesOrder.postcode, hasDeliveryDate: !!order.salesOrder.customer_delivery_date, paid, total: order.salesOrder.total_revenue_sen })) order.salesOrder.proceeded_at = now();
    store.orders.push(order);
    for (const code of store.pwp) {
      const consumed = body.items.some((it: Row) => it.variants?.pwpCode === code.code || it.variants?.pwp?.code === code.code);
      if (consumed) Object.assign(code, { status: 'USED', sourceDocNo: docNo });
      else if (code.status === 'RESERVED') Object.assign(code, { status: 'AVAILABLE', sourceDocNo: docNo, cartLineKey: null });
    }
    if (idempotency) store.idempotency[idempotency] = { body: rawBody, docNo };
    save(); return json({ docNo, simulation: true }, 201);
  }
  const orderMatch = /^\/mfg-sales-orders\/([^/]+)(?:\/(.*))?$/.exec(path);
  if (orderMatch) {
    const order = store.orders.find((o) => o.salesOrder.doc_no === decodeURIComponent(orderMatch[1]!));
    if (!order) return failure('not_found', 'No local demo order has this number.', 404);
    const rest = orderMatch[2];
    if (!rest && method === 'GET') return json({ salesOrder: order.salesOrder, items: order.items, hasDownstream: false, pwpCodes: store.pwp.filter((p) => p.sourceDocNo === order.salesOrder.doc_no) });
    if (!rest && method === 'PATCH') {
      const map: Record<string, string> = { debtorName: 'debtor_name', phone: 'phone', email: 'email', address1: 'address1', address2: 'address2', city: 'city', postcode: 'postcode', customerState: 'customer_state', customerDeliveryDate: 'customer_delivery_date', internalExpectedDd: 'internal_expected_dd', processingDate: 'processing_date', note: 'note', proceededAt: 'proceeded_at', approvalCode: 'approval_code', buildingType: 'building_type', emergencyContactName: 'emergency_contact_name', emergencyContactPhone: 'emergency_contact_phone', emergencyContactRelationship: 'emergency_contact_relationship' };
      const next = { ...order.salesOrder };
      for (const [key, column] of Object.entries(map)) if (key in body) next[column] = body[key];
      if (body.processingDate !== undefined || body.internalExpectedDd !== undefined) next.processing_date = next.internal_expected_dd = body.processingDate ?? body.internalExpectedDd;
      const hasDateChange = ['processingDate', 'internalExpectedDd', 'customerDeliveryDate'].some((key) => key in body);
      if (hasDateChange || body.proceededAt) { const issue = dateIssue(next, order.items); if (issue) return issue; }
      if (body.proceededAt && !meetsProceedGate({ hasCustomerName: !!next.debtor_name, hasEmail: !!next.email, hasAddress: !!next.address1, hasPostcode: !!next.postcode, hasDeliveryDate: !!next.customer_delivery_date, paid: next.paid_sen_total, total: next.total_revenue_sen })) return failure('proceed_incomplete', 'Complete customer details, address, delivery date and 50% payment before proceeding.', 409);
      order.salesOrder = next;
      refreshTotals(order); save(); return json({ ok: true, deliveryRedetected: false });
    }
    if (rest === 'payments') {
      if (method === 'GET') return json({ payments: order.payments });
      const issue = validatePayment(body, store); if (issue) return failure('invalid_payment', issue);
      if (money(body, 'amount') > order.salesOrder.balance_sen) return failure('overpayment', 'Amount is more than the remaining balance.', 409);
      order.payments.push(paymentFromPayload(body)); refreshTotals(order); save(); return json({ ok: true }, 201);
    }
    if (rest === 'items' && method === 'POST') {
      const blocked = itemEditIssue(order); if (blocked) return blocked;
      const additions = linesFromPayload(body, order.items.length);
      const issue = dateIssue(order.salesOrder, [...order.items, ...additions]); if (issue) return issue;
      order.items.push(...additions); refreshTotals(order); save(); return json({ ok: true }, 201);
    }
    if (rest?.startsWith('items/')) {
      const blocked = itemEditIssue(order); if (blocked) return blocked;
      const [_, itemId, action] = rest.split('/');
      const item = order.items.find((i) => i.id === itemId); if (!item) return failure('item_not_found', 'Local order item not found.', 404);
      if (action === 'tbc-update') {
        const variants = { ...item.variants, ...body.variants };
        if (order.salesOrder.processing_date && missingVariantAxes(item.item_group, variants).length) return failure('variants_incomplete', 'Remove the dates before returning required variants to Confirm later.', 409);
        const delta = variantSurcharge(item, variants) - variantSurcharge(item, item.variants);
        if (delta < 0) return failure('price_floor', 'The edited variants cannot reduce this booked item below its current price.', 409);
        const members = item.variants.buildKey ? order.items.filter((l) => l.variants?.buildKey === item.variants.buildKey) : [item];
        for (const member of members) {
          member.variants = { ...member.variants, ...body.variants };
          member.description2 = buildVariantSummary(member.item_group, member.variants) || null;
        }
        item.unit_price_sen += delta;
        item.unit_price_centi = item.unit_price_sen;
        item.total_sen = item.qty * item.unit_price_sen - item.discount_sen;
        item.total_centi = item.total_sen;
      }
      else if (action === 'tbc-swap') {
        const p = fixtures.products.find((p) => p.code === body.itemCode);
        if (!p || p.category === 'SOFA') return failure('product_not_eligible', 'Choose an active non-sofa product.', 409);
        const reward = item.variants.pwpCode ? store.pwp.find((c) => c.code === item.variants.pwpCode) : null;
        if (reward && (reward.rewardCategory !== p.category || !reward.eligibleRewardModelIds.includes(p.model_id))) return failure('pwp_line_locked', 'The replacement must stay within this voucher’s eligible range.', 409);
        const nextVariants = { ...item.variants, ...(p.size_code ? { sizeId: p.size_code === 'K' ? 'king' : 'queen' } : {}) };
        const base = reward ? reward.type === 'promo' ? 0 : p.pwp_price_sen ?? 0 : p.sell_price_sen;
        const price = base + variantSurcharge({ ...item, item_group: p.category.toLowerCase() }, nextVariants);
        if (price < item.unit_price_sen) return failure('so_total_below_original', 'The replacement cannot reduce the original sales order total.', 409);
        Object.assign(item, { item_code: p.code, item_group: p.category.toLowerCase(), description: p.name, description2: buildVariantSummary(p.category, nextVariants), unit_price_sen: price, unit_price_centi: price, total_sen: price * item.qty - item.discount_sen, total_centi: price * item.qty - item.discount_sen, variants: nextVariants });
      }
      else if (action === 'tbc-swap-sofa') {
        if (!body.item?.itemCode || body.item.itemGroup !== 'sofa') return failure('item_code_required', 'The replacement sofa build is missing.');
        const oldMembers = item.variants.buildKey ? order.items.filter((l) => l.variants?.buildKey === item.variants.buildKey) : [item];
        const oldTotal = oldMembers.reduce((sum, l) => sum + l.total_sen, 0);
        const replacements = linesFromPayload(body.item, order.items.length);
        if (replacements.reduce((sum, l) => sum + l.total_sen, 0) < oldTotal) return failure('so_total_below_original', 'The replacement cannot reduce the original sales order total.', 409);
        const oldIds = new Set(oldMembers.map((l) => l.id));
        const nextItems = order.items.filter((l) => !oldIds.has(l.id));
        nextItems.push(...replacements);
        const issue = dateIssue(order.salesOrder, nextItems); if (issue) return issue;
        order.items = nextItems;
      }
      else return failure('simulation_route_missing', `${method} ${path} has not been implemented.`, 501);
      refreshTotals(order); save(); return json({ ok: true, item });
    }
  }
  return failure('simulation_route_missing', `${method} ${path} has not been implemented. No network request was made.`, 501);
}

export async function handleSimulationRequest(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const source = input instanceof Request ? input.url : String(input);
  const url = new URL(source, typeof location === 'undefined' ? 'http://localhost' : location.origin);
  const path = url.pathname.replace(/^\/simulation/, '').replace(/^\/api\/scm(?=\/|$)/, '').replace(/^\/api(?=\/|$)/, '') || '/';
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  let rawBody = typeof init?.body === 'string' ? init.body : '';
  if (!rawBody && input instanceof Request && !['GET', 'HEAD'].includes(method) && input.headers.get('content-type')?.includes('json')) rawBody = await input.clone().text();
  let body: Row = {};
  try { if (rawBody) body = JSON.parse(rawBody) as Row; } catch { const r = failure('invalid_json', 'The local simulator expected a JSON body.'); audit.push({ method, path, status: r.status }); return r; }
  let response: Response;
  try { response = await dispatch(path, url.searchParams, method, body, headers, rawBody); }
  catch (error) { response = failure('simulation_error', error instanceof Error ? error.message : String(error), 500); }
  audit.push({ method, path, status: response.status });
  if (audit.length > 300) audit.shift();
  return response;
}
