/**
 * <Badge variant="success|warning|danger|info|neutral|brand" dot>Text</Badge>
 * <StatusBadge status="cutting" /> maps business statuses to colours.
 */
export function Badge({ variant = 'neutral', dot = false, size = 'md', children }) {
  return (
    <span className={`badge badge--${variant} badge--${size}`}>
      {dot && <span className="badge__dot" />}
      {children}
    </span>
  );
}

const STATUS_MAP = {
  pending: { variant: 'warning', label: 'Pending' },
  design: { variant: 'info', label: 'In Design' },
  cutting: { variant: 'brand', label: 'Cutting' },
  ready: { variant: 'info', label: 'Ready' },
  dispatched: { variant: 'neutral', label: 'Dispatched' },
  delivered: { variant: 'success', label: 'Delivered' },
  cancelled: { variant: 'danger', label: 'Cancelled' },
  paid: { variant: 'success', label: 'Paid' },
  unpaid: { variant: 'danger', label: 'Unpaid' },
  partial: { variant: 'warning', label: 'Partial' },
};

export function StatusBadge({ status }) {
  const s = STATUS_MAP[status] || { variant: 'neutral', label: status };
  return (
    <Badge variant={s.variant} dot>
      {s.label}
    </Badge>
  );
}
