import { describe, it, expect } from 'vitest';
import { validatePoLineItemsShape, renderPoPrintHtml } from './po';

describe('validatePoLineItemsShape', () => {
  const validItem = { order_id: '00000000-0000-0000-0000-000000000001', sku: 'MAT-001', name: 'Cloud mattress', size: 'queen', colour: null, qty: 2 };

  it('accepts valid array', () => {
    expect(validatePoLineItemsShape([validItem])).toEqual({ ok: true });
  });

  it('rejects empty array', () => {
    expect(validatePoLineItemsShape([])).toEqual({ ok: false, error: 'empty_line_items' });
  });

  it('rejects qty=0', () => {
    expect(validatePoLineItemsShape([{ ...validItem, qty: 0 }])).toEqual({ ok: false, error: 'invalid_qty' });
  });

  it('rejects qty=-1', () => {
    expect(validatePoLineItemsShape([{ ...validItem, qty: -1 }])).toEqual({ ok: false, error: 'invalid_qty' });
  });

  it('rejects missing order_id', () => {
    const bad = { ...validItem, order_id: '' };
    expect(validatePoLineItemsShape([bad])).toEqual({ ok: false, error: 'missing_order_id' });
  });

  it('rejects missing sku', () => {
    const bad = { ...validItem, sku: '' };
    expect(validatePoLineItemsShape([bad])).toEqual({ ok: false, error: 'missing_sku' });
  });

  it('rejects non-array input', () => {
    expect(validatePoLineItemsShape(null as any)).toEqual({ ok: false, error: 'not_an_array' });
    expect(validatePoLineItemsShape({} as any)).toEqual({ ok: false, error: 'not_an_array' });
  });
});

describe('renderPoPrintHtml', () => {
  const sample = {
    po: {
      id: '11111111-1111-1111-1111-111111111111',
      po_number: 'PO-2026-0001',
      created_at: '2026-05-09T08:30:00Z',
    },
    supplier: {
      code: 'SLP',
      name: 'Sleepworks Sdn Bhd',
      whatsapp_number: null,
      email: null,
    },
    lines: [
      { sku: 'MAT-001', name: 'Cloud mattress', size: 'queen', colour: null, qty: 2 },
      { sku: 'PIL-002', name: 'Cloud memory pillow', size: null, colour: null, qty: 4 },
    ],
    coordinator: { name: 'Ada Wong' },
    sourceOrderIds: ['SO-9008', 'SO-9009'],
    showroom: { name: 'Showroom KL', address: 'KL warehouse address' },
  };

  it('includes PO number in output', () => {
    const html = renderPoPrintHtml(sample);
    expect(html).toContain('PO-2026-0001');
  });

  it('includes supplier name', () => {
    const html = renderPoPrintHtml(sample);
    expect(html).toContain('Sleepworks Sdn Bhd');
  });

  it('includes all line items', () => {
    const html = renderPoPrintHtml(sample);
    expect(html).toContain('MAT-001');
    expect(html).toContain('Cloud mattress');
    expect(html).toContain('PIL-002');
    expect(html).toContain('Cloud memory pillow');
  });

  it('includes source order IDs', () => {
    const html = renderPoPrintHtml(sample);
    expect(html).toContain('SO-9008');
    expect(html).toContain('SO-9009');
  });

  it('includes coordinator name', () => {
    const html = renderPoPrintHtml(sample);
    expect(html).toContain('Ada Wong');
  });

  it('includes 2990s tagline footer', () => {
    const html = renderPoPrintHtml(sample);
    expect(html).toContain('Same price. Every piece. Always.');
  });

  it('escapes HTML special chars in supplier name', () => {
    const html = renderPoPrintHtml({
      ...sample,
      supplier: { ...sample.supplier, name: 'Sleepworks <script>alert(1)</script>' },
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
