/** Delivery zones (plain list — it has changed before, so it is not a DB enum). */
export const ZONES = ['CENTRAL', 'EAST', 'WEST', 'NORTH', 'SOUTH', 'NORTH-EAST', 'NORTH-WEST', 'SOUTH-EAST', 'SOUTH-WEST'];

/** Only Surat clients get a zone (Surat = direct delivery; others go via transport). */
export const isSurat = (city) => String(city ?? '').trim().toLowerCase() === 'surat';

/** Server-side rule for every client write path (form, sheet sync, import). */
export const applyClientZoneRule = (rec) => {
  if (!isSurat(rec.city)) rec.zone = null;
  return rec;
};
