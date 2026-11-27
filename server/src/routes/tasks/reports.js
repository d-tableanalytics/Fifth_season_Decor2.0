import { Router } from 'express';
import { badRequest } from '../../utils/httpError.js';
import { buildReport, itemsFor, dashboardPdf, peoplePdf } from '../../services/tasks/report.js';
import { buildScore, scorePdf } from '../../services/tasks/score.js';
import { getPc, myDashboard } from '../../services/tasks/pc.js';
import { sendPdf } from '../../services/pdfReport.js';

const router = Router();

// Personal counters (task_dashboard view)
router.get('/dashboard', async (req, res) => res.json(await myDashboard(req.user)));

// Task Dashboard
router.get('/report', async (req, res) => {
  const { rows, age, ...out } = await buildReport(req.user, req.query);
  res.json(out);
});
router.get('/report/pdf', async (req, res) => {
  const { buf, filename } = await dashboardPdf(req.user, req.query);
  sendPdf(res, buf, filename);
});
router.get('/report/pdf/people', async (req, res) => {
  const { buf, filename } = await peoplePdf(req.user, req.query);
  sendPdf(res, buf, filename);
});
router.get('/report/items', async (req, res) => {
  const { rows, age } = await buildReport(req.user, req.query);
  const out = itemsFor(String(req.query.metric || ''), rows, age);
  if (!out) throw badRequest('Unknown number');
  res.json(out);
});

// Performance score
router.get('/score', async (req, res) => res.json(await buildScore(req.user, req.query)));
router.get('/score/pdf', async (req, res) => {
  const { buf, filename } = await scorePdf(req.user, req.query);
  sendPdf(res, buf, filename);
});

// PC Dashboard (pc_main view enforced by the guard on /pc*)
router.get('/pc', async (req, res) => res.json(await getPc(req.query)));

export default router;
