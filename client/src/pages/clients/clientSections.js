import { OPTIONS } from '../../api/masters';
import { ZONES } from '../../api/zones';

const t = (key, label, extra = {}) => ({ key, label, type: 'text', ...extra });
const num = (key, label, extra = {}) => ({ key, label, type: 'number', ...extra });
const sel = (key, label, extra = {}) => ({ key, label, type: 'select', options: OPTIONS[key], ...extra });

/** Client Master form layout. Keys match the API (snake_case). */
export const CLIENT_SECTIONS = [
  {
    id: 'basic',
    title: 'Basic details',
    fields: [
      t('company_name', 'Company name', { required: true, full: true, max: 200 }),
      t('client_id', 'Client ID', { max: 20, upper: true }),
      t('visit_no', 'Visit no.', { max: 20 }),
      sel('registration_type', 'Registration type'),
      t('person_attending', 'Person attending', { max: 120 }),
      t('sales_person_emp_id', 'Sales person emp. ID', { max: 20 }),
      sel('pricing_policy', 'Pricing policy'),
      sel('client_type', 'Client type'),
      sel('payment_mode', 'Payment mode'),
      { key: 'is_active', label: 'Status', type: 'switch', on: 'Active', off: 'Inactive' },
    ],
  },
  {
    id: 'address',
    title: 'Address & location',
    fields: [
      t('plot_no_building_name', 'Plot no. / Building', { max: 200 }),
      t('street_road_name', 'Street / Road', { max: 200 }),
      t('landmark1', 'Landmark 1', { max: 160 }),
      t('landmark2', 'Landmark 2', { max: 160 }),
      t('city', 'City', { max: 80 }),
      t('state', 'State', { max: 80 }),
      t('country', 'Country', { max: 80 }),
      t('pin', 'PIN', { max: 10 }),
      { key: 'zone', label: 'Zone', type: 'select', options: ZONES, raw: true, hint: 'Only Surat clients get a zone — auto-filled from the PIN' },
      t('location_url', 'Location URL', { max: 500 }),
      num('latitude', 'Latitude'),
      num('longitude', 'Longitude'),
      { key: 'full_address', label: 'Full address', type: 'textarea', rows: 2 },
    ],
  },
  {
    id: 'contacts',
    title: 'Tax & contacts',
    fields: [
      t('gstin', 'GSTIN', { max: 15, upper: true }),
      t('pan_no', 'PAN no.', { max: 10, upper: true }),
      t('owner_name', 'Owner name', { max: 160 }),
      t('owner_contact_no', 'Owner contact no.', { max: 20 }),
      t('owner_whatsapp_no', 'Owner WhatsApp no.', { max: 20 }),
      t('whatsapp_group_name', 'WhatsApp group name', { max: 200 }),
      t('whatsapp_group_id', 'WhatsApp group ID', { max: 100 }),
      t('accounts_person_name', 'Accounts person', { max: 160 }),
      t('accounts_person_whatsapp_no', 'Accounts WhatsApp no.', { max: 20 }),
      t('account_contact_name', 'Account contact name', { max: 160 }),
      t('customer_sales_person_name', 'Customer sales person', { max: 160 }),
      t('customer_sales_person_whatsapp_no', 'Sales person WhatsApp', { max: 20 }),
      t('customer_sales_person_contact', 'Sales person contact', { max: 20 }),
    ],
  },
  {
    id: 'business',
    title: 'Business profile',
    fields: [
      num('number_of_floors', 'No. of floors', { step: 1 }),
      num('team_size', 'Team size', { step: 1 }),
      sel('property_type', 'Property type'),
      num('shop_size_sq_ft', 'Shop size (sq ft)'),
      num('years_in_business', 'Years in business', { step: 1 }),
      num('number_of_stores_owned', 'Stores owned', { step: 1 }),
      sel('partnership_firm', 'Firm type'),
      num('yearly_turnover', 'Yearly turnover (₹)'),
      num('no_of_suppliers', 'No. of suppliers', { step: 1 }),
      t('purchase_from', 'Purchases from', { max: 200 }),
      t('blackout_quality', 'Blackout quality', { max: 160 }),
      num('monthly_purchase_quantity', 'Monthly purchase qty'),
      num('price_per_meter', 'Price per meter (₹)'),
      t('referred_by', 'Referred by', { max: 200 }),
      t('payment_report', 'Payment report', { max: 200 }),
      { key: 'purchase_decision_making_by', label: 'Purchase decision by', type: 'multi', options: OPTIONS.purchase_decision_making_by },
      { key: 'business_type', label: 'Business type', type: 'multi', options: OPTIONS.business_type },
      { key: 'customer_type', label: 'Customer type', type: 'multi', options: OPTIONS.customer_type },
      { key: 'peers_local_market_feedback', label: 'Peers / local market feedback', type: 'textarea' },
      { key: 'salesman_personal_observation', label: 'Salesman observation', type: 'textarea' },
    ],
  },
  {
    id: 'credit',
    title: 'Credit & approval',
    fields: [
      num('credit_days', 'Credit days', { step: 1 }),
      num('credit_limit', 'Credit limit (₹)'),
      sel('client_confirmation', 'Confirmation status'),
      { key: 'confirmation_timestamp', label: 'Confirmed on', type: 'date' },
      { key: 'approval_message_sent', label: 'Approval message sent', type: 'switch' },
      { key: 'skip_payment_check', label: 'Skip Payment Customer', type: 'switch', on: 'Yes — never hold orders for payment', off: 'No', hint: 'Orders are never put on hold for overdue / payment reasons' },
      t('skip_payment_reason', 'Skip payment reason', { max: 255, full: true, placeholder: 'Why this customer skips payment checks' }),
    ],
  },
  {
    id: 'photos',
    title: 'Visiting card & showroom photos',
    fields: [
      { key: 'vcard_front_url', label: 'Visiting card — front', type: 'image', full: false },
      { key: 'vcard_back_url', label: 'Visiting card — back', type: 'image', full: false },
      { key: 'showroom_front_url', label: 'Showroom — front', type: 'image', full: false },
      { key: 'showroom_back_url', label: 'Showroom — back', type: 'image', full: false },
    ],
  },
];

export const CHILD_SECTIONS = [
  { id: 'transport', title: 'Transport priority' },
  { id: 'referrals', title: 'Referrals' },
  { id: 'products', title: 'Top selling products' },
];

const ALL_KEYS = CLIENT_SECTIONS.flatMap((s) => s.fields.map((f) => f.key));

export const EMPTY_CLIENT = {
  ...Object.fromEntries(ALL_KEYS.map((k) => [k, null])),
  country: 'India',
  client_type: 'GENERAL',
  payment_mode: 'CREDIT',
  client_confirmation: 'DRAFT',
  is_active: true,
  approval_message_sent: false,
  skip_payment_check: false,
  purchase_decision_making_by: [],
  business_type: [],
  customer_type: [],
  transport_priorities: [],
  referrals: [],
  top_selling_products: [],
};

/** Form state -> API body */
export const clientPayload = (v) => {
  const body = Object.fromEntries(ALL_KEYS.map((k) => [k, v[k] === '' ? null : v[k]]));
  body.transport_priorities = (v.transport_priorities || []).map((p) => ({
    type_of_order: p.type_of_order || null,
    priority: p.priority || null,
    transporter_type: p.transporter_type || null,
    transport_ref: p.transport_ref || null,
  }));
  body.referrals = (v.referrals || []).map(({ name, phone_number, city, comment, photo_reference }) => ({ name, phone_number, city, comment, photo_reference }));
  body.top_selling_products = (v.top_selling_products || []).map(({ product_ref_id, product_name, volume_of_purchase, price_per_unit, photo_reference }) => ({
    product_ref_id, product_name, volume_of_purchase, price_per_unit, photo_reference,
  }));
  return body;
};
