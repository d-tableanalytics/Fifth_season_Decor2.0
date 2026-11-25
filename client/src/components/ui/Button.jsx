import { Spinner } from './Loader';

export function Button({ variant = 'primary', size = 'md', loading = false, block = false, icon: Icon, children, disabled, ...rest }) {
  return (
    <button
      className={`btn btn--${variant} btn--${size} ${block ? 'btn--block' : ''}`}
      disabled={disabled || loading}
      aria-busy={loading}
      {...rest}
    >
      {loading ? <Spinner size={16} /> : Icon && <Icon size={16} />}
      <span>{children}</span>
    </button>
  );
}
