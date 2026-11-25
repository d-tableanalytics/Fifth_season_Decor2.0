import { parseCsv } from '../utils/csv.js';
import { HttpError } from '../utils/httpError.js';

/**
 * Read one tab of a public Google Sheet via the gviz CSV export.
 * Returns { headers: string[], rows: string[][] }.
 */
export async function fetchSheetTab(sheetId, tabName) {
  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`;

  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(90_000) });
  } catch (err) {
    throw new HttpError(502, `Could not reach Google Sheets (${err.cause?.code || err.name}). Check the server's internet connection.`);
  }

  const type = res.headers.get('content-type') || '';
  if (!res.ok || !type.includes('csv')) {
    throw new HttpError(
      502,
      `Could not read the "${tabName}" tab. Make sure the sheet is shared as "Anyone with the link can view" and the tab name is correct.`
    );
  }

  const [headers = [], ...rows] = parseCsv(await res.text());
  return { headers: headers.map((h) => h.trim()), rows };
}
