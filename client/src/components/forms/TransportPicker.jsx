import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Search, X, Truck } from 'lucide-react';
import { transportsApi, optionLabel } from '../../api/masters';
import { useDebounce } from '../../hooks/useDebounce';
import { Spinner } from '../ui/Loader';

/**
 * Searchable transport selector.
 * value: { id, transport_id, transport_name, transport_city } | null
 */
export function TransportPicker({ value, onChange, disabled, invalidCode }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const q = useDebounce(search, 250);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    transportsApi
      .options(q)
      .then((o) => alive && setOptions(o))
      .catch(() => alive && setOptions([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [q, open]);

  useEffect(() => {
    if (!open) return;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="tpicker" ref={ref}>
      <button type="button" className={`tpicker__btn ${invalidCode ? 'is-warn' : ''}`} disabled={disabled} onClick={() => setOpen((o) => !o)}>
        {value?.id ? (
          <span className="tpicker__value">
            <span className="mono">{value.transport_id}</span>
            <span className="tpicker__name">{value.transport_name}</span>
          </span>
        ) : invalidCode ? (
          <span className="tpicker__placeholder">{invalidCode} — not found</span>
        ) : (
          <span className="tpicker__placeholder">Select transport…</span>
        )}
        {value?.id && !disabled ? (
          <span
            role="button"
            tabIndex={0}
            className="tpicker__clear"
            aria-label="Clear transport"
            onClick={(e) => {
              e.stopPropagation();
              onChange(null);
            }}
          >
            <X size={13} />
          </span>
        ) : (
          <ChevronDown size={14} />
        )}
      </button>

      {open && (
        <div className="tpicker__menu">
          <label className="tpicker__search">
            <Search size={14} />
            <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or TRN id…" />
            {loading && <Spinner size={12} />}
          </label>
          <ul>
            {options.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  className={value?.id === o.id ? 'is-selected' : ''}
                  onClick={() => {
                    onChange(o);
                    setOpen(false);
                  }}
                >
                  <Truck size={14} />
                  <span className="tpicker__opt">
                    <strong>{o.transport_name}</strong>
                    <small>
                      {o.transport_id}
                      {o.transport_city ? ` · ${o.transport_city}` : ''}
                      {o.transport_type ? ` · ${optionLabel(o.transport_type)}` : ''}
                      {!o.is_active ? ' · inactive' : ''}
                    </small>
                  </span>
                </button>
              </li>
            ))}
            {!loading && options.length === 0 && <li className="tpicker__empty">No transports found</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
