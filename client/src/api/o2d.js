import api from './client';

/** Every O2D stage API for one order type ('cut' | 'roll') — same server routes under /o2d/<slug>. */
function makeApis(slug) {
  const base = `/o2d/${slug}/orders`;
  const pk = `/o2d/${slug}/picking`;
  const ct = `/o2d/${slug}/cutting`;
  const dn = `/o2d/${slug}/delivery-note`;
  const pkg = `/o2d/${slug}/packing`;
  return {
    orders: {
      list: (params) => api.get(base, { params }).then((r) => r.data),
      get: (id) => api.get(`${base}/${id}`).then((r) => r.data.data),
      create: (body) => api.post(base, body).then((r) => r.data.data),
      update: (id, body) => api.put(`${base}/${id}`, body).then((r) => r.data.data),
      remove: (id) => api.delete(`${base}/${id}`).then((r) => r.data),
      action: (id, action, body) => api.post(`${base}/${id}/${action}`, body).then((r) => r.data),
      doers: () => api.get(`/o2d/${slug}/doers`).then((r) => r.data.data),
    },
    picking: {
      queue: (params) => api.get(pk, { params }).then((r) => r.data),
      get: (id) => api.get(`${pk}/${id}`).then((r) => r.data.data),
      pieces: (id, itemId, tab) => api.get(`${pk}/${id}/lines/${itemId}/pieces`, { params: { tab } }).then((r) => r.data.data),
      savePicks: (id, itemId, body) => api.put(`${pk}/${id}/lines/${itemId}/picks`, body).then((r) => r.data),
      notFound: (id, itemId, reason) => api.post(`${pk}/${id}/lines/${itemId}/not-found`, { reason }).then((r) => r.data),
      saveBatch: (id, remark) => api.post(`${pk}/${id}/batches`, { remark }).then((r) => r.data),
      autoAdvance: (id) => api.post(`${pk}/${id}/auto-advance`).then((r) => r.data),
      sendToCutting: (id, allowShortPick) => api.post(`${pk}/${id}/send-to-cutting`, { allowShortPick }).then((r) => r.data),
      sendBack: (id, reason) => api.post(`${pk}/${id}/send-back`, { reason }).then((r) => r.data),
      split: (id) => api.post(`${pk}/${id}/split`).then((r) => r.data),
      merge: (id, into) => api.post(`${pk}/${id}/merge`, { into }).then((r) => r.data),
      print: (ids) => api.get(`${pk}/print`, { params: { ids: ids.join(',') } }).then((r) => r.data.data),
    },
    cutting: {
      queue: (params) => api.get(ct, { params }).then((r) => r.data),
      get: (id) => api.get(`${ct}/${id}`).then((r) => r.data.data),
      save: (id, body) => api.put(`${ct}/${id}`, body).then((r) => r.data),
      sendBack: (id, reason) => api.post(`${ct}/${id}/send-back`, { reason }).then((r) => r.data),
      iocBatches: () => api.get(`${ct}/ioc-batches`).then((r) => r.data.data),
      iocBatch: (no) => api.get(`${ct}/ioc-batches/${no}`).then((r) => r.data.data),
    },
    deliveryNote: {
      queue: (params) => api.get(dn, { params }).then((r) => r.data),
      get: (id) => api.get(`${dn}/${id}`).then((r) => r.data.data),
      editNumber: (id, value) => api.put(`${dn}/${id}/number`, { delivery_note_no: value }).then((r) => r.data),
      saveLr: (id, lr) => api.put(`${dn}/${id}/lr`, { lr_number: lr }).then((r) => r.data),
      sendLr: (id) => api.post(`${dn}/${id}/lr/send`, {}, { timeout: 120_000 }).then((r) => r.data),
      moveToPacking: (id) => api.post(`${dn}/${id}/move-to-packing`).then((r) => r.data),
      sendBack: (id, reason) => api.post(`${dn}/${id}/send-back`, { reason }).then((r) => r.data),
      print: ({ orders = [], items = [] }) => api.get(`${dn}/print`, { params: { orders: orders.join(','), items: items.join(',') } }).then((r) => r.data.data),
    },
    packing: {
      queue: (params) => api.get(pkg, { params }).then((r) => r.data),
      lookup: (code) => api.get(`${pkg}/lookup`, { params: { code } }).then((r) => r.data.data),
      get: (id) => api.get(`${pkg}/${id}`).then((r) => r.data.data),
      createParcel: (id, body) => api.post(`${pkg}/${id}/parcels`, body).then((r) => r.data),
      complete: (id) => api.post(`${pkg}/${id}/complete`).then((r) => r.data),
      moveToPlanning: (id) => api.post(`${pkg}/${id}/move-to-planning`).then((r) => r.data),
      sendBack: (id, reason) => api.post(`${pkg}/${id}/send-back`, { reason }).then((r) => r.data),
    },
  };
}

/** Order types shown in O2D. Roll has no IOC (Mark for IOC / IOC Meter / IOC batches). */
export const O2D_TYPES = {
  CUT: { type: 'CUT', slug: 'cut', perm: 'o2d_cut', label: 'Cut', ioc: true, apis: makeApis('cut') },
  ROLL: { type: 'ROLL', slug: 'roll', perm: 'o2d_roll', label: 'Roll', ioc: false, apis: makeApis('roll') },
};
export const o2dTypeBySlug = (slug) => (slug === 'roll' ? O2D_TYPES.ROLL : O2D_TYPES.CUT);

// Cut-only names kept for existing imports
export const cutOrdersApi = O2D_TYPES.CUT.apis.orders;
export const pickingApi = O2D_TYPES.CUT.apis.picking;
export const cuttingApi = O2D_TYPES.CUT.apis.cutting;
export const deliveryNoteApi = O2D_TYPES.CUT.apis.deliveryNote;
export const packingApi = O2D_TYPES.CUT.apis.packing;

export const PICK_TABS = [
  { key: 'CUT', label: 'Cut' },
  { key: 'ROLL', label: 'Roll' },
  { key: 'SMALL', label: 'Small (≤ 5)' },
  { key: 'IN_CHECKING', label: 'In Checking' },
];

export const o2dLookups = {
  clients: (search) => api.get('/o2d/lookups/clients', { params: { search } }).then((r) => r.data.data),
  clientTransports: (id, type = 'CUT') => api.get(`/o2d/lookups/clients/${id}/transports`, { params: { type } }).then((r) => r.data.data),
  transports: (search) => api.get('/o2d/lookups/transports', { params: { search } }).then((r) => r.data.data),
  skus: (search) => api.get('/o2d/lookups/skus', { params: { search } }).then((r) => r.data.data),
};

export const ORDER_MODES = [
  { key: 'MANUAL', label: 'Manual' },
  { key: 'ONLINE', label: 'Online' },
  { key: 'THIRD_PARTY', label: 'Third Party' },
];
export const UNITS = ['Mtr', 'Pcs', 'Kg', 'Roll', 'Set', 'Yard'];

export const STAGE_LABELS = {
  DRAFT: 'Draft',
  SUBMITTED: 'Order Enquiry',
  PAYMENT_CHECK: 'Payment Check',
  STOCK_CHECK: 'Stock Check',
  PICKING: 'Picking',
  ROLL_DEPT_REQUIRED: 'Roll Dept Required',
  IOC_PENDING: 'IOC Pending',
  MATERIAL_RELEASED: 'Material Released',
  CUTTING: 'Cutting',
  CUTTING_COMPLETED: 'Cutting Completed',
  DELIVERY_NOTE: 'Delivery Note',
  PACKING: 'Packing',
  PACKING_COMPLETED: 'Packing Completed',
  PLANNING_TO_DISPATCH: 'Planning to Dispatch',
  DELIVERY_NOTE_GENERATED: 'Delivery Note Generated',
  DISPATCHED: 'Dispatched',
  ON_HOLD: 'On Hold',
};

/** Picking and later — conversion to Roll not allowed (mirrors the server rule). */
export const PICKING_OR_LATER = new Set([
  'PICKING', 'ROLL_DEPT_REQUIRED', 'IOC_PENDING', 'MATERIAL_RELEASED', 'CUTTING', 'CUTTING_COMPLETED', 'DELIVERY_NOTE',
  'PACKING', 'PACKING_COMPLETED', 'PLANNING_TO_DISPATCH', 'DELIVERY_NOTE_GENERATED', 'DISPATCHED',
]);
