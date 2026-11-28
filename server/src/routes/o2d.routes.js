import { Router } from 'express';
import { requireAuth, requirePermission, requireAnyPermission } from '../middleware/auth.js';
import {
  listOrders, getOrder, createOrder, updateOrder, cancelOrder, reactivateOrder, holdOrder, resumeOrder, convertToRoll,
  deleteOrder, listDoers, lookupClients, lookupClientTransports, lookupTransports, lookupSkus,
} from '../controllers/o2d.controller.js';
import { can } from '../services/access.js';
import { forbidden } from '../utils/httpError.js';
import pickingRoutes from './picking.routes.js';
import cuttingRoutes from './cutting.routes.js';
import deliveryNoteRoutes from './deliveryNote.routes.js';
import packingRoutes from './packing.routes.js';
import { z } from 'zod';
import { listRemarks, addRemark } from '../services/orderRemarks.js';
import { orderActivity } from '../services/activity.js';

const router = Router();
router.use(requireAuth);

// Lookups used by the order form — anyone who can create / edit Cut or Roll orders
const canWriteAny = (req, res, next) => {
  if (!['o2d_cut', 'o2d_roll'].some((m) => can(req.user, m, 'create') || can(req.user, m, 'edit'))) throw forbidden();
  next();
};
router.get('/lookups/clients', canWriteAny, lookupClients);
router.get('/lookups/clients/:id/transports', canWriteAny, lookupClientTransports);
router.get('/lookups/transports', canWriteAny, lookupTransports);
router.get('/lookups/skus', canWriteAny, lookupSkus);

/* Remarks trail of an order — shown on every stage's view (O2D, CRM and Picking screens) */
const REMARK_MODULES = ['o2d_cut', 'o2d_roll', 'crm_payment_check', 'crm_stock_check', 'crm_manager_approval', 'picking', 'planning_dispatch', 'dispatch_pending'];
const anyModule = (actions) => (req, res, next) => {
  if (!REMARK_MODULES.some((m) => actions.some((a) => can(req.user, m, a)))) throw forbidden();
  next();
};
router.get('/orders/:id/remarks', anyModule(['view']), async (req, res) => res.json({ data: await listRemarks(req.params.id) }));
// Full who-did-what trail of an order (every step, item-wise)
router.get('/orders/:id/activity', anyModule(['view']), async (req, res) => res.json({ data: await orderActivity(req.params.id) }));
router.post('/orders/:id/remarks', anyModule(['edit', 'approve']), async (req, res) => {
  const { remark } = z.object({ remark: z.string({ message: 'Write a remark' }).trim().min(1, 'Write a remark').max(1000, 'At most 1000 characters') }).parse(req.body);
  await addRemark(req.params.id, remark, req.user.id);
  res.status(201).json({ data: await listRemarks(req.params.id), message: 'Remark added' });
});

/** Cut and Roll orders share every stage; only the order type and its permission module differ. */
function orderRouter(type, perm) {
  const r = Router();
  r.use((req, res, next) => ((req.orderType = type), next()));
  r.get('/orders', requirePermission(perm, 'view'), listOrders);
  r.get('/doers', requireAnyPermission(perm, ['create', 'edit']), listDoers);
  r.get('/orders/:id', requirePermission(perm, 'view'), getOrder);
  r.post('/orders', requirePermission(perm, 'create'), createOrder);
  r.put('/orders/:id', requirePermission(perm, 'edit'), updateOrder);
  r.post('/orders/:id/cancel', requirePermission(perm, 'edit'), cancelOrder);
  r.post('/orders/:id/reactivate', requirePermission(perm, 'edit'), reactivateOrder);
  r.post('/orders/:id/hold', requirePermission(perm, 'edit'), holdOrder);
  r.post('/orders/:id/resume', requirePermission(perm, 'edit'), resumeOrder);
  if (type === 'CUT') r.post('/orders/:id/convert-to-roll', requirePermission(perm, 'edit'), convertToRoll);
  r.delete('/orders/:id', requirePermission(perm, 'delete'), deleteOrder);
  r.use(pickingRoutes);
  r.use(cuttingRoutes);
  r.use(deliveryNoteRoutes);
  r.use(packingRoutes);
  return r;
}

router.use('/cut', orderRouter('CUT', 'o2d_cut'));
router.use('/roll', orderRouter('ROLL', 'o2d_roll'));

export default router;
