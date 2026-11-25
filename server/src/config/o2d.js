/** O2D (Order to Dispatch) constants shared by Cut and Roll orders. */

export const ORDER_MODES = ['MANUAL', 'ONLINE', 'THIRD_PARTY'];
export const UNITS = ['Mtr', 'Pcs', 'Kg', 'Roll', 'Set', 'Yard'];

/** Workflow stages in order. SUBMITTED = Order Enquiry (first stage after create). */
export const STAGES = [
  'DRAFT', 'SUBMITTED', 'PAYMENT_CHECK', 'STOCK_CHECK', 'PICKING', 'ROLL_DEPT_REQUIRED', 'IOC_PENDING', 'MATERIAL_RELEASED',
  'CUTTING', 'CUTTING_COMPLETED', 'DELIVERY_NOTE', 'PACKING', 'PACKING_COMPLETED', 'PLANNING_TO_DISPATCH',
  'DELIVERY_NOTE_GENERATED', 'DISPATCHED',
];
export const FIRST_STAGE = 'SUBMITTED';

/** Picking and everything after it — conversion to Roll is no longer allowed from here. */
export const PICKING_OR_LATER = new Set(STAGES.slice(STAGES.indexOf('PICKING')));

/** Real order number prefix by mode, applied when an order first reaches Picking. */
export const ORDER_NO_PREFIX = { MANUAL: 'B_', ONLINE: 'OC-A-', THIRD_PARTY: 'TP-B-' };

/** Order type -> permission module. */
export const ORDER_PERM = { CUT: 'o2d_cut', ROLL: 'o2d_roll' };
