/**
 * Field definitions for Client Master and Transport Master.
 * One list drives: API validation, DB column lists, Excel import and Google Sheet mapping.
 *
 * type: text | int | num | enum | multi | bool | date | json
 * Incoming sheet/export headers are matched by normalised name (case/punctuation-insensitive),
 * plus any `aliases`.
 */

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

// Spreadsheet wording -> enum value
const SYNONYMS = {
  RENTAL: 'RENTED', RENT: 'RENTED', OWNERSHIP: 'OWNED', OWN: 'OWNED', LEASE: 'LEASED',
  SALES_PERSON_S: 'SALES_PERSON', SALESPERSON: 'SALES_PERSON',
  PVT_LTD: 'PRIVATE_LIMITED', PRIVATE_LTD: 'PRIVATE_LIMITED',
  DRIVER: 'FSD_DRIVER',
};

const f = (key, type, opts = {}) => ({ key, type, ...opts });

export const TRANSPORT_FIELDS = [
  f('transport_id', 'text', { max: 20 }),
  f('transport_name', 'text', { max: 160, required: true }),
  f('transport_contact_person', 'text', { max: 120 }),
  f('transport_contact_number', 'text', { max: 20 }),
  f('gstin', 'text', { max: 15, upper: true }),
  f('transport_address', 'text', { max: 255 }),
  f('transport_city', 'text', { max: 80 }),
  f('transport_state', 'text', { max: 80 }),
  f('transport_country', 'text', { max: 80, country: true, default: 'India' }),
  f('transport_pin', 'text', { max: 10 }),
  f('transport_full_address', 'text'),
  f('transport_vcard_photo', 'text', { max: 255, image: true }),
  f('transport_latitude', 'num', { min: -90, max: 90 }),
  f('transport_longitude', 'num', { min: -180, max: 180 }),
  f('zone', 'text', { max: 30, upper: true }),
  f('to_transport_contact_number', 'text', { max: 20 }),
  f('to_contact_person', 'text', { max: 120 }),
  f('to_transport_gst', 'text', { max: 15, upper: true }),
  f('to_transport_city', 'text', { max: 80 }),
  f('to_transport_state', 'text', { max: 80 }),
  f('to_transport_country', 'text', { max: 80, country: true, default: 'India' }),
  f('to_transport_pin', 'text', { max: 10 }),
  f('to_transport_full_address', 'text'),
  f('to_destinations', 'json'),
  f('transport_type', 'enum', { options: OPTIONS.transport_type }),
  f('tracking_url', 'text', { max: 500 }),
  f('approx_delivery_time', 'text', { max: 60 }),
  f('area', 'text', { max: 120 }),
  f('is_active', 'bool', { default: true }),
];

export const CLIENT_FIELDS = [
  f('client_id', 'text', { max: 20, upper: true }),
  f('visit_no', 'text', { max: 20 }),
  f('registration_type', 'enum', { options: OPTIONS.registration_type }),
  f('person_attending', 'text', { max: 120 }),
  f('sales_person_emp_id', 'text', { max: 20 }),
  f('company_name', 'text', { max: 200, required: true }),
  f('pricing_policy', 'enum', { options: OPTIONS.pricing_policy }),
  f('plot_no_building_name', 'text', { max: 200 }),
  f('landmark1', 'text', { max: 160 }),
  f('landmark2', 'text', { max: 160 }),
  f('street_road_name', 'text', { max: 200 }),
  f('city', 'text', { max: 80 }),
  f('state', 'text', { max: 80 }),
  f('country', 'text', { max: 80, country: true, default: 'India' }),
  f('pin', 'text', { max: 10 }),
  f('location_url', 'text', { max: 500 }),
  f('latitude', 'num', { min: -90, max: 90 }),
  f('longitude', 'num', { min: -180, max: 180 }),
  f('full_address', 'text'),
  f('zone', 'text', { max: 30, upper: true }),
  f('gstin', 'text', { max: 15, upper: true }),
  f('pan_no', 'text', { max: 10, upper: true }),
  f('owner_name', 'text', { max: 160 }),
  f('owner_contact_no', 'text', { max: 20 }),
  f('owner_whatsapp_no', 'text', { max: 20 }),
  f('whatsapp_group_name', 'text', { max: 200 }),
  f('whatsapp_group_id', 'text', { max: 100 }),
  f('accounts_person_name', 'text', { max: 160 }),
  f('accounts_person_whatsapp_no', 'text', { max: 20 }),
  f('account_contact_name', 'text', { max: 160 }),
  f('customer_sales_person_name', 'text', { max: 160 }),
  f('customer_sales_person_whatsapp_no', 'text', { max: 20 }),
  f('customer_sales_person_contact', 'text', { max: 20 }),
  f('number_of_floors', 'int'),
  f('team_size', 'int'),
  f('property_type', 'enum', { options: OPTIONS.property_type }),
  f('shop_size_sq_ft', 'num'),
  f('years_in_business', 'int'),
  f('number_of_stores_owned', 'int'),
  f('partnership_firm', 'enum', { options: OPTIONS.partnership_firm }),
  f('purchase_decision_making_by', 'multi', { options: OPTIONS.purchase_decision_making_by }),
  f('business_type', 'multi', { options: OPTIONS.business_type }),
  f('customer_type', 'multi', { options: OPTIONS.customer_type }),
  f('blackout_quality', 'text', { max: 160 }),
  f('monthly_purchase_quantity', 'num'),
  f('price_per_meter', 'num'),
  f('purchase_from', 'text', { max: 200 }),
  f('referred_by', 'text', { max: 200 }),
  f('payment_report', 'text', { max: 200 }),
  f('peers_local_market_feedback', 'text'),
  f('vcard_front_url', 'text', { max: 255, image: true }),
  f('vcard_back_url', 'text', { max: 255, image: true }),
  f('showroom_front_url', 'text', { max: 255, image: true }),
  f('showroom_back_url', 'text', { max: 255, image: true }),
  f('salesman_personal_observation', 'text'),
  f('yearly_turnover', 'num'),
  f('no_of_suppliers', 'int'),
  f('credit_days', 'int'),
  f('credit_limit', 'num'),
  f('client_type', 'enum', { options: OPTIONS.client_type, default: 'GENERAL' }),
  f('payment_mode', 'enum', { options: OPTIONS.payment_mode, default: 'CREDIT' }),
  f('client_confirmation', 'enum', { options: OPTIONS.client_confirmation, default: 'DRAFT' }),
  f('confirmation_timestamp', 'date'),
  f('approval_message_sent', 'bool', { default: false }),
  f('skip_payment_check', 'bool', { default: false }),
  f('skip_payment_reason', 'text', { max: 255 }),
  f('is_active', 'bool', { default: true }),
];

export const IMAGE_FIELDS = {
  clients: CLIENT_FIELDS.filter((x) => x.image).map((x) => x.key),
  transports: TRANSPORT_FIELDS.filter((x) => x.image).map((x) => x.key),
};

/* ---------------- Value coercion (for sheet / Excel input) ---------------- */

export const normHeader = (h) => String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const token = (v) => {
  const t = String(v).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  return SYNONYMS[t] || t;
};

/** Coerce one raw spreadsheet value for a field. Returns { value, invalid }. */
export function coerce(field, raw) {
  const s = raw == null ? '' : String(raw).replace(/\s+/g, ' ').trim();
  const empty = s === '' || s === '-' || s === '–' || s.toLowerCase() === 'null';
  switch (field.type) {
    case 'text': {
      if (empty) return { value: null };
      let v = field.upper ? s.toUpperCase() : s;
      if (field.country && /^india\W*$/i.test(v)) v = 'India';
      return { value: field.max ? v.slice(0, field.max) : v };
    }
    case 'int':
    case 'num': {
      if (empty) return { value: null };
      const n = Number(s.replace(/[,₹\s]/g, ''));
      if (!Number.isFinite(n) || Math.abs(n) >= 1e12) return { value: null, invalid: true };
      if (field.min !== undefined && (n < field.min || n > field.max)) return { value: null, invalid: true };
      return { value: field.type === 'int' ? Math.round(n) : n };
    }
    case 'enum': {
      if (empty) return { value: null };
      const t = token(s);
      return field.options.includes(t) ? { value: t } : { value: null, invalid: true };
    }
    case 'multi': {
      // Accepts "['OWNER', 'BOTH']" (export) or "Owner, Sales person's" (sheet)
      const parts = s.replace(/^\[|\]$/g, '').split(',').map((p) => p.replace(/['"]/g, '').trim()).filter(Boolean);
      const vals = [...new Set(parts.map(token).filter((t) => field.options.includes(t)))];
      return { value: vals, invalid: vals.length < parts.length };
    }
    case 'bool':
      if (empty) return { value: field.default ?? null };
      return { value: /^(true|yes|1|y)$/i.test(s) };
    case 'date': {
      if (empty) return { value: null };
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? { value: null, invalid: true } : { value: d.toISOString().slice(0, 10) };
    }
    case 'json': {
      if (empty) return { value: [] };
      try {
        const v = JSON.parse(s.replace(/'/g, '"'));
        return { value: Array.isArray(v) ? v : [] };
      } catch {
        return { value: [], invalid: true };
      }
    }
    default:
      return { value: s || null };
  }
}

/** Map a header row to field indexes. */
export function mapColumns(headers, fields) {
  const norm = headers.map(normHeader);
  const out = {};
  for (const fd of fields) {
    const candidates = [normHeader(fd.key), ...(fd.aliases || []).map(normHeader)];
    const idx = norm.findIndex((h) => candidates.includes(h));
    if (idx >= 0) out[fd.key] = idx;
  }
  return out;
}

/** Build a record from a raw row using a column map. */
export function rowToRecord(row, colMap, fields) {
  const rec = {};
  let invalid = 0;
  for (const fd of fields) {
    if (colMap[fd.key] === undefined) continue;
    const { value, invalid: bad } = coerce(fd, row[colMap[fd.key]]);
    rec[fd.key] = value;
    if (bad) invalid++;
  }
  return { rec, invalid };
}
