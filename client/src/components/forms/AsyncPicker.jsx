import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useDebounce } from '../../hooks/useDebounce';
import { Spinner } from '../ui/Loader';

/**
 * Type-to-search single select.
 * text            — what the input shows when nothing is being typed (e.g. selected client's ID)
 * load(search)    — Promise<option[]>
 * renderOption(o) — option content
 * onSelect(o|null)
 * exactMatch(o, typed) — Enter selects the first option for which this returns true
 */
export function AsyncPicker({ text, load, renderOption, onSelect, exactMatch, placeholder, disabled, invalid, className = '' }) {
  const [typed, setTyped] = useState(null); // null = not typing; show `text`
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const q = useDebounce(typed ?? '', 250);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    load(q)
      .then((o) => alive && setOptions(o))
      .catch(() => alive && setOptions([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [q, open, load]);

  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (!ref.current?.contains(e.target)) {
        setOpen(false);
        setTyped(null);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const choose = (o) => {
    onSelect(o);
    setOpen(false);
    setTyped(null);
  };

  const onKeyDown = async (e) => {
    if (e.key === 'Escape') {
      setOpen(false);
      setTyped(null);
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const value = (typed ?? '').trim();
      if (!value) return;
      // Use fresh results for the exact text so a fast Enter still resolves
      const list = await load(value).catch(() => []);
      const hit = list.find((o) => exactMatch?.(o, value)) || (list.length === 1 ? list[0] : null);
      if (hit) choose(hit);
    }
  };

  return (
    <div className={`apicker ${className}`} ref={ref}>
      <label className={`apicker__control ${invalid ? 'is-invalid' : ''} ${disabled ? 'is-disabled' : ''}`}>
        <Search size={14} />
        <input
          value={typed ?? text ?? ''}
          placeholder={placeholder}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setTyped(e.target.value);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
        {loading && open && <Spinner size={12} />}
        {text && !disabled && (
          <button type="button" className="apicker__clear" aria-label="Clear" onClick={() => onSelect(null)}>
            <X size={13} />
          </button>
        )}
      </label>
      {open && !disabled && (
        <ul className="apicker__menu">
          {options.map((o, i) => (
            <li key={o.id || o.sku_code || i}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => choose(o)}>
                {renderOption(o)}
              </button>
            </li>
          ))}
          {!loading && options.length === 0 && <li className="apicker__empty">No matches</li>}
        </ul>
      )}
    </div>
  );
}
