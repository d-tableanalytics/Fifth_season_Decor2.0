import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save } from 'lucide-react';
import { transportsApi, OPTIONS, optionLabel } from '../../api/masters';
import { useMasterForm } from '../../hooks/useMasterForm';
import { useToast } from '../../context/ToastContext';
import { FormSection } from '../../components/forms/FieldRenderer';
import { RowsEditor } from '../../components/forms/RowsEditor';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Loader } from '../../components/ui/Loader';
import { ZONES, zoneForPin } from '../../api/zones';

const t = (key, label, extra = {}) => ({ key, label, type: 'text', ...extra });

const SECTIONS = [
  {
    id: 'basic',
    title: 'Transporter',
    fields: [
      t('transport_name', 'Transport name', { required: true, full: true, max: 160 }),
      { key: 'transport_type', label: 'Transport type', type: 'select', options: OPTIONS.transport_type },
      t('transport_contact_person', 'Contact person', { max: 120 }),
      t('transport_contact_number', 'Contact number', { max: 20 }),
      t('gstin', 'GSTIN', { max: 15, upper: true }),
      t('tracking_url', 'Tracking URL', { max: 500 }),
      t('approx_delivery_time', 'Approx. delivery time', { max: 60, placeholder: 'e.g. 3-5 Days' }),
      t('area', 'Area', { max: 120 }),
      { key: 'is_active', label: 'Status', type: 'switch', on: 'Active', off: 'Inactive' },
    ],
  },
  {
    id: 'address',
    title: 'Booking office (from)',
    fields: [
      t('transport_address', 'Address', { max: 255, full: true }),
      t('transport_city', 'City', { max: 80 }),
      t('transport_state', 'State', { max: 80 }),
      t('transport_country', 'Country', { max: 80 }),
      t('transport_pin', 'PIN', { max: 10 }),
      { key: 'zone', label: 'Zone', type: 'select', options: ZONES, raw: true, hint: 'Auto-filled from the PIN when it is mapped' },
      { key: 'transport_latitude', label: 'Latitude', type: 'number' },
      { key: 'transport_longitude', label: 'Longitude', type: 'number' },
      { key: 'transport_full_address', label: 'Full address', type: 'textarea' },
    ],
  },
  {
    id: 'to',
    title: 'Main destination (to)',
    fields: [
      t('to_contact_person', 'Contact person', { max: 120 }),
      t('to_transport_contact_number', 'Contact number', { max: 20 }),
      t('to_transport_gst', 'GST', { max: 15, upper: true }),
      t('to_transport_city', 'City', { max: 80 }),
      t('to_transport_state', 'State', { max: 80 }),
      t('to_transport_country', 'Country', { max: 80 }),
      t('to_transport_pin', 'PIN', { max: 10 }),
      { key: 'to_transport_full_address', label: 'Full address', type: 'textarea' },
    ],
  },
  {
    id: 'photo',
    title: 'Visiting card',
    fields: [{ key: 'transport_vcard_photo', label: 'Visiting card photo', type: 'image' }],
  },
];

const ALL_KEYS = SECTIONS.flatMap((s) => s.fields.map((f) => f.key));
const EMPTY = { ...Object.fromEntries(ALL_KEYS.map((k) => [k, null])), transport_country: 'India', to_transport_country: 'India', is_active: true, to_destinations: [] };

const toPayload = (v) => ({
  ...Object.fromEntries(ALL_KEYS.map((k) => [k, v[k] === '' ? null : v[k]])),
  to_destinations: (v.to_destinations || [])
    .map(({ city, state, country, pin, contact_person, contact_number, gst, full_address }) => ({ city, state, country, pin, contact_person, contact_number, gst, full_address }))
    .filter((d) => Object.values(d).some((x) => x && String(x).trim())),
});

export default function TransportForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const f = useMasterForm({ id, api: transportsApi, empty: EMPTY, perm: 'transport_master', folder: 'transports', listPath: '/transport-master', toPayload });
  const { values, ctx, isNew, readOnly } = f;

  // Zone from the transporter's own PIN (exact match). Overwrites the field whenever the PIN is mapped.
  useEffect(() => {
    const pin = String(values.transport_pin || '').trim();
    if (readOnly || !/^\d{6}$/.test(pin)) return;
    let alive = true;
    zoneForPin(pin).then((zone) => alive && zone && ctx.set('zone', zone));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values.transport_pin, readOnly]);

  if (f.loading) return <Loader label="Loading transport…" />;

  const onSave = async () => {
    if (!values.transport_name?.trim()) return f.showError('transport_name', 'Transport name is required');
    const saved = await f.save();
    if (!saved) return;
    toast.success(isNew ? 'Transport created' : 'Transport saved', `${saved.transport_id} · ${saved.transport_name}`);
    if (isNew) navigate(`/transport-master/${saved.id}`, { replace: true });
  };

  return (
    <div className="page page--form">
      <div className="page-header">
        <div>
          <Link to="/transport-master" className="back-link">
            <ArrowLeft size={14} /> Transport Master
          </Link>
          <h2 className="page-header__title">
            {isNew ? 'New Transport' : values.transport_name}
            {!isNew && <span className="mono">{values.transport_id}</span>}
            {!isNew && values.transport_type && <Badge variant="info">{optionLabel(values.transport_type)}</Badge>}
            {!isNew && !values.is_active && <Badge variant="danger">Inactive</Badge>}
            {readOnly && <Badge variant="neutral">Read only</Badge>}
          </h2>
          {isNew && <p className="page-header__sub">A TRN ID is assigned automatically when you save.</p>}
        </div>
        {!readOnly && (
          <Button icon={Save} loading={f.saving} onClick={onSave}>
            {isNew ? 'Create Transport' : 'Save Changes'}
          </Button>
        )}
      </div>

      <div className="form-layout">
        <nav className="form-nav" aria-label="Sections">
          {[...SECTIONS, { id: 'destinations', title: 'Other destinations' }, ...(isNew ? [] : [{ id: 'clients', title: 'Used by clients' }])].map((s) => (
            <a key={s.id} href={`#${s.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>
              {s.title}
              {s.id === 'destinations' && values.to_destinations?.length > 0 && <span className="form-nav__count">{values.to_destinations.length}</span>}
              {s.id === 'clients' && values.clients?.length > 0 && <span className="form-nav__count">{values.client_count}</span>}
            </a>
          ))}
        </nav>

        <div className="form-sections">
          {SECTIONS.map((s) => (
            <FormSection key={s.id} id={s.id} title={s.title} fields={s.fields} ctx={ctx} />
          ))}

          <FormSection id="destinations" title="Other destinations" subtitle="Cities this transporter delivers to, with the local contact at each.">
            <RowsEditor
              rows={values.to_destinations || []}
              readOnly={readOnly}
              addLabel="Add destination"
              emptyText="No extra destinations."
              onChange={(rows) => ctx.set('to_destinations', rows)}
              columns={[
                { key: 'city', label: 'City', width: 150 },
                { key: 'state', label: 'State', width: 150 },
                { key: 'pin', label: 'PIN', width: 90 },
                { key: 'contact_person', label: 'Contact person' },
                { key: 'contact_number', label: 'Contact no.', width: 130 },
                { key: 'gst', label: 'GST', width: 150 },
              ]}
            />
          </FormSection>

          {!isNew && (
            <FormSection
              id="clients"
              title="Used by clients"
              subtitle={values.client_count ? `${values.client_count} client(s) have this transport in their transport priority.` : 'No client uses this transport yet.'}
            >
              {values.clients?.length > 0 && (
                <div className="client-links">
                  {values.clients.map((c) => (
                    <Link key={c.id} to={`/client-master/${c.id}`} className="client-link">
                      <span className="mono">{c.client_id}</span>
                      <span className="client-link__name">{c.company_name}</span>
                      <span className="cell-sub">
                        {c.city || ''}
                        {c.order_types?.length ? ` · ${c.order_types.map(optionLabel).join(', ')}` : ''}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </FormSection>
          )}

          {!readOnly && (
            <div className="form-footer">
              <Button variant="secondary" onClick={() => navigate('/transport-master')}>
                Cancel
              </Button>
              <Button icon={Save} loading={f.saving} onClick={onSave}>
                {isNew ? 'Create Transport' : 'Save Changes'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
