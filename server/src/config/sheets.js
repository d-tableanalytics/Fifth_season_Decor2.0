/**
 * Google Sheet integration settings.
 * The sheet must be shared as "Anyone with the link can view" — it is read through the
 * public gviz CSV export, so no Google credentials are needed.
 */
export const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID || '1R_bq2G-bYiDYqgbzUk4ae1K-IzgkX_kngilRSpgzZko';

/** Inventory stock type -> sheet tab name (exactly as spelled in the sheet). */
export const INVENTORY_TABS = {
  CUT: process.env.SHEET_TAB_CUT || 'Cut stock data',
  ROLL: process.env.SHEET_TAB_ROLL || 'roll stock data',
  IN_CHECKING: process.env.SHEET_TAB_IN_CHECKING || 'IN CHCECKING',
};

export const STOCK_TYPES = Object.keys(INVENTORY_TABS);

/** Master data tabs */
export const MASTER_TABS = {
  clients: process.env.SHEET_TAB_CLIENTS || 'Client_master',
  priorities: process.env.SHEET_TAB_TRANSPORT_PRIORITY || 'Transport Priority',
  transports: process.env.SHEET_TAB_TRANSPORTS || 'Transport Master',
  altColor: process.env.SHEET_TAB_ALT_COLOR || 'Alternative_color',
  bills: process.env.SHEET_TAB_BILLS || 'Bills Receivable',
};
