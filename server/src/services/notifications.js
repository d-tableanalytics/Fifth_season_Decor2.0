import { query } from '../config/db.js';

/**
 * Create notifications. Best-effort: a failure never breaks the action (spec 12.1).
 * `to` = user id or list of ids (duplicates and falsy ids dropped); `exceptId` = the actor, who is never notified.
 * n = { kind: 'assigned' | 'status', title, body?, link?, actor? }
 */
export async function notify(to, n, exceptId = null, db = { query }) {
  try {
    const ids = [...new Set([].concat(to).map(Number).filter((x) => Number.isInteger(x) && x > 0 && x !== Number(exceptId)))];
    if (!ids.length) return;
    await db.query(
      `INSERT INTO notifications (user_id, kind, title, body, link, actor_name)
       SELECT u, $2, $3, $4, $5, $6 FROM unnest($1::int[]) AS u`,
      [ids, n.kind || 'status', n.title, n.body || null, n.link || null, n.actor || null]
    );
  } catch (err) {
    console.warn('notify failed:', err.message);
  }
}
