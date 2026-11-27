import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { perms } from '../services/tasks/common.js';
import metaRoutes from './tasks/meta.js';
import delegationRoutes from './tasks/delegations.js';
import checklistRoutes from './tasks/checklists.js';
import fileRoutes from './tasks/files.js';
import reassignRoutes from './tasks/reassign.js';
import reportRoutes from './tasks/reports.js';

const router = Router();
router.use(requireAuth);

// Section 4.1 — GET = view, DELETE = delete, everything else = edit (with the exceptions below)
router.use((req, res, next) => {
  const p = perms(req.user);
  let ok;
  let verb = 'make changes here';
  if (req.method === 'GET') {
    verb = 'view this';
    if (/^\/dashboard/.test(req.path)) ok = p.dashboardView;
    else if (/^\/pc/.test(req.path)) ok = p.pcView;
    else ok = p.tasksView || p.pcView;
  } else if (req.method === 'DELETE') {
    verb = 'delete here';
    ok = p.tasksDelete;
  } else if (req.path === '/reassign') ok = p.tasksEdit || p.pcEdit;
  else if (/^\/occurrences\/\d+\/revert-non-functional$/.test(req.path)) ok = p.revert;
  else ok = p.tasksEdit;
  if (!ok) return res.status(403).json({ message: `You do not have permission to ${verb}. Ask the admin to update your role.` });
  next();
});

router.use(metaRoutes);
router.use(delegationRoutes);
router.use(checklistRoutes);
router.use(fileRoutes);
router.use(reassignRoutes);
router.use(reportRoutes);

export default router;
