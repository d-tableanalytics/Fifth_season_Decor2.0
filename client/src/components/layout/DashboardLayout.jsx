import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

const COLLAPSE_KEY = 'fsd_sidebar_collapsed';

const readCollapsed = () => {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
};

export function DashboardLayout() {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);

  const setCollapsedPersist = (value) => {
    setCollapsed(value);
    try {
      localStorage.setItem(COLLAPSE_KEY, value ? '1' : '0');
    } catch {
      /* ignore */
    }
  };

  return (
    <div className={`shell ${collapsed ? 'shell--collapsed' : ''}`}>
      <Sidebar
        collapsed={collapsed}
        onExpand={() => setCollapsedPersist(false)}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />
      <div className="shell__main">
        <Topbar
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsedPersist(!collapsed)}
          onOpenMobile={() => setMobileOpen(true)}
        />
        <main className="shell__content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
