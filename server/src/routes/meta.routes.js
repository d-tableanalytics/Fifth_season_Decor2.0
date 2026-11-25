import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { ACTIONS, MODULES } from '../config/modules.js';
import { s3Enabled } from '../config/s3.js';

const router = Router();

// Permission registry for the role editor
router.get('/modules', requireAuth, (req, res) => res.json({ actions: ACTIONS, modules: MODULES }));

// Optional server features the UI adapts to
router.get('/features', requireAuth, (req, res) => res.json({ s3Uploads: s3Enabled() }));

export default router;
