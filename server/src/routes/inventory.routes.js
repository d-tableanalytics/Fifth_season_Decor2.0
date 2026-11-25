import { Router } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import {
  listInventory,
  inventorySummary,
  listCatalogues,
  getItem,
  createItem,
  updateItem,
  deleteItem,
  runSync,
  syncLogs,
} from '../controllers/inventory.controller.js';

const router = Router();
router.use(requireAuth);

router.get('/', requirePermission('inventory', 'view'), listInventory);
router.get('/summary', requirePermission('inventory', 'view'), inventorySummary);
router.get('/catalogues', requirePermission('inventory', 'view'), listCatalogues);
router.get('/sync/logs', requirePermission('inventory', 'view'), syncLogs);
router.post('/sync', requirePermission('inventory', 'edit'), runSync);
router.get('/:id', requirePermission('inventory', 'view'), getItem);
router.post('/', requirePermission('inventory', 'create'), createItem);
router.put('/:id', requirePermission('inventory', 'edit'), updateItem);
router.delete('/:id', requirePermission('inventory', 'delete'), deleteItem);

export default router;
