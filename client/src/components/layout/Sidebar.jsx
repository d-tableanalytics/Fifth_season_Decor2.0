import { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown, LogOut, X } from 'lucide-react';
import { NAV_ITEMS, visibleNav } from './navConfig';
import { Logo } from '../ui/Logo';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';

const groupIsActive = (item, pathname) => item.children?.some((c) => pathname.startsWith(c.to));

export function Sidebar({ collapsed, onExpand, mobileOpen, onCloseMobile }) {
  const { logout, can } = useAuth();
  const items = visibleNav(can);
  const toast = useToast();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [openGroups, setOpenGroups] = useState(() => new Set());

  // Keep the group containing the current page open
  useEffect(() => {
    const active = NAV_ITEMS.find((i) => groupIsActive(i, pathname));
    if (active) setOpenGroups((s) => (s.has(active.key) ? s : new Set(s).add(active.key)));
  }, [pathname]);

  const toggleGroup = (key) => {
    if (collapsed) {
      onExpand();
      setOpenGroups((s) => new Set(s).add(key));
      return;
    }
    setOpenGroups((s) => {
      const next = new Set(s);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const handleLogout = () => {
    logout();
    toast.info('Logged out', 'See you again soon.');
    navigate('/login', { replace: true });
  };

  return (
    <>
      <div className={`sidebar-backdrop ${mobileOpen ? 'is-visible' : ''}`} onClick={onCloseMobile} />
      <aside className={`sidebar ${collapsed ? 'is-collapsed' : ''} ${mobileOpen ? 'is-mobile-open' : ''}`}>
        <button className="sidebar__close" onClick={onCloseMobile} aria-label="Close menu">
          <X size={18} />
        </button>

        <div className="sidebar__brand">
          <Logo size={collapsed ? 36 : 76} />
          <p className="sidebar__tagline">Curtains &amp; Upholstery</p>
        </div>

        <nav className="sidebar__nav" aria-label="Main">
          {items.map((item) => {
            const Icon = item.icon;

            if (!item.children) {
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => `sidebar__link ${isActive ? 'is-active' : ''}`}
                  onClick={onCloseMobile}
                  title={collapsed ? item.label : undefined}
                >
                  <Icon size={17} strokeWidth={1.75} className="sidebar__icon" />
                  <span className="sidebar__label">{item.label}</span>
                </NavLink>
              );
            }

            const open = openGroups.has(item.key) && !collapsed;
            const active = groupIsActive(item, pathname);
            return (
              <div key={item.key} className={`sidebar__group ${open ? 'is-open' : ''}`}>
                <button
                  type="button"
                  className={`sidebar__link ${active ? 'is-parent-active' : ''}`}
                  onClick={() => toggleGroup(item.key)}
                  aria-expanded={open}
                  title={collapsed ? item.label : undefined}
                >
                  <Icon size={17} strokeWidth={1.75} className="sidebar__icon" />
                  <span className="sidebar__label">{item.label}</span>
                  <ChevronDown size={14} className="sidebar__chevron" />
                </button>
                <div className="sidebar__sub">
                  <div className="sidebar__sub-inner">
                    {item.children.map((c) => (
                      <NavLink
                        key={c.to}
                        to={c.to}
                        className={({ isActive }) => `sidebar__sublink ${isActive ? 'is-active' : ''}`}
                        onClick={onCloseMobile}
                        tabIndex={open ? 0 : -1}
                      >
                        {c.label}
                      </NavLink>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </nav>

        <div className="sidebar__foot">
          <button className="sidebar__logout" onClick={handleLogout} title={collapsed ? 'Logout' : undefined}>
            <LogOut size={16} strokeWidth={1.75} />
            <span className="sidebar__label">Logout</span>
          </button>
          <p className="sidebar__motto">Growth with Quality</p>
        </div>
      </aside>
    </>
  );
}
