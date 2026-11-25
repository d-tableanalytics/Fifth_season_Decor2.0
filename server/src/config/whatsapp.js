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
