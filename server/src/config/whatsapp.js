/** Who a WhatsApp message can be sent to. Triggers (added later) pick one or more of these. */
export const RECIPIENTS = [
  { key: 'CLIENT_OWNER', label: 'Client owner', client: true },
  { key: 'CLIENT_ACCOUNTANT', label: 'Client accountant', client: true },
  { key: 'CLIENT_SALES_PERSON', label: 'Client sales person', client: true },
  { key: 'CLIENT_GROUP', label: 'Client WhatsApp group', client: true },
  { key: 'FSD_CRM_PERSON', label: 'Fifth Season CRM person', client: false },
  { key: 'FSD_MANAGER', label: 'Fifth Season manager', client: false },
  // The employee whose Employee ID is the client's "Sales person emp. ID"
  { key: 'FSD_SALES_PERSON', label: "Fifth Season sales person (client's)", client: true },
];
export const RECIPIENT_KEYS = RECIPIENTS.map((r) => r.key);

/** app_settings keys holding the employee (user id) for the internal recipients. */
export const SETTING_KEYS = { FSD_CRM_PERSON: 'whatsapp.crm_person_user_id', FSD_MANAGER: 'whatsapp.manager_user_id' };

/**
 * Event catalogue (code-owned). Admins write templates against these events; only the listed placeholders are filled by the trigger code.
 * `default` is the message sent when the event has no enabled template, so existing behaviour is unchanged.
 */
export const EVENTS = {
  PAYMENT_LEDGER: {
    starter: "*Fifth Seasons Decor — Payment Reminder*\nDear {{company_name}},\nYour order {{enquiry_number}} is waiting for payment clearance. Pending invoices:\n\n{{pending_invoices}}\n\n*Total pending: {{total_pending}}*\n\nPlease tell us when you will make the payment:\n{{link}}\n(Link valid for {{link_valid_days}} days)",
    label: 'Payment reminder (ledger)',
    placeholders: ['company_name', 'enquiry_number', 'pending_invoices', 'total_pending', 'link', 'link_valid_days'],
  },
  PROFORMA_SHARE: {
    starter: "*Fifth Seasons Decor — Proforma Invoice*\nDear {{company_name}},\nProforma Invoice {{proforma_no}} for your order {{enquiry_number}}: *{{amount}}*\nPlease make the advance payment so we can start processing your order.\n{{link}}",
    label: 'Proforma invoice shared',
    placeholders: ['company_name', 'proforma_no', 'enquiry_number', 'amount', 'link'],
  },
  ORDER_TRACKING: {
    starter: "*Fifth Seasons Decor — Order Confirmed*\nDear {{company_name}},\nYour order *{{order_no}}* is confirmed and moved to picking.\nTrack your order here:\n{{link}}",
    label: 'Order confirmed (tracking link)',
    placeholders: ['company_name', 'order_no', 'link'],
  },
  SKIP_PAYMENT_ORDER: {
    starter: "*New order — Skip Payment customer*\nEnquiry: {{enquiry_number}} ({{order_type}})\nClient: {{client_id}} — {{company_name}}\nItems: {{item_count}} line(s)\nPayment check skipped — order moved to Stock Check.",
    label: 'Skip Payment customer order',
    placeholders: ['enquiry_number', 'order_type', 'client_id', 'company_name', 'item_count'],
  },
  SEND_LR: {
    starter: "*Fifth Seasons Decor — Dispatch Update*\nDear {{company_name}},\nYour order *{{order_no}}* is with {{transport_name}}.\nLR No: *{{lr_number}}*\nTrack your order:\n{{tracking_link}}",
    label: 'Dispatch update (LR sent)',
    placeholders: ['company_name', 'order_no', 'transport_name', 'lr_number', 'tracking_link'],
  },
};
export const EVENT_KEYS = Object.keys(EVENTS);
