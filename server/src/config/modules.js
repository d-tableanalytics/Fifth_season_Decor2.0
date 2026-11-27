/**
 * Permission registry — the single source of truth for every module that can be
 * granted to a role. The client reads this via GET /api/meta/modules, and the
 * sidebar/routes on the client use the same `key`s.
 *
 * To add a module: add an entry here, then use requirePermission('<key>', '<action>')
 * on its API routes and `perm: '<key>'` in the client's navConfig.
 */
export const ACTIONS = ['view', 'create', 'edit', 'delete', 'approve'];

const ALL = ['view', 'create', 'edit', 'delete'];
const ORDER = [...ALL, 'approve']; // approve = allow "Continue Anyway" on duplicate orders

export const MODULES = [
  { key: 'dashboard', label: 'Dashboard', group: 'Overview', actions: ['view'] },
  { key: 'inventory', label: 'Inventory', group: 'Inventory', actions: ALL },
  { key: 'o2d_roll', label: 'Roll Orders', group: 'O2D', actions: ORDER },
  { key: 'o2d_cut', label: 'Cut Orders', group: 'O2D', actions: ORDER },
  // view = Picking queue + rack locations; edit = pick, Not Found, save batches (+ o2d_cut edit to send to Cutting)
  { key: 'picking', label: 'Picking', group: 'O2D', actions: ['view', 'edit'] },
  { key: 'planning_dispatch', label: 'Planning to Dispatch', group: 'Operations', actions: ALL },
  { key: 'client_master', label: 'Client Master', group: 'Operations', actions: ALL },
  { key: 'transport_master', label: 'Transport Master', group: 'Operations', actions: ALL },
  { key: 'crm_payment_check', label: 'Payment Check', group: 'CRM', actions: ['view', 'edit'] }, // edit = send ledger / customer link, re-check bills
  { key: 'crm_stock_check', label: 'Stock Check', group: 'CRM', actions: ['view', 'edit'] }, // edit = item-wise check, hold, complete
  { key: 'crm_manager_approval', label: 'Manager Approval', group: 'Manager Approval', actions: ['view', 'approve'] }, // approve = approve/reject payment promises
  { key: 'crm_leads', label: 'Leads', group: 'CRM', actions: ALL },
  { key: 'crm_followups', label: 'Follow-ups', group: 'CRM', actions: ALL },
  // Dispatch Handover log: view = entries, pending, lists; edit = save handovers, edit entries, manage handover-by / driver lists
  { key: 'dispatch_pending', label: 'Dispatch Handover', group: 'Dispatch', actions: ['view', 'edit'] },
  { key: 'dispatch_completed', label: 'Dispatched', group: 'Dispatch', actions: ['view', 'edit'] },
  // Task Management. tasks_mine = Tasks page (my tasks + tasks I assigned): edit covers add/edit/work, delete removes tasks I assigned
  { key: 'task_dashboard', label: 'Task Dashboard', group: 'Task Management', actions: ['view'] },
  { key: 'tasks_mine', label: 'Tasks (my tasks, tasks I assigned)', group: 'Task Management', actions: ['view', 'edit', 'delete'] },
  // tasks_all: view = "All data" (everybody's tasks + dashboard); edit = edit other people's tasks (reassign, verify)
  { key: 'tasks_all', label: 'All Tasks (view = all data, edit = edit others’ tasks)', group: 'Task Management', actions: ['view', 'edit'] },
  { key: 'tasks_revert', label: 'Undo non-functional turn', group: 'Task Management', actions: ['edit'] },
  { key: 'pc_main', label: 'PC Dashboard (edit = reassign)', group: 'Task Management', actions: ['view', 'edit'] },
  { key: 'holidays', label: 'Holidays & Weekly Off', group: 'Masters', actions: ALL },
  { key: 'employees', label: 'Staff / Employee Master', group: 'Masters', actions: ALL },
  { key: 'roles', label: 'Roles & Permissions', group: 'Masters', actions: ALL },
  { key: 'bills_receivable', label: 'Bills Receivable', group: 'Payment', actions: ['view', 'edit'] }, // edit = sync from sheet
  { key: 'label_design', label: 'Label Design', group: 'Masters', actions: ALL }, // view also allows printing labels
  { key: 'whatsapp', label: 'WhatsApp Integration', group: 'Masters', actions: ['view', 'edit'] }, // edit = fetch/link groups, settings, test send
  // Zone Mapping: view = ROUTEPLANNING_VIEW, edit = ROUTEPLANNING_MANAGE (add/edit/delete/backfill)
  { key: 'route_planning', label: 'Zone Mapping (Route Planning)', group: 'Masters', actions: ['view', 'edit'] },
];

export const MODULE_MAP = new Map(MODULES.map((m) => [m.key, m]));

/** Every action on every module — what a super-admin effectively has. */
export const fullPermissions = () => Object.fromEntries(MODULES.map((m) => [m.key, [...m.actions]]));

/**
 * Normalise client input { moduleKey: ['view', 'edit', ...] }:
 * drops unknown modules/actions, and any create/edit/delete implies view.
 */
export function sanitizePermissions(input = {}) {
  const out = {};
  for (const [key, actions] of Object.entries(input)) {
    const mod = MODULE_MAP.get(key);
    if (!mod || !Array.isArray(actions)) continue;
    const set = new Set(actions.filter((a) => mod.actions.includes(a)));
    if (set.size && !set.has('view')) set.add('view');
    if (set.size) out[key] = ACTIONS.filter((a) => set.has(a));
  }
  return out;
}
