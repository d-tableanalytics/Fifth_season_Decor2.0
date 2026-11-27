import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import authRoutes from './routes/auth.routes.js';
import employeeRoutes from './routes/employees.routes.js';
import roleRoutes from './routes/roles.routes.js';
import metaRoutes from './routes/meta.routes.js';
import inventoryRoutes from './routes/inventory.routes.js';
import uploadRoutes from './routes/uploads.routes.js';
import clientRoutes from './routes/clients.routes.js';
import transportRoutes from './routes/transports.routes.js';
import o2dRoutes from './routes/o2d.routes.js';
import zoneRoutes from './routes/zones.routes.js';
import billRoutes from './routes/bills.routes.js';
import whatsappRoutes from './routes/whatsapp.routes.js';
import crmRoutes from './routes/crm.routes.js';
import publicRoutes from './routes/public.routes.js';
import labelRoutes from './routes/labels.routes.js';
import dispatchPlanningRoutes from './routes/dispatchPlanning.routes.js';
import dispatchHandoverRoutes from './routes/dispatchHandover.routes.js';
import holidayRoutes from './routes/holidays.routes.js';
import notificationRoutes from './routes/notifications.routes.js';
import taskRoutes from './routes/tasks.routes.js';
import { startTaskJob } from './jobs/taskJob.js';
import { pool } from './config/db.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';

if (!process.env.JWT_SECRET) {
  console.error('✖ JWT_SECRET is missing. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '5mb' })); // label templates may embed small logo images
app.use(morgan('dev'));

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch {
    res.status(503).json({ status: 'degraded', db: 'unreachable' });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/meta', metaRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/transports', transportRoutes);
app.use('/api/o2d', o2dRoutes);
app.use('/api/zones', zoneRoutes);
app.use('/api/bills-receivable', billRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/crm', crmRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/labels', labelRoutes);
app.use('/api/dispatch-planning', dispatchPlanningRoutes);
app.use('/api/dispatch-handover', dispatchHandoverRoutes);
app.use('/api/holidays', holidayRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/tasks', taskRoutes);

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✔ API running on http://localhost:${PORT}`);
  startTaskJob();
});
