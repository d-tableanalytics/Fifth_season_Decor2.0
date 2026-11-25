import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, Wand2, MapPin, AlertTriangle } from 'lucide-react';
import { clientsApi, OPTIONS, optionLabel, CONFIRMATION_BADGE } from '../../api/masters';
import { useMasterForm } from '../../hooks/useMasterForm';
import { useToast } from '../../context/ToastContext';
import { FormSection } from '../../components/forms/FieldRenderer';
import { RowsEditor } from '../../components/forms/RowsEditor';
import { TransportPicker } from '../../components/forms/TransportPicker';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Loader } from '../../components/ui/Loader';
import { zoneForPin } from '../../api/zones';
import { CLIENT_SECTIONS, CHILD_SECTIONS, EMPTY_CLIENT, clientPayload } from './clientSections';

export default function ClientForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const f = useMasterForm({ id, api: clientsApi, empty: EMPTY_CLIENT, perm: 'client_master', folder: 'clients', listPath: '/client-master', toPayload: clientPayload });
  const { values, ctx, isNew, readOnly } = f;
  const autoZone = useRef(null); // zone last set by PIN auto-fill

  // Zone from the PIN (exact match). Never overwrites a zone the user picked by hand.
  useEffect(() => {
    const pin = String(values.pin || '').trim();
    if (readOnly || !/^\d{6}$/.test(pin)) return;
    let alive = true;
    zoneForPin(pin).then((zone) => {
      if (!alive || !zone) return;
      if (!values.zone || values.zone === autoZone.current) {
        autoZone.current = zone;
        ctx.set('zone', zone);
      }
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values.pin, readOnly]);
  const [suggesting, setSuggesting] = useState(false);

  // Client ID: optional on create (auto-generated), fixed afterwards (it is the sheet sync key)
  const sections = useMemo(
    () =>
      CLIENT_SECTIONS.map((s) => ({
        ...s,
        fields: s.fields.map((fd) =>
          fd.key === 'client_id'
            ? { ...fd, disabled: !isNew, hint: isNew ? 'Leave blank to auto-generate' : 'Client ID cannot be changed' }
            : fd.key === 'visit_no' && isNew
              ? { ...fd, hint: 'Leave blank to auto-generate' }
              : fd
        ),
      })),
    [isNew]
  );

  if (f.loading) return <Loader label="Loading client…" />;

  const onSave = async () => {
    if (!values.company_name?.trim()) return f.showError('company_name', 'Company name is required');
    const saved = await f.save();
    if (!saved) return;
    toast.success(isNew ? 'Client created' : 'Client saved', `${saved.client_id} · ${saved.company_name}`);
    if (isNew) navigate(`/client-master/${saved.id}`, { replace: true });
  };

  const buildAddress = () =>
    ctx.set(
      'full_address',
      [values.plot_no_building_name, values.landmark1, values.landmark2, values.street_road_name, values.city, values.state, values.pin, values.country]
        .filter(Boolean)
        .join(', ')
    );

  const suggestZone = async () => {
    setSuggesting(true);
    try {
      const s = await clientsApi.zoneSuggest({ pin: values.pin || '', state: values.state || '' });
      if (s.zone) {
        ctx.set('zone', s.zone);
        toast.info(`Zone set to ${s.zone}`, `Based on ${s.basis}`);
      } else toast.warning('No suggestion', 'No existing clients with a similar PIN or state have a zone yet.');
    } catch {
      toast.error('Could not suggest a zone');
    } finally {
      setSuggesting(false);
    }
  };

  const priorities = values.transport_priorities || [];
  const unlinked = priorities.filter((p) => p.transport_code && !p.transport_ref).length;

  return (
    <div className="page page--form">
      <div className="page-header">
        <div>
          <Link to="/client-master" className="back-link">
            <ArrowLeft size={14} /> Client Master
          </Link>
          <h2 className="page-header__title">
            {isNew ? 'New Client' : values.company_name}
            {!isNew && <span className="mono">{values.client_id}</span>}
            {!isNew && <Badge variant={CONFIRMATION_BADGE[values.client_confirmation]}>{optionLabel(values.client_confirmation)}</Badge>}
            {!isNew && !values.is_active && <Badge variant="danger">Inactive</Badge>}
            {readOnly && <Badge variant="neutral">Read only</Badge>}
          </h2>
        </div>
        {!readOnly && (
          <Button icon={Save} loading={f.saving} onClick={onSave}>
            {isNew ? 'Create Client' : 'Save Changes'}
          </Button>
        )}
      </div>

      <div className="form-layout">
        <nav className="form-nav" aria-label="Sections">
          {[...sections, ...CHILD_SECTIONS].map((s) => (
            <a key={s.id} href={`#${s.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>
              {s.title}
              {s.id === 'transport' && priorities.length > 0 && <span className="form-nav__count">{priorities.length}</span>}
            </a>
          ))}
        </nav>

        <div className="form-sections">
          {sections.map((s) => (
            <FormSection
              key={s.id}
              id={s.id}
              title={s.title}
              fields={s.fields}
              ctx={ctx}
              actions={
                s.id === 'address' && !readOnly ? (
                  <div className="form-card__actions">
                    <Button variant="ghost" size="sm" icon={MapPin} loading={suggesting} onClick={suggestZone}>
                      Suggest zone
                    </Button>
                    <Button variant="ghost" size="sm" icon={Wand2} onClick={buildAddress}>
                      Build full address
                    </Button>
                  </div>
                ) : null
              }
            />
          ))}

          <FormSection
            id="transport"
            title="Transport priority"
            subtitle="Which transporter to use for each order type, in order of preference (A = first choice)."
          >
            {unlinked > 0 && (
              <p className="form-note form-note--warn">
                <AlertTriangle size={15} /> {unlinked} row(s) point to a TRN ID that is not in Transport Master. Pick the right transport or add it in Transport Master.
              </p>
            )}
            <RowsEditor
              rows={priorities}
              readOnly={readOnly}
              addLabel="Add transport priority"
              emptyText="No transports assigned to this client yet."
              newRow={{ type_of_order: 'CUT', priority: 'A', transporter_type: null, transport_ref: null }}
              onChange={(rows) => ctx.set('transport_priorities', rows)}
              columns={[
                { key: 'type_of_order', label: 'Order type', type: 'select', options: OPTIONS.type_of_order, width: 130 },
                { key: 'priority', label: 'Priority', type: 'select', options: OPTIONS.priority, width: 90 },
                { key: 'transporter_type', label: 'Transporter type', type: 'select', options: OPTIONS.transporter_type, width: 160 },
                {
                  key: 'transport',
                  label: 'Transport',
                  type: 'custom',
                  render: (row, update, ro) => (
                    <TransportPicker
                      disabled={ro}
                      invalidCode={row.transport_code && !row.transport_ref ? row.transport_code : null}
                      value={row.transport_ref ? { id: row.transport_ref, transport_id: row.transport_id, transport_name: row.transport_name } : null}
                      onChange={(t) =>
                        update(
                          t
                            ? { transport_ref: t.id, transport_id: t.transport_id, transport_name: t.transport_name, transport_code: t.transport_id }
                            : { transport_ref: null, transport_id: null, transport_name: null, transport_code: null }
                        )
                      }
                    />
                  ),
                },
              ]}
            />
          </FormSection>

          <FormSection id="referrals" title="Referrals" subtitle="People this client referred to Fifth Season.">
            <RowsEditor
              rows={values.referrals || []}
              readOnly={readOnly}
              addLabel="Add referral"
              emptyText="No referrals."
              onChange={(rows) => ctx.set('referrals', rows)}
              columns={[
                { key: 'name', label: 'Name' },
                { key: 'phone_number', label: 'Phone', width: 140 },
                { key: 'city', label: 'City', width: 140 },
                { key: 'comment', label: 'Comment' },
              ]}
            />
          </FormSection>

          <FormSection id="products" title="Top selling products" subtitle="What sells best at this client's store.">
            <RowsEditor
              rows={values.top_selling_products || []}
              readOnly={readOnly}
              addLabel="Add product"
              emptyText="No products."
              onChange={(rows) => ctx.set('top_selling_products', rows)}
              columns={[
                { key: 'product_ref_id', label: 'Product ref', width: 130 },
                { key: 'product_name', label: 'Product name' },
                { key: 'volume_of_purchase', label: 'Volume', type: 'number', width: 110 },
                { key: 'price_per_unit', label: 'Price / unit (₹)', type: 'number', width: 130 },
              ]}
            />
          </FormSection>

          {!readOnly && (
            <div className="form-footer">
              <Button variant="secondary" onClick={() => navigate('/client-master')}>
                Cancel
              </Button>
              <Button icon={Save} loading={f.saving} onClick={onSave}>
                {isNew ? 'Create Client' : 'Save Changes'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
