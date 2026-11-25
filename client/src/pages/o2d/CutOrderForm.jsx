import { useEffect, useMemo, useState } from 'react';
import { Save, TriangleAlert, Pencil } from 'lucide-react';
import { o2dLookups, ORDER_MODES, UNITS, STAGE_LABELS } from '../../api/o2d';
import { getErrorMessage } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { FormSection } from '../../components/forms/FieldRenderer';
import { RowsEditor } from '../../components/forms/RowsEditor';
import { AsyncPicker } from '../../components/forms/AsyncPicker';
import { Input } from '../../components/ui/Input';
import { Select, Textarea } from '../../components/ui/FormControls';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Loader } from '../../components/ui/Loader';
import { Modal } from '../../components/ui/Modal';
import { ImageThumb } from '../../components/ui/ImageThumb';
import { Lightbox } from '../../components/ui/Lightbox';
import { useO2D } from '../../context/O2DContext';
import { RemarksSection } from '../../components/o2d/RemarksSection';

const newItem = () => ({ _key: `${Date.now()}-${Math.random()}`, sku_code: '', catalogue_name: '', qty: '', unit: 'Mtr', remark: '' });
const EMPTY = {
  order_mode: 'MANUAL', doer_id: '', contact_person_phone: '', client_reference_order: '', third_party_name: '', third_party_address: '',
  priority: '', transport_source: 'CLIENT', transport_ref: null, transport_name: '', mode_of_dispatch: '', transport_contact: '',
  transport_address: '', transport_city: '', team_remark: '', customer_remark: '',
};
const FIELDS = Object.keys(EMPTY);

/**
 * Cut order enquiry in a modal.
 * id = null -> new enquiry (edit mode). With an id it opens in view mode, or edit mode when mode = 'edit'.
 */
export function CutOrderModal({ id = null, mode = 'view', onClose, onSaved }) {
  const o2d = useO2D();
  const isNew = !id;
  const [editing, setEditing] = useState(isNew || mode === 'edit');
  const toast = useToast();
  const { user, can } = useAuth();

  const [v, setV] = useState({ ...EMPTY });
  const [client, setClient] = useState(null); // { id, client_id, company_name, city, state, owner_contact_no }
  const [items, setItems] = useState([newItem()]);
  const [order, setOrder] = useState(null);
  const [doers, setDoers] = useState([]);
  const [clientTransports, setClientTransports] = useState([]);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [dup, setDup] = useState(null); // { duplicates, canOverride }
  const [overrideReason, setOverrideReason] = useState('');
  const [preview, setPreview] = useState(null); // { url, title, subtitle }

  const cancelled = order?.status === 'CANCELLED';
  const readOnly = !editing || cancelled || (isNew ? !can(o2d.perm, 'create') : !can(o2d.perm, 'edit'));
  const set = (k, value) => {
    setV((s) => ({ ...s, [k]: value }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  useEffect(() => {
    o2d.apis.orders.doers().then((d) => {
      setDoers(d);
      if (isNew && d.some((x) => x.id === user.id)) setV((s) => (s.doer_id ? s : { ...s, doer_id: user.id }));
    }).catch(() => setDoers([]));
    if (isNew) return;
    o2d.apis.orders
      .get(id)
      .then((o) => {
        setOrder(o);
        setV(Object.fromEntries(FIELDS.map((k) => [k, o[k] ?? EMPTY[k]])));
        setClient({ id: o.client_ref, client_id: o.client_id, company_name: o.company_name, city: o.client_city, state: o.client_state, owner_contact_no: o.client_contact });
        setItems(o.items.length ? o.items.map((i) => ({ ...i, _key: i.id })) : [newItem()]);
      })
      .catch((err) => {
        toast.error('Could not load order', getErrorMessage(err));
        onClose();
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // This client's CUT transporters, ranked by priority
  useEffect(() => {
    if (!client?.id) return setClientTransports([]);
    o2dLookups.clientTransports(client.id, o2d.type).then(setClientTransports).catch(() => setClientTransports([]));
  }, [client?.id]);

  const offered = useMemo(() => clientTransports.filter((t) => !v.priority || t.priority === v.priority), [clientTransports, v.priority]);

  const pickClient = (c) => {
    setClient(c);
    setErrors((e) => ({ ...e, client_ref: undefined }));
    // Client changed: client-specific transport no longer valid
    if (v.transport_source === 'CLIENT') setV((s) => ({ ...s, transport_ref: null, transport_name: '' }));
  };

  const pickTransport = (t) =>
    setV((s) => ({
      ...s,
      transport_ref: t?.id || null,
      transport_name: t?.transport_name || '',
      transport_contact: t ? t.transport_contact_number || '' : s.transport_contact,
      transport_address: t ? t.transport_full_address || t.transport_address || '' : s.transport_address,
      transport_city: t ? t.transport_city || '' : s.transport_city,
    }));

  const validate = () => {
    const er = {};
    if (!client?.id) er.client_ref = 'Select a client';
    if (v.contact_person_phone && !/^\d{10}$/.test(v.contact_person_phone)) er.contact_person_phone = 'Must be 10 digits';
    if (v.order_mode === 'THIRD_PARTY') {
      if (!v.third_party_name.trim()) er.third_party_name = 'Third party name is required';
      if (!v.third_party_address.trim()) er.third_party_address = 'Third party address is required';
    }
    const badItem = items.findIndex((i) => !i.sku_code || !(Number(i.qty) >= 0.01) || !i.unit);
    if (badItem >= 0) er.items = `Row ${badItem + 1}: SKU code, Qty (≥ 0.01) and Unit are required`;
    setErrors(er);
    return !Object.keys(er).length;
  };

  const submit = async (override_reason) => {
    if (!validate()) return toast.warning('Please fix the highlighted fields');
    setSaving(true);
    const body = {
      ...v,
      doer_id: v.doer_id || null,
      client_ref: client.id,
      items: items.map(({ sku_code, catalogue_name, qty, unit, remark }) => ({ sku_code, catalogue_name, qty, unit, remark })),
      ...(override_reason && { override_reason }),
    };
    try {
      const saved = isNew ? await o2d.apis.orders.create(body) : await o2d.apis.orders.update(id, body);
      toast.success(isNew ? 'Order enquiry created' : 'Order saved', saved.system_order_no || saved.enquiry_number);
      setDup(null);
      onSaved(saved);
    } catch (err) {
      const data = err.response?.data;
      if (data?.code === 'DUPLICATE_ORDER') {
        setDup({ duplicates: data.duplicates, canOverride: data.canOverride });
        setOverrideReason('');
      } else {
        if (data?.field) setErrors((e) => ({ ...e, [data.field.split('.')[0]]: data.message }));
        toast.error('Could not save order', getErrorMessage(err));
      }
    } finally {
      setSaving(false);
    }
  };

  const orderNo = order ? order.system_order_no || order.enquiry_number : null;
  const canEdit = !isNew && !cancelled && can(o2d.perm, 'edit');

  const footer = loading ? null : !editing ? (
    <>
      <Button variant="secondary" onClick={onClose}>Close</Button>
      {canEdit && <Button icon={Pencil} onClick={() => setEditing(true)}>Edit</Button>}
    </>
  ) : (
    <>
      <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
      {!readOnly && (
        <Button icon={Save} loading={saving} onClick={() => submit()}>
          {isNew ? 'Submit Enquiry' : 'Save Changes'}
        </Button>
      )}
    </>
  );

  const title = (
    <span className="modal-title-row">
      {isNew ? 'New Order Enquiry' : `Order ${orderNo || ''}`}
      {order && <Badge size="sm" variant={cancelled ? 'danger' : order.status === 'ON_HOLD' ? 'warning' : 'brand'}>{cancelled ? 'Cancelled' : STAGE_LABELS[order.workflow_status]}</Badge>}
      {!isNew && !loading && <Badge size="sm" variant="neutral">{editing && !readOnly ? 'Editing' : 'View only'}</Badge>}
    </span>
  );

  return (
    <>
    <Modal
      open
      size="xl"
      title={title}
      subtitle={isNew ? `O2D › ${o2d.label} › Order Enquiry` : order?.company_name}
      busy={saving || !!dup || !!preview}
      onClose={onClose}
      footer={footer}
    >
      {loading ? (
        <Loader label="Loading order…" />
      ) : (
      <div className="form-sections o2d-form">
        <FormSection id="info" title="Order information">
          <div className="form-grid">
            <div className="field form-grid__full">
              <span className="field__label">
                Order Mode<span className="field__req"> *</span>
              </span>
              <div className="radio-row" role="radiogroup" aria-label="Order mode">
                {ORDER_MODES.map((m) => (
                  <label key={m.key} className={`radio-pill ${v.order_mode === m.key ? 'is-on' : ''} ${!isNew || readOnly ? 'is-disabled' : ''}`}>
                    <input
                      type="radio"
                      name="order_mode"
                      checked={v.order_mode === m.key}
                      disabled={!isNew || readOnly}
                      onChange={() =>
                        setV((s) => ({ ...s, order_mode: m.key, ...(m.key !== 'THIRD_PARTY' && { third_party_name: '', third_party_address: '' }) }))
                      }
                    />
                    {m.label}
                  </label>
                ))}
              </div>
              {!isNew && <p className="field__hint">Order mode cannot be changed after the order is created.</p>}
            </div>

            <Select label="Doer Name" value={v.doer_id ?? ''} disabled={readOnly} onChange={(e) => set('doer_id', e.target.value ? Number(e.target.value) : '')}>
              <option value="">— Select —</option>
              {doers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} {d.employee_code ? `(${d.employee_code})` : ''}
                </option>
              ))}
            </Select>
            <Input
              label="Contact Person Phone"
              value={v.contact_person_phone ?? ''}
              disabled={readOnly}
              inputMode="numeric"
              maxLength={10}
              placeholder="10-digit mobile"
              error={errors.contact_person_phone}
              onChange={(e) => set('contact_person_phone', e.target.value.replace(/\D/g, '').slice(0, 10))}
            />

            <div className="field" data-field="client_ref">
              <span className="field__label">
                Client ID<span className="field__req"> *</span>
              </span>
              <AsyncPicker
                text={client?.client_id}
                load={o2dLookups.clients}
                disabled={readOnly}
                invalid={!!errors.client_ref}
                placeholder="Type client ID + Enter"
                exactMatch={(o, typed) => o.client_id.toUpperCase() === typed.toUpperCase()}
                onSelect={pickClient}
                renderOption={(o) => (
                  <span className="apicker__opt">
                    <strong className="mono">{o.client_id}</strong>
                    <small>{o.company_name}{o.city ? ` · ${o.city}` : ''}</small>
                  </span>
                )}
              />
              {errors.client_ref && <p className="field__error">{errors.client_ref}</p>}
            </div>
            <div className="field">
              <span className="field__label">
                Company Name<span className="field__req"> *</span>
              </span>
              <AsyncPicker
                text={client?.company_name}
                load={o2dLookups.clients}
                disabled={readOnly}
                invalid={!!errors.client_ref}
                placeholder="Search company name"
                onSelect={pickClient}
                renderOption={(o) => (
                  <span className="apicker__opt">
                    <strong>{o.company_name}</strong>
                    <small>{o.client_id}{o.city ? ` · ${o.city}` : ''}</small>
                  </span>
                )}
              />
            </div>

            <Input
              label="Client Reference Order"
              value={v.client_reference_order ?? ''}
              disabled={readOnly}
              maxLength={100}
              placeholder="PO number (optional)"
              onChange={(e) => set('client_reference_order', e.target.value)}
            />
            <div className="field">
              <span className="field__label">Enquiry No</span>
              <div className="readonly-box mono">{order?.enquiry_number || 'Generated on save'}</div>
            </div>

            {v.order_mode === 'THIRD_PARTY' && (
              <>
                <Input
                  label="Third Party Name"
                  required
                  value={v.third_party_name ?? ''}
                  disabled={readOnly}
                  maxLength={200}
                  error={errors.third_party_name}
                  onChange={(e) => set('third_party_name', e.target.value)}
                />
                <Textarea
                  label="Third Party Address"
                  required
                  rows={2}
                  value={v.third_party_address ?? ''}
                  disabled={readOnly}
                  error={errors.third_party_address}
                  onChange={(e) => set('third_party_address', e.target.value)}
                />
              </>
            )}

            <div className="field form-grid__full">
              <span className="field__label">Client details</span>
              <div className="readonly-grid">
                <div><small>City</small><strong>{client?.city || '—'}</strong></div>
                <div><small>State</small><strong>{client?.state || '—'}</strong></div>
                <div><small>Contact</small><strong>{client?.owner_contact_no || '—'}</strong></div>
              </div>
            </div>
          </div>
        </FormSection>

        <FormSection id="catalogue" title="Catalogue" subtitle="At least one item is required.">
          {errors.items && <p className="form-note form-note--warn"><TriangleAlert size={15} /> {errors.items}</p>}
          <RowsEditor
            rows={items}
            readOnly={readOnly}
            minRows={1}
            addLabel="Add item"
            onChange={(rows) => {
              setItems(rows);
              setErrors((e) => ({ ...e, items: undefined }));
            }}
            newRow={{ sku_code: '', catalogue_name: '', qty: '', unit: 'Mtr', remark: '' }}
            columns={[
              {
                key: 'sku_code',
                label: 'SKU Code *',
                type: 'custom',
                render: (row, update, ro) => (
                  <AsyncPicker
                    className="apicker--cell"
                    text={row.sku_code}
                    load={o2dLookups.skus}
                    disabled={ro}
                    placeholder="Search SKU"
                    exactMatch={(o, typed) => o.sku_code.toUpperCase() === typed.toUpperCase()}
                    onSelect={(o) =>
                      update(
                        o
                          ? {
                              sku_code: o.sku_code,
                              catalogue_name: o.catalogue_name || '',
                              image_url: o.image_url,
                              image_url_view: o.image_url_view,
                              ...(UNITS.includes(o.unit) && { unit: o.unit }),
                            }
                          : { sku_code: '', catalogue_name: '', image_url: null, image_url_view: null }
                      )
                    }
                    renderOption={(o) => (
                      <span className="apicker__opt">
                        <strong>{o.sku_code}</strong>
                        <small>{o.catalogue_name || 'No catalogue'} · stock {Number(o.stock_qty).toLocaleString('en-IN')} {o.unit}</small>
                      </span>
                    )}
                  />
                ),
              },
              {
                key: 'image',
                label: 'Image',
                type: 'custom',
                width: 64,
                render: (row) => {
                  const url = row.image_url_view || row.image_url;
                  return (
                    <ImageThumb
                      url={url}
                      size={38}
                      alt={row.sku_code}
                      onClick={url ? () => setPreview({ url, title: row.sku_code, subtitle: row.catalogue_name }) : undefined}
                    />
                  );
                },
              },
              { key: 'catalogue_name', label: 'Catalogue Name', type: 'custom', width: 200, render: (row) => <span className="cell-sub">{row.catalogue_name || '—'}</span> },
              { key: 'qty', label: 'Qty *', type: 'number', width: 100 },
              { key: 'unit', label: 'Unit *', type: 'custom', width: 100, render: (row, update, ro) => (
                <select className="cell-input" value={row.unit} disabled={ro} onChange={(e) => update({ unit: e.target.value })}>
                  {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              ) },
              { key: 'remark', label: 'Price Remark', type: 'custom', render: (row, update, ro) => (
                <input className="cell-input" value={row.remark ?? ''} maxLength={1000} readOnly={ro} onChange={(e) => update({ remark: e.target.value })} />
              ) },
            ]}
          />
        </FormSection>

        <FormSection id="transport" title="Transport details" subtitle="Applies to the whole order.">
          <div className="form-grid">
            <Select
              label="Priority"
              value={v.priority ?? ''}
              disabled={readOnly}
              hint={v.transport_source === 'CLIENT' ? 'Limits Client’s transporters to this priority' : undefined}
              onChange={(e) => set('priority', e.target.value)}
            >
              <option value="">Any</option>
              {['A', 'B', 'C', 'D', 'E'].map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
            <div className="field">
              <span className="field__label">Transport source</span>
              <div className="segmented segmented--form">
                {[['CLIENT', 'Client’s'], ['OTHER', 'Other']].map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    disabled={readOnly}
                    className={v.transport_source === k ? 'is-active' : ''}
                    onClick={() => setV((s) => ({ ...s, transport_source: k, transport_ref: null, transport_name: '' }))}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="field form-grid__full">
              <span className="field__label">Transport Name</span>
              {v.transport_source === 'CLIENT' ? (
                <Select
                  value={v.transport_ref ?? ''}
                  disabled={readOnly || !client}
                  hint={!client ? 'Select a client first' : offered.length === 0 ? 'No Cut transporters attached to this client at this priority — use “Other”' : undefined}
                  onChange={(e) => pickTransport(offered.find((t) => t.id === e.target.value) || null)}
                >
                  <option value="">— Select —</option>
                  {v.transport_ref && !offered.some((t) => t.id === v.transport_ref) && <option value={v.transport_ref}>{v.transport_name}</option>}
                  {offered.map((t) => (
                    <option key={`${t.id}-${t.priority}`} value={t.id}>
                      {t.priority ? `${t.priority} · ` : ''}{t.transport_name} ({t.transport_id}){t.transporter_type ? ` · ${t.transporter_type}` : ''}
                    </option>
                  ))}
                </Select>
              ) : (
                <AsyncPicker
                  text={v.transport_name}
                  load={o2dLookups.transports}
                  disabled={readOnly}
                  placeholder="Search Transport Master"
                  onSelect={pickTransport}
                  renderOption={(o) => (
                    <span className="apicker__opt">
                      <strong>{o.transport_name}</strong>
                      <small>{o.transport_id}{o.transport_city ? ` · ${o.transport_city}` : ''}</small>
                    </span>
                  )}
                />
              )}
            </div>

            <Input label="Mode of Dispatch" value={v.mode_of_dispatch ?? ''} disabled={readOnly} maxLength={60} onChange={(e) => set('mode_of_dispatch', e.target.value)} />
            <Input label="Contact Number" value={v.transport_contact ?? ''} disabled={readOnly} maxLength={20} onChange={(e) => set('transport_contact', e.target.value)} />
            <Input label="Transport City" value={v.transport_city ?? ''} disabled={readOnly} maxLength={80} onChange={(e) => set('transport_city', e.target.value)} />
            <Textarea label="Transport Address" rows={2} value={v.transport_address ?? ''} disabled={readOnly} onChange={(e) => set('transport_address', e.target.value)} />
          </div>
        </FormSection>

        <FormSection id="remarks" title="Remarks">
          <div className="form-grid">
            <Textarea label="Team Remark" hint="Internal only" rows={3} maxLength={2000} value={v.team_remark ?? ''} disabled={readOnly} onChange={(e) => set('team_remark', e.target.value)} />
            <Textarea label="Customer Remark" rows={3} maxLength={2000} value={v.customer_remark ?? ''} disabled={readOnly} onChange={(e) => set('customer_remark', e.target.value)} />
          </div>
        </FormSection>

        {/* Remarks from every stage (the order's own remarks above are the Order Enquiry ones) */}
        {!isNew && <RemarksSection orderId={id} />}

      </div>
      )}
    </Modal>

      <Modal
        open={!!dup}
        size="lg"
        busy={saving}
        title="Possible duplicate order"
        subtitle={`${dup?.duplicates.length || 0} existing Cut order(s) for this client look similar`}
        onClose={() => setDup(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDup(null)} disabled={saving}>Go back</Button>
            {dup?.canOverride && (
              <Button variant="danger" loading={saving} disabled={!overrideReason.trim()} onClick={() => submit(overrideReason.trim())}>
                Continue Anyway
              </Button>
            )}
          </>
        }
      >
        <div className="dup-list">
          {dup?.duplicates.map((d) => (
            <div key={d.id} className="dup-item">
              <div className="dup-item__head">
                <Badge variant={d.match === 'EXACT' ? 'danger' : 'warning'}>{d.match === 'EXACT' ? 'Exact' : 'Potential'}</Badge>
                <strong className="mono">{d.order_no}</strong>
                <span className="cell-sub">{STAGE_LABELS[d.workflow_status] || d.workflow_status} · {new Date(d.created_at).toLocaleDateString('en-IN')}</span>
              </div>
              <p className="cell-sub">{d.reason}{d.client_reference_order ? ` · PO ${d.client_reference_order}` : ''}</p>
              <p className="dup-item__lines">{d.items.map((i) => `${i.sku_code} × ${i.qty} ${i.unit}`).join(' · ')}</p>
            </div>
          ))}
        </div>
        {dup?.canOverride ? (
          <Textarea
            label="Reason to continue"
            required
            rows={2}
            maxLength={1000}
            value={overrideReason}
            hint="Saved in the order's activity log."
            onChange={(e) => setOverrideReason(e.target.value)}
          />
        ) : (
          <p className="form-note form-note--warn">
            <TriangleAlert size={15} /> Only a user with Approve permission on {o2d.label} Orders can continue past this warning.
          </p>
        )}
      </Modal>

      {preview && <Lightbox items={[preview]} index={0} onIndex={() => {}} onClose={() => setPreview(null)} />}
    </>
  );
}
