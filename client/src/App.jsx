import { lazy, Suspense } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { ProtectedRoute, PublicOnlyRoute, RequirePermission, HomeRedirect } from './routes/guards';
import { DashboardLayout } from './components/layout/DashboardLayout';
import { ALL_NAV_ITEMS } from './components/layout/navConfig';
import { Loader } from './components/ui/Loader';

const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const ComingSoon = lazy(() => import('./pages/ComingSoon'));
const NotFound = lazy(() => import('./pages/NotFound'));
const Employees = lazy(() => import('./pages/masters/Employees'));
const Roles = lazy(() => import('./pages/masters/Roles'));
const RoleEditor = lazy(() => import('./pages/masters/RoleEditor'));
const Inventory = lazy(() => import('./pages/inventory/Inventory'));
const Clients = lazy(() => import('./pages/clients/Clients'));
const ClientForm = lazy(() => import('./pages/clients/ClientForm'));
const Transports = lazy(() => import('./pages/transports/Transports'));
const TransportForm = lazy(() => import('./pages/transports/TransportForm'));
const CutOrders = lazy(() => import('./pages/o2d/CutOrders'));
const RollOrders = lazy(() => import('./pages/o2d/RollOrders'));
const ZoneMapping = lazy(() => import('./pages/masters/ZoneMapping'));
const BillsReceivable = lazy(() => import('./pages/payment/BillsReceivable'));
const WhatsApp = lazy(() => import('./pages/masters/WhatsApp'));
const CrmCut = lazy(() => import('./pages/crm/CrmOrders').then((m) => ({ default: m.CrmCut })));
const CrmRoll = lazy(() => import('./pages/crm/CrmOrders').then((m) => ({ default: m.CrmRoll })));
const ManagerApproval = lazy(() => import('./pages/crm/ManagerApproval'));
const LabelDesigns = lazy(() => import('./pages/masters/LabelDesigns'));
const LabelDesigner = lazy(() => import('./pages/masters/LabelDesigner'));
const LabelPrint = lazy(() => import('./pages/labels/LabelPrint'));
const IocBatchPrint = lazy(() => import('./pages/o2d/IocBatchPrint'));
const DeliveryNotePrint = lazy(() => import('./pages/o2d/DeliveryNotePrint'));
const PlanningToDispatch = lazy(() => import('./pages/dispatch/PlanningToDispatch'));
const DeliveryPlanning = lazy(() => import('./pages/dispatch/DeliveryPlanning'));
const Handover = lazy(() => import('./pages/dispatch/Handover'));
const ChallanPrint = lazy(() => import('./pages/dispatch/ChallanPrint'));
const PickingPrint = lazy(() => import('./pages/o2d/PickingPrint'));
const ProformaView = lazy(() => import('./pages/ProformaView'));
const TrackOrder = lazy(() => import('./pages/TrackOrder'));
const PaymentPromise = lazy(() => import('./pages/PaymentPromise'));
const Holidays = lazy(() => import('./pages/masters/Holidays'));
const Tasks = lazy(() => import('./pages/tasks/Tasks'));
const TaskDashboard = lazy(() => import('./pages/tasks/TaskDashboard'));
const PcDashboard = lazy(() => import('./pages/tasks/PcDashboard'));

// Real pages by navConfig `element` / path; anything else renders "Coming soon"
const PAGES = { '/dashboard': Dashboard, inventory: Inventory, employees: Employees, roles: Roles, clients: Clients, transports: Transports, cut_orders: CutOrders, roll_orders: RollOrders, zones: ZoneMapping, bills: BillsReceivable, whatsapp: WhatsApp, crm_cut: CrmCut, crm_roll: CrmRoll, crm_approval: ManagerApproval, planning_dispatch: PlanningToDispatch, dispatch_handover: Handover, delivery_planning: DeliveryPlanning, labels: LabelDesigns, holidays: Holidays, tasks: Tasks, task_dashboard: TaskDashboard, task_pc: PcDashboard };

// Task pages re-mount when the query string changes, so a notification link opens the right task even on the same page
const KeyedBySearch = ({ Page }) => <Page key={useLocation().search} />;

// Detail pages (not in the sidebar). View permission is enough to open; forms go read-only without edit.
const DETAIL_ROUTES = [
  { path: '/client-master/:id', perm: 'client_master', Page: ClientForm },
  { path: '/transport-master/:id', perm: 'transport_master', Page: TransportForm },
  { path: '/masters/labels/:id', perm: 'label_design', Page: LabelDesigner },
];

export default function App() {
  return (
    <Suspense fallback={<Loader fullscreen />}>
      <Routes>
        {/* Customer link from WhatsApp — no login */}
        <Route path="/payment-promise/:token" element={<PaymentPromise />} />
        <Route path="/proforma/:token" element={<ProformaView />} />
        <Route path="/track/:token" element={<TrackOrder />} />

        <Route element={<PublicOnlyRoute />}>
          <Route path="/login" element={<Login />} />
        </Route>

        <Route element={<ProtectedRoute />}>
          {/* Printable pages (no sidebar) */}
          <Route
            path="/dispatch/challan/:id/print"
            element={
              <RequirePermission perm="planning_dispatch">
                <ChallanPrint />
              </RequirePermission>
            }
          />
          <Route
            path="/o2d/delivery-note/print"
            element={
              <RequirePermission perm={['o2d_cut', 'o2d_roll']}>
                <DeliveryNotePrint />
              </RequirePermission>
            }
          />
          <Route
            path="/o2d/ioc-batches/:no/print"
            element={
              <RequirePermission perm="o2d_cut">
                <IocBatchPrint />
              </RequirePermission>
            }
          />
          <Route
            path="/labels/print"
            element={
              <RequirePermission perm={['label_design', 'o2d_cut', 'o2d_roll']}>
                <LabelPrint />
              </RequirePermission>
            }
          />
          <Route
            path="/o2d/cut/picking/print"
            element={
              <RequirePermission perm="picking">
                <PickingPrint />
              </RequirePermission>
            }
          />
          <Route element={<DashboardLayout />}>
            <Route index element={<HomeRedirect />} />

            {ALL_NAV_ITEMS.map((item) => {
              const Page = PAGES[item.element] || PAGES[item.to] || ComingSoon;
              return (
                <Route
                  key={item.to}
                  path={item.to}
                  element={
                    <RequirePermission perm={item.perm}>
                      <Suspense fallback={<Loader label="Loading…" />}>
                        {item.to.startsWith('/tasks') ? <KeyedBySearch Page={Page} /> : <Page />}
                      </Suspense>
                    </RequirePermission>
                  }
                />
              );
            })}

            {DETAIL_ROUTES.map(({ path, perm, Page }) => (
              <Route
                key={path}
                path={path}
                element={
                  <RequirePermission perm={perm}>
                    <Suspense fallback={<Loader label="Loading…" />}>
                      <Page />
                    </Suspense>
                  </RequirePermission>
                }
              />
            ))}

            {/* Role editor: view needs roles:view; create/edit checks happen inside */}
            <Route
              path="/masters/roles/:id"
              element={
                <RequirePermission perm="roles">
                  <RoleEditor />
                </RequirePermission>
              }
            />

            <Route path="*" element={<NotFound />} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  );
}
