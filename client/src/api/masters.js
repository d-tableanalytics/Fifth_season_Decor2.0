import api from './client';

const SYNC_TIMEOUT = 300_000;

export const clientsApi = {
  list: (params) => api.get('/clients', { params }).then((r) => r.data),
  summary: () => api.get('/clients/summary').then((r) => r.data.data),
  filters: () => api.get('/clients/filters').then((r) => r.data.data),
  zoneSuggest: (params) => api.get('/clients/zone-suggest', { params }).then((r) => r.data.data),
  get: (id) => api.get(`/clients/${id}`).then((r) => r.data.data),
  create: (body) => api.post('/clients', body).then((r) => r.data.data),
  update: (id, body) => api.put(`/clients/${id}`, body).then((r) => r.data.data),
  remove: (id) => api.delete(`/clients/${id}`).then((r) => r.data),
  sync: (tabs) => api.post('/clients/sync', { tabs }, { timeout: SYNC_TIMEOUT }).then((r) => r.data.data),
  syncLogs: () => api.get('/clients/sync/logs').then((r) => r.data.data),
};

export const transportsApi = {
  list: (params) => api.get('/transports', { params }).then((r) => r.data),
  summary: () => api.get('/transports/summary').then((r) => r.data.data),
  options: (search) => api.get('/transports/options', { params: { search } }).then((r) => r.data.data),
  get: (id) => api.get(`/transports/${id}`).then((r) => r.data.data),
  create: (body) => api.post('/transports', body).then((r) => r.data.data),
  update: (id, body) => api.put(`/transports/${id}`, body).then((r) => r.data.data),
  remove: (id) => api.delete(`/transports/${id}`).then((r) => r.data),
  sync: () => api.post('/transports/sync', {}, { timeout: SYNC_TIMEOUT }).then((r) => r.data.data),
  syncLogs: () => api.get('/transports/sync/logs').then((r) => r.data.data),
};

/** Option values must match server/src/config/masterFields.js */
export const OPTIONS = {
  registration_type: ['SALESMAN_VISIT', 'ONLINE_CUSTOMER', 'WALK_IN_CUSTOMER'],
  pricing_policy: ['STANDARD', 'SPECIAL', 'CUSTOM'],
  property_type: ['OWNED', 'RENTED', 'LEASED'],
  partnership_firm: ['SOLE_PROPRIETORSHIP', 'PARTNERSHIP', 'PRIVATE_LIMITED'],
  purchase_decision_making_by: ['OWNER', 'SALES_PERSON', 'BOTH'],
  business_type: [
    'CATALOGUE_BASED_RETAIL_STORES', 'INTERIOR_DESIGNERS', 'HANDLOOM', 'HOTEL_PROJECT', 'HOSPITAL_PROJECTS',
    'PROJECTS_VILLAS_AND_FARM_HOUSE', 'FURNITURE_SOFA', 'PRINTS', 'WHOLESALE_DISTRIBUTOR', 'ONLINE',
  ],
  customer_type: ['QUALITY_STYLE_CONSCIOUS', 'PRICE_CONSCIOUS', 'QUANTITY_CONSCIOUS'],
  client_type: ['PRIME', 'GENERAL'],
  payment_mode: ['CREDIT', 'CASH', 'ADVANCE'],
  client_confirmation: ['DRAFT', 'SUBMITTED', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED'],
  transport_type: ['COURIER', 'TRANSPORT', 'TRUCK', 'BUS', 'RAIL', 'AIR', 'LOCAL_DELIVERY', 'TEMPO', 'OTHER'],
  type_of_order: ['CUT', 'ROLL', 'STITCHING', 'FOLDER'],
  priority: ['A', 'B', 'C', 'D', 'E'],
  transporter_type: ['COURIER', 'TRANSPORT', 'BUS', 'TEMPO', 'HAND_DELIVERY', 'FSD_DRIVER', 'SM_COURIER', 'TRUCK', 'RAIL', 'AIR', 'LOCAL_DELIVERY', 'OTHER'],
};

const SPECIAL_LABELS = {
  CATALOGUE_BASED_RETAIL_STORES: 'Catalogue based: Retail stores',
  PROJECTS_VILLAS_AND_FARM_HOUSE: 'Projects: Villas & farm house',
  FURNITURE_SOFA: 'Furniture / Sofa',
  QUALITY_STYLE_CONSCIOUS: 'Quality / Style conscious',
  FSD_DRIVER: 'FSD Driver',
  SM_COURIER: 'SM Courier',
};

/** 'WALK_IN_CUSTOMER' -> 'Walk in customer' */
export const optionLabel = (v) =>
  v == null || v === '' ? '—' : SPECIAL_LABELS[v] || String(v).charAt(0) + String(v).slice(1).toLowerCase().replace(/_/g, ' ');

export const CONFIRMATION_BADGE = { DRAFT: 'neutral', SUBMITTED: 'info', PENDING_APPROVAL: 'warning', APPROVED: 'success', REJECTED: 'danger' };
