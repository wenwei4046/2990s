import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildFreeGiftTriggers, computeDesiredFreeGifts } from '@2990s/shared';
import { buildDefaultSofaCells } from '@2990s/shared/sofa-build';
import { groupSoLinesForDisplay } from '@2990s/shared/so-line-display';
import { handleSimulationRequest as request, getSimulationSnapshot, resetSimulation, SIMULATION_STORAGE_KEY } from './api';
import { DEMO_PWP_CODE, modelGifts } from './fixtures';

const send = (path: string, method = 'GET', body?: unknown, headers?: HeadersInit) => request(`/api/scm${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const validOrder = () => ({ debtorName: 'Demo Customer', phone: '+60120000000', email: 'demo@example.test', address1: '1 Demo Lane', customerState: 'Selangor', city: 'Petaling Jaya', postcode: '47300', paymentMethod: 'cash', depositSen: 149500, applyDeliveryFee: true, items: [{ itemCode: 'AKKA-FIRM MATT (K)', itemGroup: 'mattress', qty: 1, unitPriceSen: 299000, variants: { sizeId: 'king' } }] });

beforeEach(() => { localStorage.clear(); resetSimulation(); });

describe('isolated mobile POS simulation', () => {
  it('initializes the catalog on a same-Wi-Fi HTTP origin without secure-context randomUUID', async () => {
    const randomUuid = vi.spyOn(crypto, 'randomUUID').mockImplementation(() => { throw new Error('not used'); });
    const original = Object.getOwnPropertyDescriptor(crypto, 'randomUUID');
    Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined });
    try {
      resetSimulation();
      const catalog = await send('/pos-pools/mfg-catalog');
      expect(catalog.status).toBe(200);
      expect((await catalog.json()).products.length).toBeGreaterThan(0);
      expect(getSimulationSnapshot().orders[0]!.items[0]!.id).toMatch(/^demo-line-0-[a-f0-9]{32}$/);
    } finally {
      if (original) Object.defineProperty(crypto, 'randomUUID', original);
      randomUuid.mockRestore();
    }
  });

  it('serves contract-shaped catalog and rejects unknown endpoints without network access', async () => {
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network allowed'));
    try {
      const catalog = await (await send('/pos-pools/mfg-catalog?modelId=demo-model-akka')).json();
      expect(catalog.products.map((p: { sell_price_sen: number }) => p.sell_price_sen)).toEqual([299000, 299000]);
      expect((await send('/no-such-endpoint')).status).toBe(501);
      expect((await request('https://production.invalid/api/scm/no-such-endpoint')).status).toBe(501);
      expect(network).not.toHaveBeenCalled();
    } finally { network.mockRestore(); }
  });

  it('persists cart and quote edits in a simulation-only storage key', async () => {
    await send('/pos-cart', 'PUT', { lines: [{ key: 'draft-1', qty: 1 }], sourceQuoteId: null });
    const quote = await (await send('/quotes', 'POST', { customerName: 'Demo', cart: [{ key: 'draft-1' }], subtotal: 2990, total: 2990 })).json();
    await send(`/quotes/${quote.id}`, 'PATCH', { total: 4605 });
    const storage = JSON.parse(localStorage.getItem(SIMULATION_STORAGE_KEY)!);
    expect(storage.cart.lines[0].key).toBe('draft-1');
    expect(storage.quotes[0].total).toBe(4605);
    expect(Object.keys(localStorage)).toEqual([SIMULATION_STORAGE_KEY]);
  });

  it('creates once, replays retries, exposes all items in My Orders, then records the balance', async () => {
    const body = validOrder();
    const first = await send('/mfg-sales-orders', 'POST', body, { 'Idempotency-Key': 'same-intent' });
    expect(first.status).toBe(201);
    const { docNo } = await first.json();
    expect(docNo).toMatch(/^DEMO-SO-/);
    const replay = await (await send('/mfg-sales-orders', 'POST', body, { 'Idempotency-Key': 'same-intent' })).json();
    expect(replay.docNo).toBe(docNo);
    expect(getSimulationSnapshot().orders).toHaveLength(2); // one fictional seed + one new order
    const list = await (await send('/mfg-sales-orders/mine')).json();
    expect(list.salesOrders[0].items[0].item_code).toBe('AKKA-FIRM MATT (K)');
    expect(list.salesOrders[0].paid_sen_total).toBe(149500);
    expect((await send(`/mfg-sales-orders/${docNo}/payments`, 'POST', { method: 'cash', amountSen: 149500 })).status).toBe(201);
    const detail = await (await send(`/mfg-sales-orders/${docNo}`)).json();
    expect(detail.salesOrder.balance_sen).toBe(0);
    expect(detail.salesOrder.paid_sen_total).toBe(299000);
    const ledger = await (await send(`/mfg-sales-orders/${docNo}/payments`)).json();
    expect(ledger.payments.map((p: { amount_sen: number }) => p.amount_sen)).toEqual([149500, 149500]);
    expect((await send(`/mfg-sales-orders/${docNo}/payments`, 'POST', { method: 'cash', amountSen: 1 })).status).toBe(409);
  });

  it('keeps a split payment separate, validates its own local proof and counts the complete ledger', async () => {
    const init = await (await send('/slips/init', 'POST', { fileSize: 12, contentType: 'image/png', contentHash: 'demo-hash' })).json();
    const cash = { method: 'cash', amountSen: 100000 };
    const merchant = { method: 'merchant', amountSen: 199000, approvalCode: 'DEMO-TERMINAL', merchantProvider: 'GHL', uploadSessionId: init.uploadSessionId };
    const body = { ...validOrder(), payments: [cash, merchant] };
    expect((await send('/mfg-sales-orders', 'POST', body)).status).toBe(400);
    await request(`/api/scm/slips/${init.uploadSessionId}/upload`, { method: 'POST', body: new Blob(['demo proof']) });
    await send(`/slips/${init.uploadSessionId}/confirm`, 'POST');
    const created = await send('/mfg-sales-orders', 'POST', body);
    expect(created.status).toBe(201);
    const { docNo } = await created.json();
    const ledger = await (await send(`/mfg-sales-orders/${docNo}/payments`)).json();
    expect(ledger.payments).toHaveLength(2);
    expect(ledger.payments[0].slip_key).toBeNull();
    expect(ledger.payments[1].slip_key).toContain(init.uploadSessionId);
  });

  it('validates one-use PWP redemption and uses the client’s actual variant price in the complete order', async () => {
    const valid = await (await send(`/pwp-codes/${DEMO_PWP_CODE}?rewardCategory=BEDFRAME&rewardModelId=demo-model-aria`)).json();
    expect(valid.valid).toBe(true);
    expect(valid.pwpPriceSen).toBe(149000);
    const body = validOrder();
    body.items.push({ itemCode: 'ARIA-(K)', itemGroup: 'bedframe', qty: 1, unitPriceSen: 161500, variants: { sizeId: 'king', pwp: true, pwpCode: DEMO_PWP_CODE, divanHeight: '10', legHeight: '2', gap: '4', fabricCode: 'BF-01' } } as any);
    body.depositSen = 230250;
    const created = await send('/mfg-sales-orders', 'POST', body);
    expect(created.status).toBe(201);
    const { docNo } = await created.json();
    const detail = await (await send(`/mfg-sales-orders/${docNo}`)).json();
    expect(detail.salesOrder.total_revenue_sen).toBe(460500);
    expect(detail.items[1].variants.divanHeight).toBe('10');
    expect((await (await send(`/pwp-codes/${DEMO_PWP_CODE}?rewardCategory=BEDFRAME`)).json()).valid).toBe(false);
    expect((await send('/mfg-sales-orders', 'POST', body)).status).toBe(400);
  });

  it('keeps incomplete variants at UFN, reprices completion with the shared engine, and preserves the booked PWP base', async () => {
    const body = { ...validOrder(), depositSen: 149000, items: [{ itemCode: 'ARIA-(K)', itemGroup: 'bedframe', qty: 1, unitPriceSen: 149000, variants: { pwp: true, pwpCode: DEMO_PWP_CODE } }] };
    const dated = { ...body, processingDate: '2030-01-01', customerDeliveryDate: '2030-02-01' };
    expect((await send('/mfg-sales-orders', 'POST', dated)).status).toBe(409);
    const { docNo } = await (await send('/mfg-sales-orders', 'POST', body)).json();
    const detail = await (await send(`/mfg-sales-orders/${docNo}`)).json();
    const itemId = detail.items[0].id;
    expect((await send(`/mfg-sales-orders/${docNo}/items/${itemId}/tbc-update`, 'POST', { variants: { fabricCode: 'BF-01', gap: '4', legHeight: '2', divanHeight: '10' } })).status).toBe(200);
    const updated = await (await send(`/mfg-sales-orders/${docNo}`)).json();
    expect(updated.items[0].unit_price_sen).toBe(161500);
    expect(updated.items[0].variants.pwpCode).toBe(DEMO_PWP_CODE);
    expect(updated.salesOrder.balance_sen).toBe(12500);
  });

  it('drives King/Queen gifts using the same shared targeting engine as the real cart', () => {
    for (const size of ['K', 'Q']) {
      const gifts = computeDesiredFreeGifts(buildFreeGiftTriggers([{ triggerKey: 'mattress', itemCode: 'AKKA', category: 'MATTRESS', qty: 1, modelId: 'demo-model-akka', sizeCode: size, buildKey: 'mattress', isFreeGift: false, builtCompartments: [], gifts: modelGifts[0]!.gifts }]));
      expect(gifts.map((g) => [g.giftProductId, g.qty])).toEqual([[`mfg-demo-protector-${size.toLowerCase()}`, 1], ['mfg-demo-pillow', 2]]);
    }
  });

  it('claims and confirms a Home voucher locally without altering unrelated orders', async () => {
    await send('/pos-cart', 'PUT', { lines: [{ key: 'mattress', qty: 1, config: { productId: 'mfg-demo-akka-k', kind: 'size', total: 2990 } }], sourceQuoteId: null });
    const result = await (await send('/campaign-promos/demo-home-100/claim', 'POST', { appliedCenti: 10000 })).json();
    await send(`/campaign-promos/redemptions/${result.redemptionId}/confirm`, 'POST', { soDocNo: 'DEMO-SO-0000', customerName: 'Demo Customer' });
    const campaigns = await (await send('/campaign-promos')).json();
    expect(campaigns.campaigns[0].remaining).toBe(99);
    expect(getSimulationSnapshot().orders).toHaveLength(1);
  });

  it('requires maintained merchant and installment details before touching the order ledger', async () => {
    const slip = await (await send('/slips/init', 'POST', { fileSize: 1 })).json();
    await send(`/slips/${slip.uploadSessionId}/upload`, 'POST');
    await send(`/slips/${slip.uploadSessionId}/confirm`, 'POST');
    const payment = { amountSen: 100, approvalCode: 'DEMO-REF', uploadSessionId: slip.uploadSessionId };
    expect((await send('/mfg-sales-orders/DEMO-SO-0000/payments', 'POST', { ...payment, method: 'merchant' })).status).toBe(400);
    expect((await send('/mfg-sales-orders/DEMO-SO-0000/payments', 'POST', { ...payment, method: 'installment', installmentMonths: 0 })).status).toBe(400);
    expect(getSimulationSnapshot().orders[0]!.payments).toHaveLength(1);
    expect((await send('/mfg-sales-orders/DEMO-SO-0000/payments', 'POST', { ...payment, method: 'installment', installmentMonths: 6 })).status).toBe(201);
  });

  it('applies paired-date, variant and Proceed gates atomically to My Orders edits', async () => {
    const url = '/mfg-sales-orders/DEMO-SO-0000';
    expect((await send(url, 'PATCH', { processingDate: '2030-01-01' })).status).toBe(400);
    expect(getSimulationSnapshot().orders[0]!.salesOrder.processing_date).toBeNull();
    expect((await send(url, 'PATCH', { proceededAt: new Date().toISOString() })).status).toBe(409);
    expect((await send(url, 'PATCH', { processingDate: '2030-01-01', customerDeliveryDate: '2030-02-01' })).status).toBe(200);
    expect((await send(url, 'PATCH', { proceededAt: new Date().toISOString() })).status).toBe(200);
    expect(getSimulationSnapshot().orders[0]!.salesOrder.proceeded_at).not.toBeNull();
  });

  it('enforces voucher eligibility, one reserved voucher per cart and actual remaining stock', async () => {
    expect((await send('/campaign-promos/demo-home-100/claim', 'POST', { appliedCenti: 10000 })).status).toBe(409);
    await send('/pos-cart', 'PUT', { lines: [{ key: 'mattress', qty: 1, config: { kind: 'size', productId: 'mfg-demo-akka-k', total: 2990 } }], sourceQuoteId: null });
    const first = await (await send('/campaign-promos/demo-home-100/claim', 'POST', { appliedCenti: 10000 })).json();
    expect((await send('/campaign-promos/demo-home-100/claim', 'POST', { appliedCenti: 10000 })).status).toBe(409);
    await send(`/campaign-promos/redemptions/${first.redemptionId}/confirm`, 'POST', { soDocNo: 'DEMO-SO-0000' });
    for (let i = 1; i < 100; i++) {
      const claimed = await (await send('/campaign-promos/demo-home-100/claim', 'POST', { appliedCenti: 10000 })).json();
      await send(`/campaign-promos/redemptions/${claimed.redemptionId}/confirm`, 'POST', { soDocNo: `DEMO-TEST-${i}` });
    }
    expect((await send('/campaign-promos/demo-home-100/claim', 'POST', { appliedCenti: 10000 })).status).toBe(409);
    expect((await (await send('/campaign-promos')).json()).campaigns[0].remaining).toBe(0);
  });

  it('supports sofa PWP with shared module splitting and preserves full customer-facing composition', async () => {
    const cells = buildDefaultSofaCells(['1A(LHF)', '1NA', '1A(RHF)'].map((moduleId) => ({ moduleId })), '28');
    const body = { ...validOrder(), depositSen: 99500, items: [{ itemCode: 'BOOQIT-1A(LHF)', itemGroup: 'sofa', qty: 1, unitPriceSen: 199000, variants: { cells, depth: '28', fabricCode: 'CG-001', sofaLegHeight: '6', pwp: true, pwpCode: 'PWP-DEMO-SOFA' } }] };
    const result = await send('/mfg-sales-orders', 'POST', body);
    expect(result.status).toBe(201);
    const { docNo } = await result.json();
    const order = await (await send(`/mfg-sales-orders/${docNo}`)).json();
    expect(order.items).toHaveLength(3);
    expect(order.items.reduce((sum: number, l: { total_sen: number }) => sum + l.total_sen, 0)).toBe(199000);
    const folded = groupSoLinesForDisplay(order.items);
    expect(folded).toHaveLength(1);
    expect(folded[0]!.display?.composition).toContain('1NA');
    expect(folded[0]!.display?.description2).toContain('CG-001');
    expect(folded[0]!.display?.description2).toContain('SEAT 28');
  });

  it('supports a zero-price promo reward and an independent free-item campaign without payment proof', async () => {
    const promo = { ...validOrder(), depositSen: 0, items: [{ itemCode: 'AKKA-FIRM MATT (K)', itemGroup: 'mattress', qty: 1, unitPriceSen: 0, variants: { pwp: true, pwpCode: 'PROMO-DEMO-MATT' } }] };
    expect((await send('/mfg-sales-orders', 'POST', promo)).status).toBe(201);
    const free = { ...validOrder(), depositSen: 0, items: [{ itemCode: 'CONTOUR-PILLOW', itemGroup: 'accessory', qty: 2, unitPriceSen: 0, variants: { freeItem: { campaignId: 'demo-free-pillow' } } }] };
    expect((await send('/mfg-sales-orders', 'POST', free)).status).toBe(201);
    free.items[0]!.qty = 3;
    expect((await send('/mfg-sales-orders', 'POST', free)).status).toBe(400);
  });

  it('completes all modules of a sofa together and swaps the whole group with the current API payload', async () => {
    const cells = buildDefaultSofaCells(['1A(LHF)', '1NA', '1A(RHF)'].map((moduleId) => ({ moduleId })), '28');
    const sofa = { itemCode: 'BOOQIT-1A(LHF)', itemGroup: 'sofa', qty: 1, unitPriceSen: 299000, variants: { cells, depth: '28' } };
    const { docNo } = await (await send('/mfg-sales-orders', 'POST', { ...validOrder(), items: [sofa] })).json();
    const initial = await (await send(`/mfg-sales-orders/${docNo}`)).json();
    const itemId = initial.items[0].id;
    expect((await send(`/mfg-sales-orders/${docNo}/items/${itemId}/tbc-update`, 'POST', { variants: { fabricCode: 'CG-001', colourId: 'CG-001', fabricId: 'CG' } })).status).toBe(200);
    const completed = await (await send(`/mfg-sales-orders/${docNo}`)).json();
    expect(completed.items.every((l: { variants: { fabricCode: string } }) => l.variants.fabricCode === 'CG-001')).toBe(true);
    expect(completed.salesOrder.total_revenue_sen).toBe(299000);
    const replacement = { ...sofa, unitPriceSen: 324000, variants: { ...sofa.variants, fabricCode: 'EZ001' } };
    expect((await send(`/mfg-sales-orders/${docNo}/items/${itemId}/tbc-swap-sofa`, 'POST', { item: replacement })).status).toBe(200);
    const swapped = await (await send(`/mfg-sales-orders/${docNo}`)).json();
    expect(swapped.items).toHaveLength(3);
    expect(swapped.items.every((l: { id: string }) => l.id !== itemId)).toBe(true);
    expect(swapped.salesOrder.total_revenue_sen).toBe(324000);
    expect((await send(`/mfg-sales-orders/${docNo}/items/${swapped.items[0].id}/tbc-swap-sofa`, 'POST', { item: sofa })).status).toBe(409);
    expect((await (await send(`/mfg-sales-orders/${docNo}`)).json()).salesOrder.total_revenue_sen).toBe(324000);
  });

  it('returns each selected month’s sales summary and defaults to the current Malaysia month', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-08-10T04:00:00.000Z'));
      resetSimulation(); // August seed: RM2,990.
      await send('/mfg-sales-orders', 'POST', validOrder()); // August now RM5,980.
      vi.setSystemTime(new Date('2026-09-24T04:00:00.000Z'));
      await send('/mfg-sales-orders', 'POST', validOrder()); // September RM2,990.
      const august = await (await send('/pos/sales-stats?from=2026-08-01&to=2026-08-31')).json();
      expect(august).toMatchObject({ monthLabel: 'August 2026', monthStart: '2026-07-31T16:00:00.000Z', monthEnd: '2026-08-31T16:00:00.000Z', showroomTotal: 5980, personalTotal: 5980, showroomCount: 2, personalCount: 2 });
      const current = await (await send('/pos/sales-stats')).json();
      expect(current).toMatchObject({ monthLabel: 'September 2026', showroomTotal: 2990, personalTotal: 2990, showroomCount: 1, personalCount: 1 });
      const empty = await (await send('/pos/sales-stats?from=2026-07-01&to=2026-07-31')).json();
      expect(empty).toMatchObject({ monthLabel: 'July 2026', showroomTotal: 0, personalTotal: 0, showroomCount: 0, personalCount: 0 });
      // 16:00 UTC is the next Malaysia month, despite the UTC date still being September.
      vi.setSystemTime(new Date('2026-09-30T16:00:00.000Z'));
      expect((await (await send('/pos/sales-stats')).json()).monthLabel).toBe('October 2026');
    } finally { vi.useRealTimers(); }
  });

  it('uses inclusive Malaysia range endpoints, open bounds and the filtered product/service breakdown', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-09T15:59:59.999Z'));
      resetSimulation(); // Just before 10 September in Malaysia: excluded.
      vi.setSystemTime(new Date('2026-09-09T16:00:00.000Z'));
      await send('/mfg-sales-orders', 'POST', validOrder());
      vi.setSystemTime(new Date('2026-09-15T15:59:59.999Z'));
      await send('/mfg-sales-orders', 'POST', { ...validOrder(), additionalDeliveryFee: 100, depositSen: 154500 });
      vi.setSystemTime(new Date('2026-09-15T16:00:00.000Z'));
      await send('/mfg-sales-orders', 'POST', validOrder()); // 16 September: excluded.
      const range = await (await send('/pos/sales-stats?from=2026-09-10&to=2026-09-15')).json();
      expect(range).toMatchObject({ monthLabel: '10 Sept 2026 – 15 Sept 2026', monthStart: '2026-09-09T16:00:00.000Z', monthEnd: '2026-09-15T16:00:00.000Z', showroomTotal: 6080, personalTotal: 6080, showroomCount: 2, personalCount: 2, personalProducts: 5980, showroomProducts: 5980, personalService: 100, showroomService: 100 });
      const open = await (await send('/pos/sales-stats?from=2026-09-16')).json();
      expect(open).toMatchObject({ monthLabel: 'From 16 Sept 2026', monthEnd: null, showroomTotal: 2990, personalTotal: 2990, showroomCount: 1, personalCount: 1 });
    } finally { vi.useRealTimers(); }
  });
});
