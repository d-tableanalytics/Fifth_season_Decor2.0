import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';

const ToastContext = createContext(null);

const ICONS = { success: CheckCircle2, error: XCircle, warning: AlertTriangle, info: Info };

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id) => {
    setToasts((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 250);
  }, []);

  const show = useCallback(
    (type, title, message, duration = 4000) => {
      const id = ++idRef.current;
      setToasts((list) => [...list.slice(-4), { id, type, title, message, duration }]);
      if (duration) setTimeout(() => dismiss(id), duration);
      return id;
    },
    [dismiss]
  );

  const toast = useMemo(
    () => ({
      success: (title, message, d) => show('success', title, message, d),
      error: (title, message, d) => show('error', title, message, d),
      warning: (title, message, d) => show('warning', title, message, d),
      info: (title, message, d) => show('info', title, message, d),
      dismiss,
    }),
    [show, dismiss]
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toaster" role="region" aria-live="polite" aria-label="Notifications">
        {toasts.map((t) => {
          const Icon = ICONS[t.type];
          return (
            <div key={t.id} className={`toast toast--${t.type} ${t.leaving ? 'is-leaving' : ''}`} role="status">
              <Icon className="toast__icon" size={20} />
              <div className="toast__body">
                <p className="toast__title">{t.title}</p>
                {t.message && <p className="toast__msg">{t.message}</p>}
              </div>
              <button className="toast__close" onClick={() => dismiss(t.id)} aria-label="Dismiss">
                <X size={16} />
              </button>
              {t.duration > 0 && <span className="toast__progress" style={{ animationDuration: `${t.duration}ms` }} />}
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
};
