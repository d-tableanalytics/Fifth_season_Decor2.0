import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, Search, ChevronDown, ChevronsLeft, User, LogOut } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { NotificationBell } from './NotificationBell';

function useClickOutside(ref, onOutside) {
  useEffect(() => {
    const handler = (e) => ref.current && !ref.current.contains(e.target) && onOutside();
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ref, onOutside]);
}

export function Topbar({ collapsed, onToggleCollapse, onOpenMobile }) {
  const { user, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [menu, setMenu] = useState(null); // 'notif' | 'user' | null
  const menusRef = useRef(null);
  useClickOutside(menusRef, () => setMenu(null));

  const initial = (user?.name || 'U').trim()[0].toUpperCase();
  const roleLabel = user?.role?.name;

  const handleLogout = () => {
    logout();
    toast.info('Logged out', 'See you again soon.');
    navigate('/login', { replace: true });
  };

  return (
    <header className="topbar">
      <button
        className={`collapse-btn ${collapsed ? 'is-collapsed' : ''}`}
        onClick={onToggleCollapse}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        <ChevronsLeft size={14} />
      </button>
      <button className="icon-btn topbar__menu" onClick={onOpenMobile} aria-label="Open menu">
        <Menu size={19} />
      </button>

      <label className="topbar__search">
        <Search size={15} />
        <input type="search" placeholder="Search anything..." />
      </label>

      <div className="topbar__actions" ref={menusRef}>

        <NotificationBell open={menu === 'notif'} onToggle={() => setMenu(menu === 'notif' ? null : 'notif')} onClose={() => setMenu(null)} />

        <div className="dropdown">
          <button className="user-chip" onClick={() => setMenu(menu === 'user' ? null : 'user')} aria-label="Account menu">
            <span className="avatar">{initial}</span>
            <span className="user-chip__meta">
              <span className="user-chip__name">{user?.name}</span>
              <span className="user-chip__role">{roleLabel}</span>
            </span>
            <ChevronDown size={14} className="user-chip__chev" />
          </button>
          {menu === 'user' && (
            <div className="dropdown__panel">
              <div className="dropdown__user">
                <span className="avatar avatar--lg">{initial}</span>
                <div>
                  <p className="dropdown__name">{user?.name}</p>
                  <p className="dropdown__email">{user?.email}</p>
                </div>
              </div>
              <button className="dropdown__item" onClick={() => setMenu(null)}>
                <User size={16} /> My Profile
              </button>
              <hr />
              <button className="dropdown__item dropdown__item--danger" onClick={handleLogout}>
                <LogOut size={16} /> Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
