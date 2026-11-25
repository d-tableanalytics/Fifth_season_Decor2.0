import { forwardRef, useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

export const Input = forwardRef(function Input({ label, icon: Icon, error, hint, required, type = 'text', ...rest }, ref) {
  const id = useId();
  const [show, setShow] = useState(false);
  const isPassword = type === 'password';

  return (
    <div className={`field ${error ? 'field--error' : ''}`}>
      {label && (
        <label htmlFor={id} className="field__label">
          {label}
          {required && <span className="field__req"> *</span>}
        </label>
      )}
      <div className="field__control">
        {Icon && <Icon className="field__icon" size={16} />}
        <input
          id={id}
          ref={ref}
          type={isPassword && show ? 'text' : type}
          className={`field__input ${Icon ? 'has-icon' : ''} ${isPassword ? 'has-action' : ''}`}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-err` : undefined}
          {...rest}
        />
        {isPassword && (
          <button type="button" className="field__action" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}>
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
      </div>
      {error ? (
        <p id={`${id}-err`} className="field__error">
          {error}
        </p>
      ) : (
        hint && <p className="field__hint">{hint}</p>
      )}
    </div>
  );
});
