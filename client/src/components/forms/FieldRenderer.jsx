import { Input } from '../ui/Input';
import { Select, Textarea, Switch } from '../ui/FormControls';
import { ImageUploadField } from '../ui/ImageUploadField';
import { optionLabel } from '../../api/masters';

/**
 * Renders one field from a section config.
 * field: { key, label, type: text|number|select|multi|textarea|switch|date|image|readonly, options, required, hint, full, placeholder, upper }
 * ctx:   { values, errors, set(key, value), readOnly, s3Enabled, folder, onUploaded }
 */
export function FieldRenderer({ field, ctx }) {
  const { values, errors, set, readOnly } = ctx;
  const v = values[field.key];
  const error = errors[field.key];
  const common = { label: field.label, required: field.required, error, hint: field.hint, disabled: readOnly || field.disabled };
  const wrap = (node) => (
    <div className={field.full ? 'form-grid__full' : ''} data-field={field.key}>
      {node}
    </div>
  );

  switch (field.type) {
    case 'select':
      return wrap(
        <Select {...common} value={v ?? ''} onChange={(e) => set(field.key, e.target.value || null)}>
          <option value="">{field.placeholder || '— Select —'}</option>
          {field.options.map((o) => (
            <option key={o} value={o}>
              {field.raw ? o : optionLabel(o)}
            </option>
          ))}
        </Select>
      );
    case 'multi': {
      const selected = Array.isArray(v) ? v : [];
      const toggle = (o) => set(field.key, selected.includes(o) ? selected.filter((x) => x !== o) : [...selected, o]);
      return (
        <div className="form-grid__full field" data-field={field.key}>
          <span className="field__label">{field.label}</span>
          <div className="chip-select" role="group" aria-label={field.label}>
            {field.options.map((o) => (
              <button
                key={o}
                type="button"
                className={`chip-select__chip ${selected.includes(o) ? 'is-on' : ''}`}
                aria-pressed={selected.includes(o)}
                disabled={common.disabled}
                onClick={() => toggle(o)}
              >
                {optionLabel(o)}
              </button>
            ))}
          </div>
          {error && <p className="field__error">{error}</p>}
        </div>
      );
    }
    case 'textarea':
      return (
        <div className="form-grid__full" data-field={field.key}>
          <Textarea {...common} rows={field.rows || 2} value={v ?? ''} onChange={(e) => set(field.key, e.target.value)} placeholder={field.placeholder} />
        </div>
      );
    case 'switch':
      return wrap(
        <div className="field">
          <span className="field__label">{field.label}</span>
          <div className="switch-wrap">
            <Switch checked={!!v} disabled={common.disabled} onChange={(on) => set(field.key, on)} label={v ? field.on || 'Yes' : field.off || 'No'} />
          </div>
        </div>
      );
    case 'image':
      return (
        <div className={field.full === false ? '' : 'form-grid__full'} data-field={field.key}>
          <ImageUploadField
            label={field.label}
            value={v || ''}
            previewUrl={values[`${field.key}_view`]}
            s3Enabled={ctx.s3Enabled}
            folder={ctx.folder}
            compact
            disabled={common.disabled}
            error={error}
            alt={field.label}
            onUploaded={ctx.onUploaded}
            onChange={(value, preview) => {
              set(field.key, value || null);
              set(`${field.key}_view`, preview);
            }}
          />
        </div>
      );
    case 'number':
      return wrap(
        <Input {...common} type="number" step={field.step || 'any'} value={v ?? ''} placeholder={field.placeholder} onChange={(e) => set(field.key, e.target.value)} />
      );
    case 'date':
      return wrap(<Input {...common} type="date" value={v ?? ''} onChange={(e) => set(field.key, e.target.value)} />);
    default:
      return wrap(
        <Input
          {...common}
          value={v ?? ''}
          placeholder={field.placeholder}
          maxLength={field.max}
          onChange={(e) => set(field.key, field.upper ? e.target.value.toUpperCase() : e.target.value)}
        />
      );
  }
}

/** A titled card with a 2-column grid of fields. */
export function FormSection({ id, title, subtitle, fields, ctx, children, actions }) {
  return (
    <section id={id} className="card form-card">
      <div className="form-card__head">
        <div>
          <h3>{title}</h3>
          {subtitle && <p className="card__sub">{subtitle}</p>}
        </div>
        {actions}
      </div>
      {fields && (
        <div className="form-grid">
          {fields.map((f) => (
            <FieldRenderer key={f.key} field={f} ctx={ctx} />
          ))}
        </div>
      )}
      {children}
    </section>
  );
}
