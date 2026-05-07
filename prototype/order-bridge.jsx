// 2990's — Shared POS ↔ Backend order bridge.
// Uses localStorage so the showroom POS (index/prototype.html) and the
// backend portal (backend.html) can run side-by-side in two tabs and
// trade data live. Used for the testimony / demo.

const ORDER_BRIDGE_KEY = '2990-orders-v1';
const ORDER_BRIDGE_EVT = '2990-orders-changed';

function readBridgeOrders() {
  try {
    const raw = localStorage.getItem(ORDER_BRIDGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function writeBridgeOrders(orders) {
  try {
    localStorage.setItem(ORDER_BRIDGE_KEY, JSON.stringify(orders));
    window.dispatchEvent(new Event(ORDER_BRIDGE_EVT));
  } catch (e) { /* quota/etc — fine for demo */ }
}

function clearBridgeOrders() {
  writeBridgeOrders([]);
}

// Build a backend-shaped order from the POS handover state.
function buildBackendOrder({ cart, customer, emergency, delivery, payment, addons, staff, paidAmount, approvalCode, slipDataUrl, total, addonTotal, subtotal }) {
  const id = 'SO-' + Math.floor(2050 + Math.random() * 9000);
  // Coerce delivery.date (Date instance from POS) to a serializable timestamp
  const deliveryDate = delivery?.date ? (delivery.date instanceof Date ? delivery.date.getTime() : delivery.date) : null;
  return {
    id,
    placedAt: Date.now(),
    staff: staff?.name || 'Showroom',
    lane: 'received',
    customer: {
      name: customer?.name || 'Walk-in',
      phone: customer?.phone || '',
      email: customer?.email || '',
      address: customer?.address || '',
      postcode: customer?.postcode || '',
      city: customer?.city || '',
      state: customer?.state || '',
    },
    emergency: emergency?.name ? { ...emergency } : null,
    cart: (cart || []).map(c => ({ id: c.id, qty: c.qty, config: c.config })),
    addons: (addons || []).map(a => typeof a === 'string' ? { id: a } : { ...a }),
    subtotal: subtotal || 0,
    addonTotal: addonTotal || 0,
    paid: paidAmount || total || 0,
    slipVerify: slipDataUrl ? 'pending' : 'none',
    slipUrl: slipDataUrl || null,
    delivery: { date: deliveryDate, slot: delivery?.slot || null, tbd: !!delivery?.tbd, notes: delivery?.notes || '' },
    paymentMethod: payment || 'transfer',
    approvalCode: approvalCode || null,
    notes: delivery?.notes || '',
  };
}

function pushOrderToBackend(payload) {
  const order = buildBackendOrder(payload);
  const list = readBridgeOrders();
  list.unshift(order);
  writeBridgeOrders(list);
  return order;
}

// React-friendly subscriber: listens to both same-tab and cross-tab changes.
function subscribeBridge(cb) {
  const onChange = () => cb(readBridgeOrders());
  const onStorage = (e) => { if (e.key === ORDER_BRIDGE_KEY) cb(readBridgeOrders()); };
  window.addEventListener(ORDER_BRIDGE_EVT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(ORDER_BRIDGE_EVT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}

Object.assign(window, {
  ORDER_BRIDGE_KEY,
  readBridgeOrders,
  writeBridgeOrders,
  clearBridgeOrders,
  pushOrderToBackend,
  subscribeBridge,
});
