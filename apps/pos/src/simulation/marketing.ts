// Local-simulation stand-ins for 2990's /marketing API and the persona that
// can see it. Fictional data only — seeded with the design prototype's own
// sample displays and requests so the Marketing screens can be checked against
// the design without touching a live system. Never calls fetch.

const KEY = '2990:mobile-simulation:marketing:v1';
const PERSONA_KEY = '2990:simulation:persona';

type Row = Record<string, any>;
interface MarketingStore { displays: Row[]; floorplans: Record<string, Row>; requests: Row[]; serial: number }

const now = () => new Date().toISOString();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-pos-simulation': 'local-only' },
});

/** 'marketing' turns the demo account into the marketing account. */
export const simulationPersona = (): 'marketing' | 'sales' => {
  try { return localStorage.getItem(PERSONA_KEY) === 'marketing' ? 'marketing' : 'sales'; } catch { return 'sales'; }
};

const display = (id: string, venueId: string, type: string, name: string, code: string, photoUrl: string | null, extra: Row = {}): Row => ({
  id, venue_id: venueId, type, model_id: null, name, code, photo_url: photoUrl, is_new: false, fabric: '', colour: '', leg: '', seat: '',
  modules: [], size: '', height: '', divan: '', gap: '', qty: 1, created_at: '2026-10-01T02:00:00.000Z', created_by_name: 'Demo', removed_at: null, ...extra,
});

function seed(): MarketingStore {
  const kl = 'demo-venue-kl';
  return {
    serial: 100,
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

const displayWire = (r: Row) => ({
  id: r.id, venueId: r.venue_id, type: r.type, modelId: r.model_id, name: r.name, code: r.code, photoUrl: r.photo_url, isNew: r.is_new,
  fabric: r.fabric, colour: r.colour, leg: r.leg, seat: r.seat, modules: r.modules, size: r.size, height: r.height, divan: r.divan,
  gap: r.gap, qty: r.qty, createdAt: r.created_at, createdByName: r.created_by_name,
});
const requestWire = (r: Row) => ({
  id: r.id, type: r.type, status: r.status, supplierCode: r.supplier_code, model: r.model, fabric: r.fabric, colour: r.colour, leg: r.leg,
  seat: r.seat, size: r.size, height: r.height, divan: r.divan, gap: r.gap, modules: r.modules, rows: r.combo_rows, venueId: r.venue_id,
  action: r.action, replaceId: r.replace_display_id, by: r.requested_by_name, byRole: r.requested_by_role, createdAt: r.created_at, updatedAt: r.created_at,
});
const requestCols = (b: Row) => ({
  type: b.type, status: b.status, supplier_code: b.supplierCode ?? '', model: b.model ?? '', fabric: b.fabric ?? '', colour: b.colour ?? '',
  leg: b.leg ?? '', seat: b.seat ?? '', size: b.size ?? '', height: b.height ?? '', divan: b.divan ?? '', gap: b.gap ?? '',
  modules: b.modules ?? [], combo_rows: b.rows ?? [], venue_id: b.venueId, action: b.action,
  replace_display_id: b.action === 'replace' ? (b.replaceId ?? null) : null,
});

/** Handle a /marketing/* request, or return null when the path is not ours. */
export function marketingDispatch(path: string, method: string, body: Row): Response | null {
  if (!path.startsWith('/marketing/')) return null;
  const st = store();
  const me = simulationPersona() === 'marketing' ? { name: 'Marketing', role: 'Marketing' } : { name: 'Demo Sales', role: 'Sales' };
  const live = st.displays.filter((d) => !d.removed_at);

  if (path === '/marketing/state' && method === 'GET') {
    return json({
      displays: live.map(displayWire),
      requests: st.requests.filter((r) => r.status === 'pending' || r.status === 'completed').sort((a, b) => b.created_at.localeCompare(a.created_at)).map(requestWire),
      floorplans: Object.values(st.floorplans).map((f) => ({ venueId: f.venue_id, updatedAt: f.updated_at, fileName: f.file_name })),
    });
  }
  if (path === '/marketing/displays' && method === 'POST') {
    if (!body.venueId || !body.name) return json({ error: 'validation_failed' }, 400);
    if (body.type === 'sofa' && !(body.modules ?? []).length) return json({ error: 'validation_failed', reason: 'A sofa needs its components.' }, 400);
    const row = display(`sim-d${st.serial++}`, body.venueId, body.type, body.name, body.code ?? '', body.photoUrl ?? null, {
      model_id: body.modelId ?? null, fabric: body.fabric ?? '', colour: body.colour ?? '', leg: body.leg ?? '', seat: body.seat ?? '',
      modules: body.modules ?? [], size: body.size ?? '', height: body.height ?? '', divan: body.divan ?? '', gap: body.gap ?? '',
      qty: body.qty ?? 1, created_at: now(), created_by_name: me.name,
    });
    st.displays.push(row); save();
    return json({ display: displayWire(row) }, 201);
  }
  let m = /^\/marketing\/displays\/([^/]+)$/.exec(path);
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
      st.floorplans[vid] = { venue_id: vid, content_type: body.contentType, image_b64: body.dataB64, file_name: body.fileName ?? '', updated_at: now() };
      save();
      return json({ floorplan: { venueId: vid, updatedAt: st.floorplans[vid]!.updated_at, fileName: body.fileName ?? '' } });
    }
    if (method === 'DELETE') { delete st.floorplans[vid]; save(); return json({ ok: true }); }
  }
  if (path === '/marketing/requests' && method === 'POST') {
    if (!body.venueId || !body.action) return json({ error: 'validation_failed' }, 400);
    const row = { id: `sim-r${st.serial++}`, ...requestCols(body), requested_by_name: me.name, requested_by_role: me.role, created_at: now() };
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
        is_new: true, fabric: row.fabric, colour: row.colour, leg: row.leg, seat: row.seat, modules: row.modules, size: row.size,
        height: row.height, divan: row.divan, gap: row.gap, created_at: now(), created_by_name: me.name,
      });
      st.displays.push(created);
      row.status = 'arrived';
      save();
      return json({ displayId: created.id, removedName });
    }
    if (method === 'PUT') { Object.assign(row, requestCols(body)); save(); return json({ request: requestWire(row) }); }
    if (method === 'DELETE') { row.status = 'deleted'; save(); return json({ ok: true }); }
  }
  return json({ error: 'simulation_route_missing', reason: `${method} ${path} has not been implemented.` }, 501);
}

export function resetMarketingSimulation() { memory = seed(); save(); }
