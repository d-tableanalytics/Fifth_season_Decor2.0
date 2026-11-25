import { Router } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { can } from '../services/access.js';
import {
  listTransports, transportSummary, transportOptions, getTransport, createTransport,
  updateTransport, deleteTransport, runTransportSync, transportSyncLogs,
} from '../controllers/transports.controller.js';

const router = Router();
router.use(requireAuth);

// The transport picker is also needed by people editing clients
const canPickTransport = (req, res, next) =>
  can(req.user, 'transport_master', 'view') || can(req.user, 'client_master', 'create') || can(req.user, 'client_master', 'edit')
    ? next()
    : res.status(403).json({ message: 'You do not have permission to perform this action' });

router.get('/', requirePermission('transport_master', 'view'), listTransports);
router.get('/summary', requirePermission('transport_master', 'view'), transportSummary);
router.get('/options', canPickTransport, transportOptions);
router.get('/sync/logs', requirePermission('transport_master', 'view'), transportSyncLogs);
router.post('/sync', requirePermission('transport_master', 'edit'), runTransportSync);
router.get('/:id', requirePermission('transport_master', 'view'), getTransport);
router.post('/', requirePermission('transport_master', 'create'), createTransport);
router.put('/:id', requirePermission('transport_master', 'edit'), updateTransport);
router.delete('/:id', requirePermission('transport_master', 'delete'), deleteTransport);

export default router;
