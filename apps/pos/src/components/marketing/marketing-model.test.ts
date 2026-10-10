import { describe, expect, it } from 'vitest';
import {
  blankRequest, cmOf, detailRows, displayCopyFrom, exportText, inch, missingOf, photoSourceOf, preparedFromDataUrl,
  requestFieldsFrom, RM, saveBlockersOf, saveMissingOf, shapeName, sizeText, specOf, tagsOf, type DisplayItem,
  type LaunchRequest,
} from './marketing-model';

const item = (over: Partial<DisplayItem>): DisplayItem => ({
  id: 'd1', venueId: '107', type: 'sofa', modelId: null, name: 'AM9036', code: 'SOFA AM9036', photoUrl: null, isNew: false,
  fabric: '', colour: '', leg: '', seat: '', modules: [], size: '', height: '', divan: '', gap: '', qty: 1,
  lengthCm: null, widthCm: null, sofaCategory: '', sofaFunction: '', sourceRequestId: null, photoAt: null, layout: null, ...over,
});

/** Everything a sofa needs to be saved (owner 2026-10-09), and nothing more. */
const SAVEABLE_SOFA: Partial<LaunchRequest> = {
  supplierCode: 'SL-2207', lengthCm: '220', widthCm: '95', sofaCategory: 'Seater', sofaFunction: 'Push back',
  photoAt: '2026-10-09T03:00:00.000Z', photoMatch: 'exact', showroomId: '107', action: 'add',
};

describe('shapeName (design prototype rules)', () => {
  it.each([
    [[], 'No components yet'],
    [['1A(LHF)', '1A(RHF)'], '2-Seater'],
    [['1A(LHF)', '2A(RHF)'], '3-Seater'],
    [['2A(LHF)', '1A(RHF)'], '3-Seater'],
    [['1A(LHF)', '1NA', '1A(RHF)'], '3-Seater'],
    [['2A(LHF)', '1NA', 'L(RHF)'], '3+L'],
    [['2A(LHF)', 'L(RHF)'], '2+L'],
    [['1A(LHF)', '1NA', '1NA', '2A(RHF)'], 'Custom-made'],
    [['L(RHF)'], 'Custom-made'],
    [['1A(RHF)', '1A(LHF)'], 'Custom-made'],
  ])('%j → %s', (mods, name) => {
    expect(shapeName(mods)).toBe(name);
  });
});

/* Real builds off company 2's orders (2026-10-08), which the prototype's eight
   sample modules never met. Each would otherwise print "Custom-made". */
describe('shapeName (real modules, read as the repo reads bundles)', () => {
  it.each([
    [['2S'], '2-Seater'],
    [['3S'], '3-Seater'],
    [['1S(P)'], '1-Seater'],
    [['2S', 'HEADREST', 'HEADREST'], '2-Seater'],
    [['1B(LHF)', '1B(RHF)'], '2-Seater'],
    [['1B(LHF)', '2A(RHF)'], '3-Seater'],
    [['1A(P)(LHF)', '1A(P)(RHF)'], '2-Seater'],
    [['L(LHF)', '2A(RHF)'], '2+L'],
    [['L(LHF)', '1NA', '2A(RHF)'], '3+L'],
    [['1A(LHF)', 'Console', '1A(RHF)'], '2-Seater'],
    [['1B(LHF)', 'CNR', '2A(RHF)'], 'Custom-made'],
    [['L(LHF)', '1NA', 'L(RHF)'], 'Custom-made'],
    [['HEADREST'], 'Custom-made'],
  ])('%j → %s', (mods, name) => {
    expect(shapeName(mods)).toBe(name);
  });
});

describe('formatting', () => {
  it('RM rounds and groups like the design', () => {
    expect(RM(3740)).toBe('RM 3,740');
    expect(RM(210299.4)).toBe('RM 210,299');
  });
  it('inch keeps blanks blank', () => {
    expect(inch('12')).toBe('12"');
    expect(inch('')).toBe('');
  });
});

describe('spec lines', () => {
  it('sofa', () => {
    const it0 = item({ modules: ['2A(LHF)', '1NA', 'L(RHF)'], seat: '28"', fabric: 'Velvet VL', colour: 'Teal', leg: '4"' });
    expect(specOf(it0)).toBe('3+L · 28" seat · Velvet VL Teal · 4" legs');
    expect(tagsOf(it0)).toEqual(['28" seat', 'Velvet VL · Teal', '4" legs']);
    expect(detailRows(it0)[0]).toEqual({ k: 'Layout', v: '3+L' });
  });
  it('mattress', () => {
    const m = item({ type: 'mattress', size: 'King', height: '12' });
    expect(specOf(m)).toBe('King · 12" thick');
    expect(tagsOf(m)).toEqual(['King', '12" thick']);
    expect(specOf(item({ type: 'mattress' }))).toBe('—');
  });
  it('bed frame, including "No leg"', () => {
    const b = item({ type: 'bedframe', size: 'Queen', colour: 'Stone', fabric: 'Linen', leg: 'No leg', divan: '10"', gap: '4' });
    expect(specOf(b)).toBe('Queen · Stone · Linen · No leg · Divan 10" · Gap 4"');
    expect(tagsOf(b)).toEqual(['Queen', 'Stone', 'Linen', 'No leg', 'Divan 10"', 'Gap 4"']);
  });
  it('accessory', () => {
    expect(specOf(item({ type: 'accessory', qty: 2 }))).toBe('Qty 2');
  });
});

describe('missingOf', () => {
  const req = (over: Partial<LaunchRequest>): LaunchRequest => ({ ...blankRequest('Loo', 'Sales'), ...over });

  it('lists every sofa field in the design order', () => {
    expect(missingOf(req({}))).toEqual([
      'Supplier code', 'Model name', 'Components', 'Sofa size', 'Category', 'Function', 'Photo',
      'Fabric series', 'Colour', 'Leg height', 'Seat', 'Price list', 'Showroom', 'Add / Replace',
    ]);
  });

  it('wants every combo priced', () => {
    const r = req({ ...SAVEABLE_SOFA, model: 'M', modules: ['1A(LHF)'], fabric: 'F', colour: 'C', leg: '4"', seat: '28"',
      rows: [{ modules: ['1A(LHF)'], price: '3540' }, { modules: ['2NA'], price: '' }] });
    expect(missingOf(r)).toEqual(['Price list']);
    expect(missingOf({ ...r, rows: [r.rows[0]!] })).toEqual([]);
  });

  it('asks Exact or Non-exact once there is a photo, and a note for Non-exact', () => {
    const r = req({ ...SAVEABLE_SOFA, photoMatch: '' });
    expect(saveMissingOf(r)).toEqual(['Exact / Non-exact']);
    expect(saveMissingOf({ ...r, photoMatch: 'non_exact', photoNote: '  ' })).toEqual(['Photo note']);
    expect(saveMissingOf({ ...r, photoMatch: 'non_exact', photoNote: 'Slimmer arms' })).toEqual([]);
    // A photo picked in the form counts before it is saved.
    const picked = { contentType: 'image/jpeg', dataB64: 'AAAA', fileName: 'a.jpg' };
    expect(saveMissingOf({ ...r, photoAt: null, photoUpload: picked, photoMatch: 'exact' })).toEqual([]);
  });

  it('wants a size in whole cm on both sides', () => {
    expect(missingOf(req({ ...SAVEABLE_SOFA, widthCm: '' }))).toContain('Sofa size');
    expect(missingOf(req({ ...SAVEABLE_SOFA, lengthCm: '0' }))).toContain('Sofa size');
    expect(missingOf(req({ ...SAVEABLE_SOFA }))).not.toContain('Sofa size');
  });

  it('wants the piece to replace once Replace is chosen', () => {
    const r = req({ type: 'mattress', supplierCode: 'S', model: 'M', size: 'King', height: '13', showroomId: '107', action: 'replace' });
    expect(missingOf(r)).toEqual(['Item to replace']);
  });

  it('bed frame needs divan and gap, not seat', () => {
    const r = req({ type: 'bedframe', supplierCode: 'S', model: 'M', fabric: 'F', colour: 'C', leg: '2"', size: 'Queen', showroomId: '107', action: 'add' });
    expect(missingOf(r)).toEqual(['Divan height', 'Mattress gap']);
  });
});

/* Owner 2026-10-09: these are needed to SAVE (Pending Info), not only to Complete. */
describe('what saving needs', () => {
  const req = (over: Partial<LaunchRequest>): LaunchRequest => ({ ...blankRequest('Loo', 'Sales'), ...over });

  it('a sofa: supplier code, size, category, function, photo, showroom and Add / Replace', () => {
    expect(saveMissingOf(req({}))).toEqual([
      'Supplier code', 'Sofa size', 'Category', 'Function', 'Photo', 'Showroom', 'Add / Replace',
    ]);
    expect(saveMissingOf(req(SAVEABLE_SOFA))).toEqual([]);
  });

  it('a mattress or bed frame: the supplier code too, nothing of the sofa’s', () => {
    expect(saveMissingOf(req({ type: 'mattress', showroomId: '107', action: 'add' }))).toEqual(['Supplier code']);
    expect(saveMissingOf(req({ type: 'bedframe', supplierCode: 'BF-9', showroomId: '107', action: 'add' }))).toEqual([]);
  });

  it('lets a pending Replace wait for a piece to replace, as the API does', () => {
    const r = req({ ...SAVEABLE_SOFA, action: 'replace', replaceId: null });
    expect(saveMissingOf(r)).toEqual(['Item to replace']);
    expect(saveBlockersOf(r)).toEqual([]);
  });
});

describe('size', () => {
  it('reads whole cm and refuses what is not a size', () => {
    expect(cmOf('220')).toBe(220);
    expect(cmOf('94.6')).toBe(95);
    expect(cmOf('')).toBeNull();
    expect(cmOf('0')).toBeNull();
    expect(cmOf('1200')).toBeNull();
    expect(cmOf('abc')).toBeNull();
  });
  it('prints L × W only when both are there', () => {
    expect(sizeText('220', '95')).toBe('220 × 95 cm');
    expect(sizeText(220, null)).toBe('');
  });
});

describe('a display that arrived with size, category and function', () => {
  it('shows them in its details, and a hand-recorded one does not', () => {
    const arrived = item({ lengthCm: 220, widthCm: 95, sofaCategory: 'Seater', sofaFunction: 'Push back' });
    expect(detailRows(arrived).slice(-3)).toEqual([
      { k: 'Size', v: '220 × 95 cm' }, { k: 'Category', v: 'Seater' }, { k: 'Function', v: 'Push back' },
    ]);
    expect(detailRows(item({})).map((r) => r.k)).toEqual(['Layout', 'Seat', 'Fabric series', 'Colour', 'Leg height']);
  });
});

/* Owner 2026-10-10: ⋯ › Duplicate from… — one new model to three showrooms. */
describe('duplicate', () => {
  const LAYOUT = [{ id: 'c1', moduleId: '2A(LHF)', x: 152.5, y: 192.5, rot: 0 as const }];
  /** A pending sofa on the launch board — not everything filled in. */
  const pending: LaunchRequest = {
    ...blankRequest('Management', 'Staff'), id: 'r1', supplierCode: 'SL-2207', fabric: 'Velvet VL', modules: ['2A(LHF)', 'L(RHF)'],
    layout: LAYOUT, lengthCm: '280', widthCm: '160', sofaCategory: 'Seater', sofaFunction: 'Push back',
    photoAt: '2026-10-09T03:00:00.000Z', photoMatch: 'non_exact', photoNote: 'Slimmer arms',
    rows: [{ modules: ['2A(LHF)', 'L(RHF)'], price: '3540', layout: LAYOUT }],
    showroomId: 'flagship', action: 'replace', replaceId: 'd9', created: '2026-10-09T03:00:00.000Z',
  };

  it('copies a request’s product — blanks included — and never where it goes', () => {
    const f = requestFieldsFrom({ kind: 'request', request: pending });
    expect(f).toMatchObject({
      type: 'sofa', supplierCode: 'SL-2207', model: '', fabric: 'Velvet VL', colour: '', modules: ['2A(LHF)', 'L(RHF)'],
      layout: LAYOUT, lengthCm: '280', widthCm: '160', sofaCategory: 'Seater', sofaFunction: 'Push back',
      rows: [{ modules: ['2A(LHF)', 'L(RHF)'], price: '3540', layout: LAYOUT }],
    });
    for (const k of ['id', 'status', 'showroomId', 'action', 'replaceId', 'by', 'byRole', 'created', 'photoAt', 'photoUpload'] as const) {
      expect(f).not.toHaveProperty(k);
    }
  });

  it('hands over copies, so editing the new form never edits the source', () => {
    const f = requestFieldsFrom({ kind: 'request', request: pending });
    f.modules!.push('1NA');
    f.layout![0]!.x = 0;
    f.rows![0]!.modules.push('1NA');
    expect(pending.modules).toEqual(['2A(LHF)', 'L(RHF)']);
    expect(pending.layout![0]!.x).toBe(152.5);
    expect(pending.rows[0]!.modules).toEqual(['2A(LHF)', 'L(RHF)']);
  });

  it('takes a supplier code and the sofa spec only from a piece that came off the launch board', () => {
    const catalogue = item({ name: 'Annsa', code: 'SOFA ANNSA', fabric: 'CG', colour: 'Pearl', seat: '28"', modules: ['1A(LHF)', '2A(RHF)'] });
    const f = requestFieldsFrom({ kind: 'display', item: catalogue });
    expect(f).toMatchObject({ type: 'sofa', model: 'Annsa', fabric: 'CG', colour: 'Pearl', seat: '28"', modules: ['1A(LHF)', '2A(RHF)'] });
    for (const k of ['supplierCode', 'lengthCm', 'sofaCategory', 'rows'] as const) expect(f).not.toHaveProperty(k);

    const arrived = item({ name: 'Booqit', code: 'SL-2207', lengthCm: 280, widthCm: 160, sofaCategory: 'Seater', sofaFunction: 'Fixed', sourceRequestId: 'r0' });
    expect(requestFieldsFrom({ kind: 'display', item: arrived })).toMatchObject({
      model: 'Booqit', supplierCode: 'SL-2207', lengthCm: '280', widthCm: '160', sofaCategory: 'Seater', sofaFunction: 'Fixed',
    });
    expect(requestFieldsFrom({ kind: 'display', item: item({ type: 'accessory' }) })).toEqual({});
  });

  it('finds the photo a source shows', () => {
    expect(photoSourceOf({ kind: 'request', request: pending })).toEqual({ requestId: 'r1', version: '2026-10-09T03:00:00.000Z' });
    expect(photoSourceOf({ kind: 'request', request: { ...pending, photoAt: null } })).toBeNull();
    expect(photoSourceOf({ kind: 'display', item: item({ sourceRequestId: 'r0', photoAt: '2026-10-08T09:00:00.000Z' }) }))
      .toEqual({ requestId: 'r0', version: '2026-10-08T09:00:00.000Z' });
    // A request with no photo is not asked for one.
    expect(photoSourceOf({ kind: 'display', item: item({ sourceRequestId: 'r0' }) })).toBeNull();
    expect(photoSourceOf({ kind: 'display', item: item({}) })).toBeNull();
  });

  it('records a request on display as the new product it is', () => {
    const c = displayCopyFrom({ kind: 'request', request: pending });
    expect(c).toMatchObject({
      type: 'sofa', modelId: null, name: 'Untitled sofa', code: 'SL-2207', lengthCm: 280, widthCm: 160,
      sofaCategory: 'Seater', sofaFunction: 'Push back', sourceRequestId: 'r1', qty: 1,
    });
    expect(displayCopyFrom({ kind: 'request', request: { ...pending, model: ' Booqit ' } }).name).toBe('Booqit');
  });

  it('copies a piece on display as it is, catalogue Model and all', () => {
    const c = displayCopyFrom({ kind: 'display', item: item({ type: 'mattress', modelId: 'm7', name: 'AKKA-FIRM', code: '2990 AKKA-FIRM MATT', photoUrl: '/a.jpg', size: 'King', height: '12' }) });
    expect(c).toMatchObject({ type: 'mattress', modelId: 'm7', name: 'AKKA-FIRM', code: '2990 AKKA-FIRM MATT', photoUrl: '/a.jpg', size: 'King', height: '12', sourceRequestId: null });
  });

  it('reads a saved photo back into an upload', () => {
    expect(preparedFromDataUrl('data:image/jpeg;base64,/9j/AAAA', 'sofa.jpg')).toEqual({ contentType: 'image/jpeg', dataB64: '/9j/AAAA', fileName: 'sofa.jpg' });
    expect(preparedFromDataUrl('data:image/gif;base64,R0lGOD', 'a.gif')).toBeNull();
    expect(preparedFromDataUrl('https://example.com/a.jpg', 'a.jpg')).toBeNull();
  });
});

describe('exportText', () => {
  it('matches the design layout for a sofa Replace', () => {
    const r: LaunchRequest = {
      ...blankRequest('Management', 'Staff'), id: 'r1', status: 'completed', model: 'hjjh', supplierCode: 'SL-2207',
      fabric: 'Velvet VL', colour: 'Rust', leg: '4"', seat: '30"', modules: ['2A(LHF)', 'L(RHF)'],
      lengthCm: '253', widthCm: '165', sofaCategory: 'Seater', sofaFunction: 'Push back',
      photoAt: '2026-10-06T03:00:00.000Z', photoMatch: 'non_exact', photoNote: 'Slimmer arms',
      showroomId: '107', action: 'replace', replaceId: 'd1', created: '2026-10-06T03:00:00.000Z',
    };
    const text = exportText(r, {
      showroomName: '2990s PJ',
      replaceItem: item({ name: '5531', modules: ['1A(LHF)', '2A(RHF)'], seat: '24"', fabric: 'Linen-look L200', colour: 'Oat', leg: '2"' }),
    });
    expect(text.split('\n')).toEqual([
      'NEW PRODUCT — SOFA',
      '',
      'Model name    : hjjh',
      'Supplier code : SL-2207',
      'Fabric series : Velvet VL',
      'Colour        : Rust',
      'Leg height    : 4"',
      'Seat          : 30"',
      'Layout        : 2+L',
      'Size (L × W)  : 253 × 165 cm',
      'Category      : Seater',
      'Function      : Push back',
      'Photo         : Non-exact — Slimmer arms',
      '',
      'Compartments (left to right):',
      '  1. 2A(LHF) — Left hand facing (W 158 × D 95 cm)',
      '  2. L(RHF) — Right hand facing chaise (W 95 × D 165 cm)',
      '',
      'Deliver to    : 2990s PJ',
      'Action        : Replace 5531 (3-Seater · 24" seat · Linen-look L200 Oat · 2" legs)',
      'Requested by  : Management · 6 Oct',
    ]);
  });

  it('mattress Add uses dashes for blanks', () => {
    const r: LaunchRequest = { ...blankRequest('Marketing', 'Marketing'), type: 'mattress', model: 'ARRUS-PLUS', size: 'King', height: '13', showroomId: '107', action: 'add', created: '' };
    const text = exportText(r, { showroomName: null, replaceItem: null });
    expect(text).toContain('Supplier code : -');
    expect(text).toContain('Height        : 13"');
    expect(text).toContain('Deliver to    : -');
    expect(text).toContain('Action        : Add');
    expect(text).toContain('Requested by  : Marketing · -');
  });
});
