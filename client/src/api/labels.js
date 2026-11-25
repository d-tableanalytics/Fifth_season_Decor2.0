import api from './client';

export const labelsApi = {
  stages: () => api.get('/labels/stages').then((r) => r.data.data),
  list: (stage) => api.get('/labels/templates', { params: { stage } }).then((r) => r.data.data),
  get: (id) => api.get(`/labels/templates/${id}`).then((r) => r.data.data),
  create: (body) => api.post('/labels/templates', body).then((r) => r.data.data),
  update: (id, body) => api.put(`/labels/templates/${id}`, body).then((r) => r.data.data),
  remove: (id) => api.delete(`/labels/templates/${id}`).then((r) => r.data),
  makeDefault: (id) => api.post(`/labels/templates/${id}/default`).then((r) => r.data),
  records: (stage, search) => api.get('/labels/records', { params: { stage, search } }).then((r) => r.data.data),
  data: (stage, ids) => api.get('/labels/data', { params: { stage, ids: ids.join(',') } }).then((r) => r.data.data),
};

export const STAGE_LABEL = { CUT_ITEM: 'Cut Item', LEFTOVER: 'Leftover Fabric', PACKING: 'Packing', PARCEL: 'Parcel (Packet Label)' };

/** Width the labels need on a sheet; null when the label is the paper itself. */
export function sheetOverflow(t) {
  const pc = t.print_config || {};
  const paper = PAPERS.find((p) => p.key === (pc.paper || 'LABEL'));
  if (!paper || paper.key === 'LABEL') return null;
  const pw = paper.key === 'CUSTOM' ? pc.paper_w || 100 : paper.w;
  const n = Math.max(1, pc.per_row || 1);
  const need = n * t.width_mm + (n - 1) * (pc.gap_x ?? 2) + 2 * (pc.margin ?? 5);
  return need > pw ? { need: Math.round(need * 10) / 10, paper: pw } : null;
}

/** Paper presets for printing. LABEL = paper is the label itself (thermal label printers). */
export const PAPERS = [
  { key: 'LABEL', label: 'Label size (thermal roll)' },
  { key: 'A4', label: 'A4 sheet (210 × 297 mm)', w: 210, h: 297 },
  { key: 'A5', label: 'A5 sheet (148 × 210 mm)', w: 148, h: 210 },
  { key: 'LETTER', label: 'Letter (216 × 279 mm)', w: 215.9, h: 279.4 },
  { key: 'CUSTOM', label: 'Custom paper size' },
];
