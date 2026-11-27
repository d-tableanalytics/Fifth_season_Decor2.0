import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Check, Circle, X } from 'lucide-react';
import { notificationsApi } from '../../api/tasks';

const relTime = (iso) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} days ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' });
};

/** Bell with unread badge + dropdown (spec 12.3). Polls the count every 30 s and on focus; open list refreshes every 30 s. */
export function NotificationBell({ open, onToggle, onClose }) {
  const navigate = useNavigate();
  const [unread, setUnread] = useState(0);
  const [tab, setTab] = useState('all');
  const [items, setItems] = useState(null);
  const tabRef = useRef(tab);
  tabRef.current = tab;

  const refreshCount = useCallback(() => notificationsApi.count().then((r) => setUnread(r.unread)).catch(() => {}), []);
  const loadList = useCallback(
    () =>
      notificationsApi
        .list({ limit: 50, ...(tabRef.current === 'unread' ? { unread: 1 } : {}) })
        .then((r) => { setItems(r.items); setUnread(r.unread); })
        .catch(() => setItems((v) => v || [])),
    []
  );

  useEffect(() => {
    refreshCount();
    const t = setInterval(refreshCount, 30000);
    window.addEventListener('focus', refreshCount);
    return () => { clearInterval(t); window.removeEventListener('focus', refreshCount); };
  }, [refreshCount]);

  useEffect(() => {
    if (!open) return undefined;
    setItems(null);
    loadList();
    const t = setInterval(loadList, 30000);
    return () => clearInterval(t);
  }, [open, tab, loadList]);

  const mark = (n, read) => {
    setItems((l) => l.map((x) => (x.id === n.id ? { ...x, read_at: read ? new Date().toISOString() : null } : x)));
    setUnread((u) => Math.max(0, u + (read ? -1 : 1)));
    (read ? notificationsApi.read : notificationsApi.unread)(n.id).catch(refreshCount);
  };
  const remove = (n) => {
    setItems((l) => l.filter((x) => x.id !== n.id));
    if (!n.read_at) setUnread((u) => Math.max(0, u - 1));
    notificationsApi.remove(n.id).catch(refreshCount);
  };
  const go = (n) => {
    if (!n.read_at) mark(n, true);
    onClose();
    if (n.link) navigate(n.link);
  };
  const readAll = () => {
    setItems((l) => l.map((x) => ({ ...x, read_at: x.read_at || new Date().toISOString() })));
    setUnread(0);
    notificationsApi.readAll().catch(refreshCount);
  };
  const clearRead = () => {
    setItems((l) => l.filter((x) => !x.read_at));
    notificationsApi.clearRead().catch(refreshCount);
  };

  return (
    <div className="dropdown">
      <button className="icon-btn" onClick={onToggle} aria-label="Notifications">
        <Bell size={17} strokeWidth={1.75} />
        {unread > 0 && <span className="icon-btn__count">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="dropdown__panel notif-panel">
          <div className="notif-head">
            <strong>Notifications</strong>
            <button type="button" className="notif-link" onClick={readAll} disabled={!unread}>Mark all as read</button>
          </div>
          <div className="notif-tabs">
            <button type="button" className={tab === 'all' ? 'is-on' : ''} onClick={() => setTab('all')}>All</button>
            <button type="button" className={tab === 'unread' ? 'is-on' : ''} onClick={() => setTab('unread')}>Unread ({unread})</button>
          </div>
          <div className="notif-list">
            {items === null && <p className="notif-empty">Loading…</p>}
            {items && !items.length && (
              <p className="notif-empty">
                {tab === 'unread' ? 'No unread notifications' : 'You are all caught up. Tasks assigned to you and status changes will appear here.'}
              </p>
            )}
            {items?.map((n) => (
              <div key={n.id} className={`notif-row ${n.read_at ? '' : 'is-unread'}`}>
                <button type="button" className="notif-row__main" onClick={() => go(n)}>
                  <span className="notif-row__icon">{n.kind === 'assigned' ? '📌' : '🔄'}</span>
                  <span className="notif-row__text">
                    <span className="notif-row__title">{n.title}</span>
                    {n.body && <span className="notif-row__body">{n.body}</span>}
                    <span className="notif-row__meta">
                      {relTime(n.created_at)}{n.actor_name ? ` · by ${n.actor_name}` : ''}{n.link ? ' · tap to open' : ''}
                    </span>
                  </span>
                </button>
                <button type="button" className="notif-row__btn" title={n.read_at ? 'Mark as unread' : 'Mark as read'} onClick={() => mark(n, !n.read_at)}>
                  {n.read_at ? <Circle size={14} /> : <Check size={14} />}
                </button>
                <button type="button" className="notif-row__btn" title="Delete" onClick={() => remove(n)}><X size={14} /></button>
              </div>
            ))}
          </div>
          <div className="notif-foot">
            <button type="button" className="notif-link" onClick={clearRead}>Clear read</button>
          </div>
        </div>
      )}
    </div>
  );
}
