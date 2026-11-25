import { Router } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { listRoles, getRole, createRole, updateRole, deleteRole } from '../controllers/roles.controller.js';

const router = Router();
router.use(requireAuth);

router.get('/', requirePermission('roles', 'view'), listRoles);
router.get('/:id', requirePermission('roles', 'view'), getRole);
router.post('/', requirePermission('roles', 'create'), createRole);
router.put('/:id', requirePermission('roles', 'edit'), updateRole);
router.delete('/:id', requirePermission('roles', 'delete'), deleteRole);

export default router;
