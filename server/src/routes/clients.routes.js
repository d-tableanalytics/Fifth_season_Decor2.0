import { Router } from 'express';
import { requireAuth, requirePermission, requireAnyPermission } from '../middleware/auth.js';
import {
  listClients, clientSummary, clientFilters, zoneSuggest, getClient, createClient,
  updateClient, deleteClient, runClientSync, clientSyncLogs,
} from '../controllers/clients.controller.js';

const router = Router();
router.use(requireAuth);

router.get('/', requirePermission('client_master', 'view'), listClients);
router.get('/summary', requirePermission('client_master', 'view'), clientSummary);
router.get('/filters', requirePermission('client_master', 'view'), clientFilters);
router.get('/zone-suggest', requireAnyPermission('client_master', ['create', 'edit']), zoneSuggest);
router.get('/sync/logs', requirePermission('client_master', 'view'), clientSyncLogs);
router.post('/sync', requirePermission('client_master', 'edit'), runClientSync);
router.get('/:id', requirePermission('client_master', 'view'), getClient);
router.post('/', requirePermission('client_master', 'create'), createClient);
router.put('/:id', requirePermission('client_master', 'edit'), updateClient);
router.delete('/:id', requirePermission('client_master', 'delete'), deleteClient);

export default router;
