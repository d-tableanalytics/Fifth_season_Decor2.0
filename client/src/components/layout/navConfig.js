import {
  LayoutDashboard,
  Boxes,
  ClipboardList,
  CalendarRange,
  UserPlus,
  HeartHandshake,
  Route,
  Truck,
  ListChecks,
  Settings2,
  Wallet,
  ShieldCheck,
} from 'lucide-react';

/**
 * Single source of truth for the sidebar and routes.
 * - `perm` is the permission module key (must match server/src/config/modules.js).
 *   A page is shown only if the user has `view` on it.
 * - An item has either `to` (a page) or `children` (an expandable group).
 * - `element` (optional) names a real page in App.jsx; otherwise a "Coming soon" page is shown.
 */
export const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, perm: 'dashboard' },
  { to: '/inventory', label: 'Inventory', icon: Boxes, perm: 'inventory', element: 'inventory' },
  {
    key: 'o2d',
    label: 'O2D',
    icon: ClipboardList,
    children: [
      { to: '/o2d/roll', label: 'Roll', perm: 'o2d_roll', element: 'roll_orders' },
      { to: '/o2d/cut', label: 'Cut', perm: 'o2d_cut', element: 'cut_orders' },
    ],
  },
  { to: '/planning-to-dispatch', label: 'Planning to Dispatch', icon: CalendarRange, perm: 'planning_dispatch', element: 'planning_dispatch' },
  { to: '/client-master', label: 'Client Master', icon: UserPlus, perm: 'client_master', element: 'clients' },
  {
    key: 'crm',
    label: 'CRM',
    icon: HeartHandshake,
    children: [
      // Each page has a Payment Check + Stock Check tab; shown if the user can view either
      { to: '/crm/roll', label: 'Roll', perm: ['crm_payment_check', 'crm_stock_check'], element: 'crm_roll' },
      { to: '/crm/cut', label: 'Cut', perm: ['crm_payment_check', 'crm_stock_check'], element: 'crm_cut' },
    ],
  },
  { to: '/manager-approval', label: 'Manager Approval', icon: ShieldCheck, perm: 'crm_manager_approval', element: 'crm_approval' },
  { to: '/transport-master', label: 'Transport Master', icon: Route, perm: 'transport_master', element: 'transports' },
  {
    key: 'dispatch',
    label: 'Dispatch',
    icon: Truck,
    children: [
      { to: '/dispatch/handover', label: 'Handover', perm: 'dispatch_pending', element: 'dispatch_handover' },
      { to: '/dispatch/delivery', label: 'Delivery Planning & Entry', perm: 'dispatch_pending', element: 'delivery_planning' },
    ],
  },
  {
    key: 'tasks',
    label: 'Task Management',
    icon: ListChecks,
    children: [
      { to: '/tasks/dashboard', label: 'Dashboard', perm: 'task_dashboard', element: 'task_dashboard' },
      { to: '/tasks', label: 'Tasks', perm: 'tasks_mine', element: 'tasks' },
      { to: '/tasks/pc', label: 'PC Dashboard', perm: 'pc_main', element: 'task_pc' },
    ],
  },
  {
    key: 'payment',
    label: 'Payment',
    icon: Wallet,
    children: [{ to: '/payment/bills-receivable', label: 'Bills Receivable', perm: 'bills_receivable', element: 'bills' }],
  },
  {
    key: 'masters',
    label: 'Masters',
    icon: Settings2,
    children: [
      { to: '/masters/employees', label: 'Staff / Employee Master', perm: 'employees', element: 'employees' },
      { to: '/masters/roles', label: 'Roles & Permissions', perm: 'roles', element: 'roles' },
      { to: '/masters/holidays', label: 'Holidays', perm: 'holidays', element: 'holidays' },
      { to: '/masters/zones', label: 'Zone Mapping', perm: 'route_planning', element: 'zones' },
      { to: '/masters/whatsapp', label: 'WhatsApp Integration', perm: 'whatsapp', element: 'whatsapp' },
      { to: '/masters/labels', label: 'Label Design', perm: 'label_design', element: 'labels' },
    ],
  },
];

/** Flat list of every routable page, each with the icon of its group. */
export const ALL_NAV_ITEMS = NAV_ITEMS.flatMap((item) =>
  item.children ? item.children.map((c) => ({ ...c, icon: item.icon, group: item.label })) : [item]
);

/** Sidebar tree filtered by what the user can view (empty groups removed). */
export const visibleNav = (can) =>
  NAV_ITEMS.map((item) => {
    if (!item.children) return can(item.perm) ? item : null;
    const children = item.children.filter((c) => can(c.perm));
    return children.length ? { ...item, children } : null;
  }).filter(Boolean);

/** First page the user is allowed to open — used as the landing page. */
export const firstAllowedPath = (can) => ALL_NAV_ITEMS.find((i) => can(i.perm))?.to || null;
