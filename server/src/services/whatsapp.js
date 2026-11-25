import { query } from '../config/db.js';
import { RECIPIENTS, SETTING_KEYS } from '../config/whatsapp.js';
import { HttpError } from '../utils/httpError.js';

const BASE = 'https://api.maytapi.com/api';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const config = () => {
  const { MAYTAPI_PRODUCT_ID: product, MAYTAPI_TOKEN: token, MAYTAPI_PHONE_ID: phone } = process.env;
  if (!product || !token || !phone) throw new HttpError(503, 'Maytapi is not configured. Add MAYTAPI_PRODUCT_ID, MAYTAPI_TOKEN and MAYTAPI_PHONE_ID to the server .env.');
  return { product, token, phone };
};

/** Call Maytapi with a timeout; retries network resets (Maytapi drops bursts of requests). */
async function maytapi(path, { method = 'GET', body, attempts = 3 } = {}) {
  const { product, token, phone } = config();
  const url = `${BASE}/${product}/${phone}/${path}`;
  let lastErr;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers: { 'x-maytapi-key': token, ...(body && { 'Content-Type': 'application/json' }) },
        body: body && JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      const json = await res.json().catch(() => ({}));
      // Maytapi answers 5xx "Connection to Api is failed." when its phone link is busy — temporary, retry
      if (res.status >= 500) {
        lastErr = new Error(json.message || `HTTP ${res.status}`);
        await wait(4000 * (attempt + 1));
        continue;
      }
      if (!res.ok || json.success === false) throw new HttpError(502, `Maytapi: ${json.message || `HTTP ${res.status}`}`);
      return json;
    } catch (err) {
      if (err instanceof HttpError) throw err;
      lastErr = err;
      await wait(2000 * (attempt + 1));
    }
  }
  throw new HttpError(502, `Maytapi is not responding (${lastErr?.cause?.code || lastErr?.message || 'network error'}). Please try again in a minute.`);
}

export async function connectionStatus() {
  const j = await maytapi('status');
  const s = j.status || {};
  const number = String(j.number || s.number || '');
  return {
    connected: s.state?.state === 'CONNECTED',
    canSend: !!s.state?.canSend,
    state: s.state?.state || null,
    number: number ? `${number.slice(0, 4)}••••${number.slice(-3)}` : null,
  };
}

export const GROUP_PAGE_SIZE = 500;

/** One page of the connected phone's groups (Maytapi pages them 500 at a time). Slow for big accounts — retried generously. */
export async function fetchGroupsPage(page) {
  const j = await maytapi(`getGroups?page=${page}`, { attempts: 5 });
  return (Array.isArray(j.data) ? j.data : []).map((g) => ({
    group_id: g.id,
    name: g.name || null,
    participants: Array.isArray(g.participants) ? g.participants.length : Number(g.participants) || null,
    admins: Array.isArray(g.admins) ? g.admins.length : Number(g.admins) || null,
  }));
}

export const sendText = (to, message) => maytapi('sendMessage', { method: 'POST', body: { to_number: to, type: 'text', message } });

/** 10-digit Indian mobile -> 91XXXXXXXXXX; group ids pass through. */
export function normaliseNumber(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (s.endsWith('@g.us')) return s;
  const d = s.replace(/\D/g, '');
  if (d.length === 10) return `91${d}`;
  if (d.length === 12 && d.startsWith('91')) return d;
  if (d.length === 11 && d.startsWith('0')) return `91${d.slice(1)}`;
  return d.length >= 10 ? d : null;
}

export async function getSetting(key) {
  const { rows } = await query('SELECT value FROM app_settings WHERE key = $1', [key]);
  return rows[0]?.value ?? null;
}

/**
 * Resolve recipient types to WhatsApp numbers / group ids.
 * Returns [{ type, label, to | null, reason }] — `to` is null when the number is missing.
 */
export async function resolveRecipients(types, clientId) {
  let client = null;
  if (types.some((t) => RECIPIENTS.find((r) => r.key === t)?.client)) {
    const { rows } = await query(
      `SELECT company_name, owner_whatsapp_no, owner_contact_no, accounts_person_whatsapp_no,
              customer_sales_person_whatsapp_no, customer_sales_person_contact, whatsapp_group_id, sales_person_emp_id
         FROM clients WHERE id = $1`,
      [clientId]
    );
    client = rows[0] || null;
  }
  const out = [];
  for (const type of types) {
    const def = RECIPIENTS.find((r) => r.key === type);
    let raw = null;
    if (def.client && !client) {
      out.push({ type, label: def.label, to: null, reason: 'Client not selected or not found' });
      continue;
    }
    if (type === 'CLIENT_OWNER') raw = client.owner_whatsapp_no || client.owner_contact_no;
    if (type === 'CLIENT_ACCOUNTANT') raw = client.accounts_person_whatsapp_no;
    if (type === 'CLIENT_SALES_PERSON') raw = client.customer_sales_person_whatsapp_no || client.customer_sales_person_contact;
    if (type === 'CLIENT_GROUP') raw = client.whatsapp_group_id;
    if (type === 'FSD_SALES_PERSON' && client.sales_person_emp_id) {
      const { rows } = await query('SELECT phone FROM users WHERE upper(employee_code) = upper(btrim($1)) AND is_active', [client.sales_person_emp_id]);
      raw = rows[0]?.phone;
    }
    if (!def.client) {
      const userId = await getSetting(SETTING_KEYS[type]);
      if (userId) {
        const { rows } = await query('SELECT phone FROM users WHERE id = $1 AND is_active', [userId]);
        raw = rows[0]?.phone;
      }
    }
    const to = normaliseNumber(raw);
    const missing =
      type === 'FSD_SALES_PERSON'
        ? "No employee with the client's Sales person emp. ID (or the employee has no phone)"
        : def.client
          ? 'No number saved on the client'
          : 'Not set in WhatsApp settings (or employee has no phone)';
    out.push({ type, label: def.label, to, reason: to ? null : missing });
  }
  return out;
}

/** Send and log one message. Never throws for a delivery failure; returns the log row. */
export async function sendAndLog({ triggerKey, recipient, clientId, message, userId }) {
  let status = 'SENT';
  let error = null;
  try {
    await sendText(recipient.to, message);
  } catch (err) {
    status = 'FAILED';
    error = err.message;
  }
  const { rows } = await query(
    `INSERT INTO whatsapp_messages (trigger_key, recipient_type, to_number, client_ref, message, status, error, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, status, error, created_at`,
    [triggerKey, recipient.type, recipient.to, clientId || null, message, status, error, userId]
  );
  return rows[0];
}
