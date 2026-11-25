import api from './client';

export const metaApi = {
  modules: () => api.get('/meta/modules').then((r) => r.data),
};

export const employeesApi = {
  list: (params) => api.get('/employees', { params }).then((r) => r.data),
  get: (id) => api.get(`/employees/${id}`).then((r) => r.data.data),
  roleOptions: () => api.get('/employees/role-options').then((r) => r.data.data),
  create: (body) => api.post('/employees', body).then((r) => r.data.data),
  update: (id, body) => api.put(`/employees/${id}`, body).then((r) => r.data.data),
  setStatus: (id, is_active) => api.patch(`/employees/${id}/status`, { is_active }).then((r) => r.data.data),
  remove: (id) => api.delete(`/employees/${id}`).then((r) => r.data),
};

export const rolesApi = {
  list: () => api.get('/roles').then((r) => r.data.data),
  get: (id) => api.get(`/roles/${id}`).then((r) => r.data.data),
  create: (body) => api.post('/roles', body).then((r) => r.data.data),
  update: (id, body) => api.put(`/roles/${id}`, body).then((r) => r.data.data),
  remove: (id) => api.delete(`/roles/${id}`).then((r) => r.data),
};
