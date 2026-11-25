import { Router } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import {
  listEmployees,
  getEmployee,
  roleOptions,
  createEmployee,
  updateEmployee,
  setEmployeeStatus,
  deleteEmployee,
} from '../controllers/employees.controller.js';

const router = Router();
router.use(requireAuth);

router.get('/', requirePermission('employees', 'view'), listEmployees);
router.get('/role-options', requirePermission('employees', 'view'), roleOptions);
router.get('/:id', requirePermission('employees', 'view'), getEmployee);
router.post('/', requirePermission('employees', 'create'), createEmployee);
router.put('/:id', requirePermission('employees', 'edit'), updateEmployee);
router.patch('/:id/status', requirePermission('employees', 'edit'), setEmployeeStatus);
router.delete('/:id', requirePermission('employees', 'delete'), deleteEmployee);

export default router;
