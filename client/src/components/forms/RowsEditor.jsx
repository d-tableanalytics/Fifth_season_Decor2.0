import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { optionLabel } from '../../api/masters';

/**
 * Editable table for child rows (referrals, products, destinations…).
 * columns: [{ key, label, type: 'text'|'number'|'select'|'custom', options, width, render(row, update) }]
 */
export function RowsEditor({ rows, columns, onChange, readOnly, addLabel = 'Add row', emptyText = 'Nothing added yet.', newRow = {}, minRows = 0 }) {
  const update = (i, patch) => onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const remove = (i) => onChange(rows.filter((_, idx) => idx !== i));

  return (
    <div className="rows-editor">
      <div className="table-wrap table-wrap--flush">
        <table className="table rows-editor__table">
          <thead>
            <tr>
              <th className="rows-editor__idx">#</th>
              {columns.map((c) => (
                <th key={c.key} style={c.width ? { width: c.width } : undefined}>
                  {c.label}
                </th>
              ))}
              {!readOnly && <th className="rows-editor__act" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row._key || row.id || i}>
                <td className="rows-editor__idx">{i + 1}</td>
                {columns.map((c) => (
                  <td key={c.key}>
                    {c.type === 'custom' ? (
                      c.render(row, (patch) => update(i, patch), readOnly)
                    ) : c.type === 'select' ? (
                      <select className="cell-input" value={row[c.key] ?? ''} disabled={readOnly} onChange={(e) => update(i, { [c.key]: e.target.value || null })}>
                        <option value="">—</option>
                        {c.options.map((o) => (
                          <option key={o} value={o}>
                            {optionLabel(o)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="cell-input"
                        type={c.type === 'number' ? 'number' : 'text'}
                        step="any"
                        value={row[c.key] ?? ''}
                        placeholder={c.placeholder}
                        readOnly={readOnly}
                        onChange={(e) => update(i, { [c.key]: e.target.value })}
                      />
                    )}
                  </td>
                ))}
                {!readOnly && (
                  <td className="rows-editor__act">
                    <button type="button" className="icon-btn icon-btn--sm icon-btn--danger" title="Remove row" disabled={rows.length <= minRows} onClick={() => remove(i)}>
                      <Trash2 size={14} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="rows-editor__empty">{emptyText}</p>}
      </div>
      {!readOnly && (
        <Button variant="ghost" size="sm" icon={Plus} onClick={() => onChange([...rows, { ...newRow, _key: `${Date.now()}-${Math.random()}` }])}>
          {addLabel}
        </Button>
      )}
    </div>
  );
}
