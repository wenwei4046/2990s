// Local-simulation stand-ins for 2990's /marketing API and the persona that
// can see it. Fictional data only — seeded with the design prototype's own
// showrooms, sample displays and requests so the Marketing screens can be
// checked against the design without touching a live system. Never calls fetch.

// v2: the showroom list moved into the store (0218).
// v3: sofa size, photo, category / function and the Maintenance lists (0219).
const KEY = '2990:mobile-simulation:marketing:v3';
// Photos live under their own key, so a full localStorage loses a photo, not the store.
const PHOTO_KEY = `${KEY}:photos`;
const PERSONA_KEY = '2990:simulation:persona';

type Row = Record<string, any>;
interface MarketingStore {
  showrooms: Row[]; displays: Row[]; floorplans: Record<string, Row>; requests: Row[]; options: Row[]; serial: number;
}

const now = () => new Date().toISOString();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-pos-simulation': 'local-only' },
});

export type SimulationPersona = 'marketing' | 'director' | 'sales';

/** 'marketing' turns the demo account into the marketing account; 'director'
 *  into a Sales Director, the finance tier that Sales analysis shows margin to. */
export const simulationPersona = (): SimulationPersona => {
  try {
    const v = localStorage.getItem(PERSONA_KEY);
    return v === 'marketing' || v === 'director' ? v : 'sales';
  } catch { return 'sales'; }
};

const display = (id: string, venueId: string, type: string, name: string, code: string, photoUrl: string | null, extra: Row = {}): Row => ({
  id, venue_id: venueId, type, model_id: null, name, code, photo_url: photoUrl, is_new: false, fabric: '', colour: '', leg: '', seat: '',
  modules: [], layout: null, size: '', height: '', divan: '', gap: '', qty: 1, length_cm: null, width_cm: null, sofa_category: '', sofa_function: '',
  source_request_id: null, created_at: '2026-10-01T02:00:00.000Z', created_by_name: 'Demo', removed_at: null, ...extra,
});

const showroom = (id: string, name: string, area: string): Row => ({ id, name, area, archived_at: null });

const option = (id: string, kind: string, parentId: string | null, name: string, seq: number): Row =>
  ({ id, kind, parent_id: parentId, name, seq, archived_at: null });

/** 0219's seed: the owner's starting lists. */
const seedOptions = (): Row[] => [
  option('sim-o1', 'category', null, 'Seater', 1),
  option('sim-o2', 'category', null, 'Chair', 2),
  option('sim-o3', 'function', 'sim-o1', 'Fixed', 3),
  option('sim-o4', 'function', 'sim-o1', 'Push back', 4),
  option('sim-o5', 'function', 'sim-o1', 'Slide out', 5),
  option('sim-o6', 'function', 'sim-o2', 'Fixed', 6),
];

function seed(): MarketingStore {
  const kl = 'demo-venue-kl';
  return {
    serial: 100,
    // The prototype's four, under the ids the seeded displays use.
    showrooms: [
      showroom(kl, 'Showroom KL', 'Kuala Lumpur'),
      showroom('demo-venue', 'Showroom PJ', 'Petaling Jaya'),
      showroom('demo-venue-pg', 'Showroom Penang', 'Penang'),
      showroom('demo-venue-jb', 'Showroom JB', 'Johor Bahru'),
    ],
    floorplans: {},
    displays: [
      display('sim-d1', kl, 'sofa', 'AM9036', 'SOFA AM9036', null, { fabric: 'Velvet VL', colour: 'Teal', leg: '4"', seat: '28"', modules: ['2A(LHF)', '1NA', 'L(RHF)'] }),
      display('sim-d2', kl, 'sofa', '5531', 'SOFA 5531', null, { fabric: 'Linen-look L200', colour: 'Oat', leg: '2"', seat: '24"', modules: ['1A(LHF)', '2A(RHF)'] }),
      display('sim-d3', kl, 'sofa', 'DSL8019', 'SOFA DSL8019', null, { fabric: 'Tech Fabric TF', colour: 'Charcoal', leg: '4"', seat: '28"', modules: ['1A(LHF)', '1A(RHF)'] }),
      display('sim-d4', kl, 'mattress', 'AKKA-FIRM', '2990 AKKA-FIRM MATT', '/catalog/mattress-2990s-firm.jpg', { size: 'King', height: '12' }),
      display('sim-d5', kl, 'mattress', 'AKKA-SOFT', '2990 AKKA-SOFT MATT', '/catalog/mattress-2990s-soft.jpg', { size: 'Queen', height: '11' }),
      display('sim-d6', kl, 'bedframe', 'NH39A', 'BED NH39A', '/catalog/bedframe-nh39a.png', { size: 'Queen', colour: 'Stone', fabric: 'Linen-look L200', leg: '4"', divan: '10"', gap: '4' }),
      display('sim-d7', kl, 'accessory', 'Latex Pillow', 'ACC PILLOW-LTX', null, { qty: 2 }),
      display('sim-d8', 'demo-venue', 'sofa', 'SF5119', 'SOFA SF5119', null, { fabric: 'Tech Fabric TF', colour: 'Mocha', leg: '6"', seat: '30"', modules: ['1A(LHF)', '1NA', '1NA', '2A(RHF)'] }),
      display('sim-d9', 'demo-venue', 'mattress', 'KETTA-SOFT', '2990 KETTA-SOFT MATT', '/catalog/mattress-2990s-soft.jpg', { size: 'Queen', height: '10' }),
      display('sim-d10', 'demo-venue', 'bedframe', 'KHJ57', 'BED KHJ57', null, { size: 'King', colour: 'Charcoal', fabric: 'Tech Fabric TF', leg: '2"', divan: '12"', gap: '3' }),
      display('sim-d11', 'demo-venue-pg', 'mattress', 'ARRUS-FIRM', '2990 ARRUS-FIRM MATT', '/catalog/mattress-2990s-firm.jpg', { size: 'King', height: '12' }),
    ],
    requests: [
      {
        id: 'sim-r1', type: 'sofa', status: 'pending', supplier_code: 'SL-2207', model: '', fabric: 'Velvet VL', colour: '', leg: '', seat: '',
        size: '', height: '', divan: '', gap: '', modules: ['2A(LHF)', 'L(RHF)'], combo_rows: [{ modules: ['2A(LHF)', 'L(RHF)'], price: 3540 }, { modules: ['1A(LHF)', '2A(RHF)'], price: null }],
        venue_id: kl, action: 'replace', replace_display_id: null, requested_by_name: 'Management', requested_by_role: 'Staff', created_at: '2026-10-06T02:00:00.000Z',
      },
      {
        id: 'sim-r2', type: 'mattress', status: 'completed', supplier_code: 'MW-118', model: 'ARRUS-PLUS', fabric: '', colour: '', leg: '', seat: '',
        size: 'King', height: '13', divan: '', gap: '', modules: [], combo_rows: [], venue_id: 'demo-venue-jb', action: 'add', replace_display_id: null,
        requested_by_name: 'Marketing', requested_by_role: 'Marketing', created_at: '2026-10-02T02:00:00.000Z',
      },
    ],
    options: seedOptions(),
  };
}

let memory: MarketingStore | undefined;
function store(): MarketingStore {
  if (memory) return memory;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return (memory = JSON.parse(raw) as MarketingStore);
  } catch { /* corrupt or unavailable — start fresh */ }
  return (memory = seed());
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(store())); } catch { /* in-memory still works */ } }

/** Request photos by request id: { content_type, image_b64, file_name, updated_at }. */
let photoMemory: Record<string, Row> | undefined;
function photos(): Record<string, Row> {
  if (photoMemory) return photoMemory;
  try {
    const raw = localStorage.getItem(PHOTO_KEY);
    if (raw) return (photoMemory = JSON.parse(raw) as Record<string, Row>);
  } catch { /* start without */ }
  return (photoMemory = {});
}
function savePhotos() { try { localStorage.setItem(PHOTO_KEY, JSON.stringify(photos())); } catch { /* too big — kept in memory */ } }

const showroomWire = (r: Row) => ({ id: r.id, name: r.name, area: r.area });
const displayWire = (r: Row) => ({
  id: r.id, venueId: r.venue_id, type: r.type, modelId: r.model_id, name: r.name, code: r.code, photoUrl: r.photo_url, isNew: r.is_new,
  fabric: r.fabric, colour: r.colour, leg: r.leg, seat: r.seat, modules: r.modules, size: r.size, height: r.height, divan: r.divan,
  gap: r.gap, qty: r.qty, layout: r.layout ?? null, lengthCm: r.length_cm ?? null, widthCm: r.width_cm ?? null, sofaCategory: r.sofa_category ?? '',
  sofaFunction: r.sofa_function ?? '', sourceRequestId: r.source_request_id ?? null, createdAt: r.created_at, createdByName: r.created_by_name,
});
const requestWire = (r: Row) => ({
  id: r.id, type: r.type, status: r.status, supplierCode: r.supplier_code, model: r.model, fabric: r.fabric, colour: r.colour, leg: r.leg,
  seat: r.seat, size: r.size, height: r.height, divan: r.divan, gap: r.gap, modules: r.modules, layout: r.layout ?? null,
  rows: r.combo_rows, venueId: r.venue_id, lengthCm: r.length_cm ?? null, widthCm: r.width_cm ?? null, sofaCategory: r.sofa_category ?? '', sofaFunction: r.sofa_function ?? '',
  photoMatch: r.photo_match ?? '', photoNote: r.photo_note ?? '', photoAt: photos()[r.id]?.updated_at ?? null,
  action: r.action, replaceId: r.replace_display_id, by: r.requested_by_name, byRole: r.requested_by_role, createdAt: r.created_at, updatedAt: r.created_at,
});
const requestCols = (b: Row) => ({
  type: b.type, status: b.status, supplier_code: b.supplierCode ?? '', model: b.model ?? '', fabric: b.fabric ?? '', colour: b.colour ?? '',
  leg: b.leg ?? '', seat: b.seat ?? '', size: b.size ?? '', height: b.height ?? '', divan: b.divan ?? '', gap: b.gap ?? '',
  modules: b.modules ?? [], layout: b.layout ?? null, length_cm: b.lengthCm ?? null, width_cm: b.widthCm ?? null, sofa_category: b.sofaCategory ?? '',
  sofa_function: b.sofaFunction ?? '', photo_match: b.photoMatch ?? '', photo_note: b.photoMatch === 'non_exact' ? (b.photoNote ?? '') : '',
  combo_rows: b.rows ?? [], venue_id: b.venueId, action: b.action,
  replace_display_id: b.action === 'replace' ? (b.replaceId ?? null) : null,
});

/** The API's saveGaps (routes/marketing.ts), so the simulation refuses what live would. */
const saveGaps = (b: Row, hasPhoto: boolean): string[] => {
  const g: string[] = [];
  if (!String(b.supplierCode ?? '').trim()) g.push('Supplier code');
  if (b.type === 'sofa') {
    if (!b.lengthCm || !b.widthCm) g.push('Sofa size');
    if (!b.sofaCategory) g.push('Category');
    if (!b.sofaFunction) g.push('Function');
    if (!hasPhoto) g.push('Photo');
    else if (!b.photoMatch) g.push('Exact / Non-exact');
    else if (b.photoMatch === 'non_exact' && !String(b.photoNote ?? '').trim()) g.push('Photo note');
  }
  return g;
};
const gapsReply = (gaps: string[]) => json({
  error: 'missing_fields', missing: gaps,
  reason: `Fill in ${gaps.join(', ')} before saving. If the form does not show ${gaps.length === 1 ? 'it' : 'them'}, reload the POS.`,
}, 400);
const keepPhoto = (id: string, p: Row | undefined) => {
  if (!p) return;
  photos()[id] = { content_type: p.contentType, image_b64: p.dataB64, file_name: p.fileName ?? '', updated_at: now() };
  savePhotos();
};

/** /state's two-level list: each live category with its live functions. */
const optionsWire = (rows: Row[]) => {
  const live = rows.filter((r) => !r.archived_at).sort((a, b) => a.seq - b.seq);
  return live.filter((r) => r.kind === 'category').map((c) => ({
    id: c.id, name: c.name,
    functions: live.filter((f) => f.kind === 'function' && f.parent_id === c.id).map((f) => ({ id: f.id, name: f.name })),
  }));
};

/** Handle a /marketing/* request, or return null when the path is not ours. */
export function marketingDispatch(path: string, method: string, body: Row): Response | null {
  if (!path.startsWith('/marketing/')) return null;
  const st = store();
  const persona = simulationPersona();
  const me = persona === 'marketing' ? { name: 'Marketing', role: 'Marketing' }
    : persona === 'director' ? { name: 'Director', role: 'Sales Director' }
    : { name: 'Demo Sales', role: 'Sales' };
  const live = st.displays.filter((d) => !d.removed_at);
  const listed = st.showrooms.filter((x) => !x.archived_at);
  const unlisted = (id: unknown) => (listed.some((x) => x.id === id)
    ? null : json({ error: 'unknown_showroom', reason: 'This showroom is no longer on the list.' }, 409));
  const nameTaken = (name: string, except?: string) =>
    listed.some((x) => x.id !== except && String(x.name).trim().toLowerCase() === name.toLowerCase());

  if (path === '/marketing/state' && method === 'GET') {
    return json({
      showrooms: [...listed].sort((a, b) => String(a.name).localeCompare(String(b.name))).map(showroomWire),
      displays: live.map(displayWire),
      requests: st.requests.filter((r) => r.status === 'pending' || r.status === 'completed').sort((a, b) => b.created_at.localeCompare(a.created_at)).map(requestWire),
      floorplans: Object.values(st.floorplans).map((f) => ({ venueId: f.venue_id, updatedAt: f.updated_at, fileName: f.file_name })),
      sofaOptions: optionsWire(st.options ?? []),
    });
  }
  if (path === '/marketing/sofa-options' && method === 'POST') {
    const name = String(body.name ?? '').trim();
    if (!name) return json({ error: 'validation_failed' }, 400);
    const parentId = body.categoryId ?? null;
    const live = (st.options ?? []).filter((o) => !o.archived_at);
    if (parentId && !live.some((o) => o.id === parentId && o.kind === 'category')) {
      return json({ error: 'unknown_category', reason: 'This category is no longer on the list.' }, 409);
    }
    if (live.some((o) => (o.parent_id ?? null) === parentId && String(o.name).toLowerCase() === name.toLowerCase())) {
      return json({ error: 'duplicate_name', reason: parentId ? `This category already has a function called ${name}.` : `There is already a category called ${name}.` }, 409);
    }
    const row = option(`sim-o${st.serial++}`, parentId ? 'function' : 'category', parentId, name, st.serial);
    st.options = [...(st.options ?? []), row]; save();
    return json({ option: { id: row.id, kind: row.kind, categoryId: row.parent_id, name: row.name } }, 201);
  }
  let o = /^\/marketing\/sofa-options\/([^/]+)$/.exec(path);
  if (o) {
    const row = (st.options ?? []).find((x) => x.id === decodeURIComponent(o![1]!) && !x.archived_at);
    if (!row) return json({ error: 'not_found', reason: 'This option is no longer on the list.' }, 404);
    if (method === 'PATCH') {
      const name = String(body.name ?? '').trim();
      if (!name) return json({ error: 'validation_failed' }, 400);
      const clash = (st.options ?? []).some((x) => !x.archived_at && x.id !== row.id && (x.parent_id ?? null) === (row.parent_id ?? null)
        && String(x.name).toLowerCase() === name.toLowerCase());
      if (clash) return json({ error: 'duplicate_name', reason: `${name} is already on this list.` }, 409);
      row.name = name; save();
      return json({ option: { id: row.id, kind: row.kind, categoryId: row.parent_id, name: row.name } });
    }
    if (method === 'DELETE') {
      for (const x of st.options ?? []) if (!x.archived_at && (x.id === row.id || x.parent_id === row.id)) x.archived_at = now();
      save();
      return json({ ok: true });
    }
  }
  o = /^\/marketing\/requests\/([^/]+)\/photo$/.exec(path);
  if (o && method === 'GET') {
    const id = decodeURIComponent(o[1]!);
    const row = st.requests.find((r) => r.id === id);
    if (!row) return json({ error: 'not_found' }, 404);
    const p = photos()[id];
    return json({ photo: p ? {
      dataUrl: `data:${p.content_type};base64,${p.image_b64}`, fileName: p.file_name, updatedAt: p.updated_at,
      match: row.photo_match ?? '', note: row.photo_note ?? '',
    } : null });
  }
  if (path === '/marketing/showrooms' && method === 'POST') {
    const name = String(body.name ?? '').trim();
    if (!name) return json({ error: 'validation_failed' }, 400);
    if (nameTaken(name)) return json({ error: 'duplicate_name', reason: `There is already a showroom called ${name}.` }, 409);
    const row = showroom(`sim-s${st.serial++}`, name, String(body.area ?? '').trim());
    st.showrooms.push(row); save();
    return json({ showroom: showroomWire(row) }, 201);
  }
  let m = /^\/marketing\/showrooms\/([^/]+)$/.exec(path);
  if (m) {
    const row = listed.find((x) => x.id === decodeURIComponent(m![1]!));
    if (!row) return json({ error: 'not_found', reason: 'This showroom is no longer on the list.' }, 404);
    if (method === 'PATCH') {
      const name = String(body.name ?? '').trim();
      if (!name) return json({ error: 'validation_failed' }, 400);
      if (nameTaken(name, row.id)) return json({ error: 'duplicate_name', reason: `There is already a showroom called ${name}.` }, 409);
      Object.assign(row, { name, area: String(body.area ?? '').trim() }); save();
      return json({ showroom: showroomWire(row) });
    }
    if (method === 'DELETE') {
      const pieces = live.filter((d) => d.venue_id === row.id).length;
      const open = st.requests.filter((r) => r.venue_id === row.id && (r.status === 'pending' || r.status === 'completed')).length;
      if (pieces || open) {
        const what = [pieces ? `${pieces} piece${pieces === 1 ? '' : 's'} on display` : '', open ? `${open} open launch request${open === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ');
        return json({ error: 'showroom_in_use', reason: `This showroom still has ${what}. Clear ${pieces + open === 1 ? 'it' : 'them'} first.` }, 409);
      }
      row.archived_at = now(); save();
      return json({ ok: true });
    }
  }
  if (path === '/marketing/displays' && method === 'POST') {
    if (!body.venueId || !body.name) return json({ error: 'validation_failed' }, 400);
    const gone = unlisted(body.venueId);
    if (gone) return gone;
    if (body.type === 'sofa' && !(body.modules ?? []).length) return json({ error: 'validation_failed', reason: 'A sofa needs its components.' }, 400);
    const row = display(`sim-d${st.serial++}`, body.venueId, body.type, body.name, body.code ?? '', body.photoUrl ?? null, {
      model_id: body.modelId ?? null, fabric: body.fabric ?? '', colour: body.colour ?? '', leg: body.leg ?? '', seat: body.seat ?? '',
      modules: body.modules ?? [], layout: body.type === 'sofa' ? (body.layout ?? null) : null, size: body.size ?? '', height: body.height ?? '', divan: body.divan ?? '', gap: body.gap ?? '',
      qty: body.qty ?? 1, created_at: now(), created_by_name: me.name,
    });
    st.displays.push(row); save();
    return json({ display: displayWire(row) }, 201);
  }
  m = /^\/marketing\/displays\/([^/]+)$/.exec(path);
  if (m && method === 'DELETE') {
    const row = live.find((d) => d.id === m![1]);
    if (!row) return json({ error: 'not_found' }, 404);
    row.removed_at = now(); save();
    return json({ ok: true });
  }
  m = /^\/marketing\/floorplans\/([^/]+)$/.exec(path);
  if (m) {
    const vid = decodeURIComponent(m[1]!);
    if (method === 'GET') {
      const f = st.floorplans[vid];
      return f ? json({ floorplan: { venueId: vid, dataUrl: `data:${f.content_type};base64,${f.image_b64}`, fileName: f.file_name, updatedAt: f.updated_at } }) : json({ error: 'not_found' }, 404);
    }
    if (method === 'PUT') {
      const gone = unlisted(vid);
      if (gone) return gone;
      st.floorplans[vid] = { venue_id: vid, content_type: body.contentType, image_b64: body.dataB64, file_name: body.fileName ?? '', updated_at: now() };
      save();
      return json({ floorplan: { venueId: vid, updatedAt: st.floorplans[vid]!.updated_at, fileName: body.fileName ?? '' } });
    }
    if (method === 'DELETE') { delete st.floorplans[vid]; save(); return json({ ok: true }); }
  }
  if (path === '/marketing/requests' && method === 'POST') {
    if (!body.venueId || !body.action) return json({ error: 'validation_failed' }, 400);
    const gaps = saveGaps(body, !!body.photo);
    if (gaps.length) return gapsReply(gaps);
    const gone = unlisted(body.venueId);
    if (gone) return gone;
    const row = { id: `sim-r${st.serial++}`, ...requestCols(body), requested_by_name: me.name, requested_by_role: me.role, created_at: now() };
    keepPhoto(row.id, body.photo);
    st.requests.push(row); save();
    return json({ request: requestWire(row) }, 201);
  }
  m = /^\/marketing\/requests\/([^/]+)(\/arrive)?$/.exec(path);
  if (m) {
    const row = st.requests.find((r) => r.id === m![1] && (r.status === 'pending' || r.status === 'completed'));
    if (!row) return json({ error: 'not_found' }, 404);
    if (m[2] && method === 'POST') {
      if (row.status !== 'completed') return json({ error: 'not_completed', reason: 'Only a request in Completed Info can arrive.' }, 409);
      let removedName: string | null = null;
      if (row.action === 'replace' && row.replace_display_id) {
        const old = st.displays.find((d) => d.id === row.replace_display_id && !d.removed_at);
        if (old) { old.removed_at = now(); removedName = old.name; }
      }
      const created = display(`sim-d${st.serial++}`, row.venue_id, row.type, row.model, row.supplier_code, null, {
        is_new: true, fabric: row.fabric, colour: row.colour, leg: row.leg, seat: row.seat, modules: row.modules, layout: row.layout ?? null, size: row.size,
        height: row.height, divan: row.divan, gap: row.gap, length_cm: row.length_cm ?? null, width_cm: row.width_cm ?? null,
        sofa_category: row.sofa_category ?? '', sofa_function: row.sofa_function ?? '', source_request_id: row.id,
        created_at: now(), created_by_name: me.name,
      });
      st.displays.push(created);
      row.status = 'arrived';
      save();
      return json({ displayId: created.id, removedName });
    }
    if (method === 'PUT') {
      const gaps = saveGaps(body, !!body.photo || !!photos()[row.id]);
      if (gaps.length) return gapsReply(gaps);
      const gone = unlisted(body.venueId);
      if (gone) return gone;
      Object.assign(row, requestCols(body));
      keepPhoto(row.id, body.photo);
      save();
      return json({ request: requestWire(row) });
    }
    if (method === 'DELETE') { row.status = 'deleted'; save(); return json({ ok: true }); }
  }
  return json({ error: 'simulation_route_missing', reason: `${method} ${path} has not been implemented.` }, 501);
}

export function resetMarketingSimulation() { memory = seed(); save(); photoMemory = {}; savePhotos(); }
