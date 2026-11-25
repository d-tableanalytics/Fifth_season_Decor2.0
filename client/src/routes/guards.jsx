import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Loader } from '../components/ui/Loader';
import { firstAllowedPath } from '../components/layout/navConfig';
import AccessDenied from '../pages/AccessDenied';

export function ProtectedRoute() {
  const { user, booting } = useAuth();
  const location = useLocation();
  if (booting) return <Loader fullscreen label="Preparing your workspace…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return <Outlet />;
}

export function PublicOnlyRoute() {
  const { user, booting } = useAuth();
  if (booting) return <Loader fullscreen label="Loading…" />;
  if (user) return <Navigate to="/" replace />;
  return <Outlet />;
}

/** Renders children only if the user can `action` the module; otherwise an Access Denied page. */
export function RequirePermission({ perm, action = 'view', children }) {
  const { can } = useAuth();
  return can(perm, action) ? children : <AccessDenied />;
}

/** "/" -> the first page this user is allowed to see. */
export function HomeRedirect() {
  const { can } = useAuth();
  const to = firstAllowedPath(can);
  return to ? <Navigate to={to} replace /> : <AccessDenied noModules />;
}
