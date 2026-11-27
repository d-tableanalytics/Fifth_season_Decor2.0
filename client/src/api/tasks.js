import api from './client';

const get = (url, params) => api.get(url, { params }).then((r) => r.data);
const post = (url, body, cfg) => api.post(url, body, cfg).then((r) => r.data);
const put = (url, body) => api.put(url, body).then((r) => r.data);
const del = (url) => api.delete(url).then((r) => r.data);
const blob = (url, params) => api.get(url, { params, responseType: 'blob', timeout: 120000 }).then((r) => r);

const upload = (url, field, files, params) => {
  const fd = new FormData();
  [].concat(files).forEach((f) => fd.append(field, f));
  return api.post(url, fd, { params, timeout: 120000 }).then((r) => r.data);
};

/** Save a PDF/blob response (Content-Disposition filename wins over `fallback`). */
export function saveBlob(res, fallback = 'report.pdf') {
  const cd = res.headers['content-disposition'] || '';
  const name = cd.match(/filename="?([^";]+)"?/)?.[1] || fallback;
  const url = URL.createObjectURL(res.data);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const tasksApi = {
  meta: () => get('/tasks/meta'),
  addCategory: (name) => post('/tasks/categories', { name }),

  delegations: (params) => get('/tasks/delegations', params),
  delegation: (id) => get(`/tasks/delegations/${id}`),
  createDelegation: (b) => post('/tasks/delegations', b),
  updateDelegation: (id, b) => put(`/tasks/delegations/${id}`, b),
  deleteDelegation: (id) => del(`/tasks/delegations/${id}`),
  tickDelegation: (id, done) => put(`/tasks/delegations/${id}/checkpoints`, { done }),
  completeDelegation: (id, b) => post(`/tasks/delegations/${id}/complete`, b),
  verifyDelegation: (id, b) => post(`/tasks/delegations/${id}/verify`, b),
  requestRevision: (id, b) => post(`/tasks/delegations/${id}/revisions`, b),
  decideRevision: (id, rid, b) => post(`/tasks/delegations/${id}/revisions/${rid}/decide`, b),

  checklists: (params) => get('/tasks/checklists', params),
  checklist: (id) => get(`/tasks/checklists/${id}`),
  createChecklist: (b) => post('/tasks/checklists', b),
  updateChecklist: (id, b) => put(`/tasks/checklists/${id}`, b),
  deleteChecklist: (id) => del(`/tasks/checklists/${id}`),
  setChecklistActive: (id, active) => post(`/tasks/checklists/${id}/active`, { active }),
  checklistVerification: (id) => get(`/tasks/checklists/${id}/verification`),
  checklistPdf: (params) => blob('/tasks/checklists/pdf', params),

  occurrences: (params) => get('/tasks/occurrences', params),
  tickOccurrence: (id, done) => put(`/tasks/occurrences/${id}/checkpoints`, { done }),
  completeOccurrence: (id, b) => post(`/tasks/occurrences/${id}/complete`, b),
  verifyOccurrence: (id, b) => post(`/tasks/occurrences/${id}/verify`, b),
  verifyBatch: (b) => post('/tasks/occurrences/verify-batch', b),
  nonFunctional: (id, reason) => post(`/tasks/occurrences/${id}/non-functional`, { reason }),
  revertNonFunctional: (id) => post(`/tasks/occurrences/${id}/revert-non-functional`, {}),

  uploadFiles: (kind, id, purpose, files) => upload(`/tasks/files/${kind}/${id}`, 'files', files, { purpose }),
  deleteFile: (fileId) => del(`/tasks/files/${fileId}`),
  uploadVoice: (kind, id, file) => upload(`/tasks/voice/${kind}/${id}`, 'voice', file),
  deleteVoice: (kind, id) => del(`/tasks/voice/${kind}/${id}`),

  leavePreview: (params) => get('/tasks/leave-preview', params),
  reassign: (b) => post('/tasks/reassign', b),
  delayed: () => get('/tasks/delayed'),

  dashboard: () => get('/tasks/dashboard'),
  report: (params) => get('/tasks/report', params),
  reportItems: (params) => get('/tasks/report/items', params),
  reportPdf: (params) => blob('/tasks/report/pdf', params),
  reportPeoplePdf: (params) => blob('/tasks/report/pdf/people', params),
  score: (params) => get('/tasks/score', params),
  scorePdf: (params) => blob('/tasks/score/pdf', params),
  pc: (params) => get('/tasks/pc', params),
};

export const notificationsApi = {
  list: (params) => get('/notifications', params),
  count: () => get('/notifications/count'),
  readAll: () => post('/notifications/read-all', {}),
  read: (id) => post(`/notifications/${id}/read`, {}),
  unread: (id) => post(`/notifications/${id}/unread`, {}),
  clearRead: () => del('/notifications'),
  remove: (id) => del(`/notifications/${id}`),
};

export const holidaysApi = {
  list: () => get('/holidays'),
  add: (b) => post('/holidays', b),
  update: (id, b) => put(`/holidays/${id}`, b),
  remove: (id) => del(`/holidays/${id}`),
  setWeeklyOff: (days) => put('/holidays/weekly-off', { days }),
};
