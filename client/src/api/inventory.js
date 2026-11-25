import api from './client';

export const inventoryApi = {
  list: (params) => api.get('/inventory', { params }).then((r) => r.data),
  summary: () => api.get('/inventory/summary').then((r) => r.data.data),
  catalogues: (stock_type) => api.get('/inventory/catalogues', { params: { stock_type } }).then((r) => r.data.data),
  get: (id) => api.get(`/inventory/${id}`).then((r) => r.data.data),
  create: (body) => api.post('/inventory', body).then((r) => r.data.data),
  update: (id, body) => api.put(`/inventory/${id}`, body).then((r) => r.data.data),
  remove: (id) => api.delete(`/inventory/${id}`).then((r) => r.data),
  // ~54k rows from Google Sheets can take a while — allow up to 5 minutes
  sync: (body) => api.post('/inventory/sync', body, { timeout: 300_000 }).then((r) => r.data.data),
  syncLogs: () => api.get('/inventory/sync/logs').then((r) => r.data.data),
};

export const STOCK_TYPES = [
  { key: 'CUT', label: 'Cut Stock' },
  { key: 'ROLL', label: 'Roll Stock' },
  { key: 'IN_CHECKING', label: 'In Checking' },
];
export const STOCK_LABEL = Object.fromEntries(STOCK_TYPES.map((t) => [t.key, t.label]));
