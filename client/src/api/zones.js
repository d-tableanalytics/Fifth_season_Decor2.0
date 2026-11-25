import api from './client';

/** Must match server/src/config/zones.js */
export const ZONES = ['CENTRAL', 'EAST', 'WEST', 'NORTH', 'SOUTH', 'NORTH-EAST', 'NORTH-WEST', 'SOUTH-EAST', 'SOUTH-WEST'];

export const zonesApi = {
  list: (params) => api.get('/zones', { params }).then((r) => r.data.data),
  bulk: (body) => api.post('/zones/bulk', body).then((r) => r.data.data),
  update: (id, body) => api.put(`/zones/${id}`, body).then((r) => r.data.data),
  remove: (id) => api.delete(`/zones/${id}`).then((r) => r.data),
  backfill: () => api.post('/zones/backfill').then((r) => r.data.data),
};

// PIN -> zone map, cached for the session (used by Client / Transport forms)
let mapPromise = null;
export const resetZoneCache = () => {
  mapPromise = null;
};
/** Exact PIN match only; resolves to the zone or null. */
export const zoneForPin = (pin) => {
  if (!mapPromise) {
    mapPromise = api
      .get('/zones/map')
      .then((r) => new Map(r.data.data.map((m) => [m.pincode, m.zone])))
      .catch(() => {
        mapPromise = null;
        return new Map();
      });
  }
  return mapPromise.then((m) => m.get(String(pin).trim()) || null);
};
