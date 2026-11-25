import api from './client';

export const crmApi = {
  paymentList: (params) => api.get('/crm/payment-check', { params }).then((r) => r.data),
  payment: (id) => api.get(`/crm/payment-check/${id}`).then((r) => r.data.data),
  paymentLink: (id) => api.post(`/crm/payment-check/${id}/link`).then((r) => r.data.data),
  sendLedger: (id, recipients) => api.post(`/crm/payment-check/${id}/send-ledger`, { recipients }, { timeout: 120_000 }).then((r) => r.data.data),
  recheck: (id) => api.post(`/crm/payment-check/${id}/recheck`).then((r) => r.data),
  stockList: (params) => api.get('/crm/stock-check', { params }).then((r) => r.data),
  stock: (id) => api.get(`/crm/stock-check/${id}`).then((r) => r.data.data),
  availability: (id, itemId) => api.get(`/crm/stock-check/${id}/items/${itemId}/availability`).then((r) => r.data.data),
  saveItem: (id, itemId, body) => api.put(`/crm/stock-check/${id}/items/${itemId}`, body).then((r) => r.data.data),
  holdStock: (id, reason) => api.post(`/crm/stock-check/${id}/hold`, { reason }).then((r) => r.data),
  completeStock: (id) => api.post(`/crm/stock-check/${id}/complete`).then((r) => r.data),
  proforma: (id) => api.post(`/crm/stock-check/${id}/proforma`).then((r) => r.data),
  shareProforma: (id, recipients) => api.post(`/crm/stock-check/${id}/proforma/share`, { recipients }, { timeout: 120_000 }).then((r) => r.data.data),
  advance: (id, body) => api.post(`/crm/stock-check/${id}/advance`, body).then((r) => r.data),
  altSync:() => api.post('/crm/alternatives/sync', {}, { timeout: 180_000 }).then((r) => r.data.data),
  altSyncLogs: () => api.get('/crm/alternatives/sync/logs').then((r) => r.data.data),
  approvalList: (params) => api.get('/crm/manager-approval', { params }).then((r) => r.data),
  decide: (id, approve, remark) => api.post(`/crm/manager-approval/${id}/${approve ? 'approve' : 'reject'}`, { remark }).then((r) => r.data),
};

/** No-login customer link (payment promise). */
export const promiseApi = {
  get: (token) => api.get(`/public/payment-promise/${token}`).then((r) => r.data.data),
  submit: (token, body) => api.post(`/public/payment-promise/${token}`, body).then((r) => r.data),
  proforma: (token) => api.get(`/public/proforma/${token}`).then((r) => r.data.data),
  track: (token) => api.get(`/public/track/${token}`).then((r) => r.data.data),
};

export const LEDGER_RECIPIENTS = [
  { key: 'CLIENT_OWNER', label: 'Client owner' },
  { key: 'CLIENT_ACCOUNTANT', label: 'Client accountant' },
  { key: 'CLIENT_SALES_PERSON', label: 'Client sales person' },
  { key: 'CLIENT_GROUP', label: 'Client WhatsApp group' },
];

export const inr = (v) => (v == null ? '—' : `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
export const dayFmt = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const stampFmt = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
