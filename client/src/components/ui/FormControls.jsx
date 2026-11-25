import { forwardRef, useId } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

const FieldShell = ({ id, label, error, required, hint, children }) => (
  <div className={`field ${error ? 'field--error' : ''}`}>
    {label && (
      <label htmlFor={id} className="field__label">
        {label}
        {required && <span className="field__req"> *</span>}
      </label>
    )}
    {children}
    {error ? (
      <p id={`${id}-err`} className="field__error">
        {error}
      </p>
    ) : (
      hint && <p className="field__hint">{hint}</p>
    )}
  </div>
);

export const Select = forwardRef(function Select({ label, error, required, hint, children, className = '', ...rest }, ref) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} error={error} required={required} hint={hint}>
      <div className="field__control">
        <select
          id={id}
          ref={ref}
          className={`field__input field__select ${className}`}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-err` : undefined}
          {...rest}
        >
          {children}
        </select>
        <ChevronDown size={15} className="field__select-icon" />
      </div>
    </FieldShell>
  );
});

export const Textarea = forwardRef(function Textarea({ label, error, required, hint, rows = 3, ...rest }, ref) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} error={error} required={required} hint={hint}>
      <textarea
        id={id}
        ref={ref}
        rows={rows}
        className="field__input field__textarea"
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-err` : undefined}
        {...rest}
      />
    </FieldShell>
  );
});

export function Switch({ checked, onChange, label, disabled, description }) {
  const id = useId();
  return (
    <label className={`switch ${disabled ? 'is-disabled' : ''}`} htmlFor={id}>
      <input id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch__track" aria-hidden="true">
        <span className="switch__thumb" />
      </span>
      {(label || description) && (
        <span className="switch__text">
          {label && <span className="switch__label">{label}</span>}
          {description && <span className="switch__desc">{description}</span>}
        </span>
      )}
    </label>
  );
}

export function Pagination({ page, limit, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  const from = total ? (page - 1) * limit + 1 : 0;
  const to = Math.min(page * limit, total);
  return (
    <div className="pagination">
      <p className="pagination__info">
        Showing <strong>{from}</strong>–<strong>{to}</strong> of <strong>{total}</strong>
      </p>
      <div className="pagination__btns">
        <button type="button" className="icon-btn" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page">
          <ChevronLeft size={16} />
        </button>
        <span className="pagination__page">
          {page} / {pages}
        </span>
        <button type="button" className="icon-btn" onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Next page">
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
