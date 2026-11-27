import { Router } from 'express';
import { requireAuth, requirePermission, requireAnyPermission } from '../middleware/auth.js';
import {
  listClients, clientSummary, clientFilters, zoneSuggest, getClient, createClient,
  updateClient, deleteClient, runClientSync, clientSyncLogs,
} from '../controllers/clients.controller.js';
import { can } from '../services/access.js';
import { forbidden } from '../utils/httpError.js';
import { customerProfile } from '../services/customerProfile.js';

const router = Router();
router.use(requireAuth);

router.get('/', requirePermission('client_master', 'view'), listClients);
router.get('/summary', requirePermission('client_master', 'view'), clientSummary);
router.get('/filters', requirePermission('client_master', 'view'), clientFilters);
router.get('/zone-suggest', requireAnyPermission('client_master', ['create', 'edit']), zoneSuggest);
router.get('/sync/logs', requirePermission('client_master', 'view'), clientSyncLogs);
router.post('/sync', requirePermission('client_master', 'edit'), runClientSync);
// Customer Profile: also opened from CRM (Payment Check / Stock Check) and O2D screens
const PROFILE_MODULES = ['client_master', 'crm_payment_check', 'crm_stock_check', 'crm_manager_approval', 'o2d_cut', 'o2d_roll'];
router.get('/:id/profile', (req, res, next) => (PROFILE_MODULES.some((m) => can(req.user, m, 'view')) ? next() : next(forbidden())), async (req, res) =>
  res.json({ data: await customerProfile(req.params.id) })
);
router.get('/:id', requirePermission('client_master', 'view'), getClient);
router.post('/', requirePermission('client_master', 'create'), createClient);
router.put('/:id', requirePermission('client_master', 'edit'), updateClient);
router.delete('/:id', requirePermission('client_master', 'delete'), deleteClient);

export default router;
