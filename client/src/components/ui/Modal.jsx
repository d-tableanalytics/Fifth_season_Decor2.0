import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, TriangleAlert } from 'lucide-react';
import { Button } from './Button';

/**
 * <Modal open title onClose footer size="md|lg"> body </Modal>
 * Closes on Escape and backdrop click (unless `busy`).
 */
export function Modal({ open, title, subtitle, onClose, footer, size = 'md', busy = false, children }) {
  const panelRef = useRef(null);
  // Keep latest handlers in refs so effects don't re-run (and steal focus) on every parent render
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);
  onCloseRef.current = onClose;
  busyRef.current = busy;

  // Runs only when the modal opens/closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && !busyRef.current && onCloseRef.current();
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Focus the first field once, else the panel
    const first = panelRef.current?.querySelector('input:not([type=hidden]):not([hidden]), select, textarea, button:not(.modal__close)');
    (first || panelRef.current)?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className={`modal__panel modal__panel--${size}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} ref={panelRef} tabIndex={-1}>
        <div className="modal__head">
          <div>
            <h3>{title}</h3>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="icon-btn modal__close" onClick={onClose} disabled={busy} aria-label="Close">
            <X size={17} />
          </button>
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__foot">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

/** Yes/No confirmation for destructive actions. */
export function ConfirmDialog({ open, title, message, confirmLabel = 'Delete', tone = 'danger', busy, onConfirm, onClose }) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      busy={busy}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="confirm">
        <span className={`confirm__icon confirm__icon--${tone}`}>
          <TriangleAlert size={20} />
        </span>
        <p>{message}</p>
      </div>
    </Modal>
  );
}
