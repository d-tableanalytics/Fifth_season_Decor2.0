import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin, ScanLine, Navigation, ListChecks, UserCheck, Truck, Camera, Upload, CheckCircle2, LocateFixed } from 'lucide-react';
import api, { getErrorMessage } from '../../api/client';
import { uploadsApi } from '../../api/uploads';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Loader } from '../../components/ui/Loader';
import { Modal } from '../../components/ui/Modal';
import { RemarksSection } from '../../components/o2d/RemarksSection';

const ScanCodeModal = lazy(() => import('../../components/ui/ScanCodeModal').then((m) => ({ default: m.ScanCodeModal })));

const dp = {
  list: (params) => api.get('/dispatch-handover/delivery', { params }).then((r) => r.data.data),
  meta: () => api.get('/dispatch-handover/meta').then((r) => r.data.data),
  byBill: (bill_no) => api.get('/dispatch-handover/delivery/by-bill', { params: { bill_no } }).then((r) => r.data.data),
  get: (id) => api.get(`/dispatch-handover/delivery/${id}`).then((r) => r.data.data),
  items: (id) => api.get(`/dispatch-handover/delivery/${id}/items`).then((r) => r.data.data),
  geocode: () => api.post('/dispatch-handover/delivery/geocode', {}, { timeout: 120_000 }).then((r) => r.data),
  customer: (id, body) => api.post(`/dispatch-handover/delivery/${id}/deliver-customer`, body).then((r) => r.data),
  courier: (id, body) => api.post(`/dispatch-handover/delivery/${id}/deliver-courier`, body).then((r) => r.data),
};
const SURAT = [21.1702, 72.8311];
const PALETTE = ['#c09d52', '#2877b8', '#16845c', '#d73535', '#7b4bb8', '#b87919', '#0f8a8a', '#c2417a', '#4a5568', '#5b8c2a'];
const dateFmt = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const stamp = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const short = (s, n = 70) => (s && s.length > n ? `${s.slice(0, n)}…` : s || '—');
const inr = (n) => (n == null ? '—' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);

/** Dispatch › Delivery Planning & Entry: warehouse-pickup bills on a map; close each as delivered. */
export default function DeliveryPlanning() {
  const { can } = useAuth();
  const toast = useToast();
  const canEdit = can('dispatch_pending', 'edit');
  const [zones, setZones] = useState([]);
  const [zone, setZone] = useState('');
  const [status, setStatus] = useState('pending');
  const [driver, setDriver] = useState('');
  const [rows, setRows] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const mapEl = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);

  const load = useCallback(() => dp.list({ zone: zone || undefined, status }).then(setRows).catch((err) => {
    toast.error('Could not load deliveries', getErrorMessage(err));
    setRows([]);
  }), [zone, status, toast]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    dp.meta().then((m) => setZones(m.zones)).catch(() => {});
  }, []);

  const drivers = useMemo(() => [...new Set((rows || []).map((r) => r.pickup_party_name).filter(Boolean))].sort(), [rows]);
  const colorOf = useMemo(() => Object.fromEntries(drivers.map((d, i) => [d, PALETTE[i % PALETTE.length]])), [drivers]);
  const shown = (rows || []).filter((r) => !driver || r.pickup_party_name === driver);
  const missing = (rows || []).filter((r) => r.map_lat == null && r.address).length;

  // Map: created once; pins redrawn when the visible list changes
  useEffect(() => {
    if (!mapEl.current || map.current) return;
    map.current = L.map(mapEl.current, { scrollWheelZoom: false }).setView(SURAT, 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    if (!layer.current) return;
    layer.current.clearLayers();
    const pts = [];
    for (const r of shown) {
      if (r.map_lat == null || r.map_lng == null) continue;
      const m = L.circleMarker([r.map_lat, r.map_lng], { radius: 8, color: '#fff', weight: 2, fillColor: r.status === 'Delivered' ? '#16845c' : colorOf[r.pickup_party_name] || '#c09d52', fillOpacity: 0.95 });
      m.bindTooltip(`${r.company_name || r.bill_no} · ${r.pickup_party_name}`);
      m.on('click', () => setOpenId(r.id));
      m.addTo(layer.current);
      pts.push([r.map_lat, r.map_lng]);
    }
    if (pts.length) map.current.fitBounds(pts, { padding: [30, 30], maxZoom: 14 });
  }, [shown, colorOf]);

  const geocode = async () => {
    setBusy(true);
    try {
      const r = await dp.geocode();
      toast.success(r.message);
      load();
    } catch (err) {
      toast.error('Could not locate addresses', getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const openBill = async (bill) => {
    try {
      const e = await dp.byBill(bill);
      setOpenId(e.id);
    } catch (err) {
      toast.error('Not found', getErrorMessage(err));
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2 className="page-header__title">Delivery Planning &amp; Entry</h2>
          <p className="page-header__sub">Dispatch › Warehouse-pickup bills by driver · close each one when delivered</p>
        </div>
        <div className="toolbar__actions">
          <Button variant="secondary" icon={ScanLine} onClick={() => setScanning(true)}>Scan Bill No</Button>
          {canEdit && missing > 0 && <Button variant="secondary" icon={LocateFixed} loading={busy} onClick={geocode}>Geocode {missing} missing</Button>}
        </div>
      </div>

      <div className="dp-filters">
        <select className="toolbar__select" value={zone} onChange={(e) => setZone(e.target.value)} aria-label="Zone">
          <option value="">All zones</option>
          {zones.map((z) => <option key={z}>{z}</option>)}
        </select>
        <select className="toolbar__select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="pending">Pending delivery</option>
          <option value="delivered">Delivered</option>
          <option value="all">All</option>
        </select>
        <div className="chip-select">
          {drivers.map((d) => (
            <button key={d} type="button" className={`chip-select__chip ${driver === d ? 'is-on' : ''}`} onClick={() => setDriver((x) => (x === d ? '' : d))}>
              <span className="dp-dot" style={{ background: colorOf[d] }} /> {d}
            </button>
          ))}
        </div>
      </div>

      <div className="dp-layout">
        <div className="dp-map" ref={mapEl} />
        <div className="dp-cards">
          {rows == null ? (
            <Loader label="Loading…" />
          ) : shown.length ? (
            shown.map((r) => (
              <button key={r.id} type="button" className="dp-card" onClick={() => setOpenId(r.id)}>
                <div className="dp-card__head">
                  <strong>{r.company_name || `Bill ${r.bill_no}`}</strong>
                  {r.status === 'Delivered' ? <Badge size="sm" variant="success">Delivered</Badge> : <Badge size="sm" variant={r.badge === 'LOCAL' ? 'info' : 'brand'}>{r.badge}</Badge>}
                </div>
                <div className="cell-sub"><span className="mono mono--plain">{r.bill_no}</span> · {dateFmt(r.entry_date)} · {r.parcel_count} parcel(s)</div>
                <div className="dp-card__driver"><span className="dp-dot" style={{ background: colorOf[r.pickup_party_name] }} /> {r.pickup_party_name} · {r.phone}</div>
                <div className="cell-sub"><MapPin size={12} /> {short(r.address)}{r.map_lat == null && r.address ? ' (not on map)' : ''}</div>
              </button>
            ))
          ) : (
            <p className="cell-sub dp-empty">No {status === 'pending' ? 'pending deliveries' : status === 'delivered' ? 'delivered bills' : 'bills'} here.</p>
          )}
        </div>
      </div>

      {scanning && (
        <Suspense fallback={<Loader fullscreen label="Opening camera…" />}>
          <ScanCodeModal title="Scan Bill No" onClose={() => setScanning(false)} onScan={(t) => { setScanning(false); openBill(t); }} />
        </Suspense>
      )}
      {openId && <DeliveryModal id={openId} canEdit={canEdit} onClose={() => setOpenId(null)} onDone={load} />}
    </div>
  );
}

/** Photo proof: file upload or the device camera; uploaded at once, the ref is sent with Confirm. */
function ProofInput({ value, onChange }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState('');
  const pick = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const r = await uploadsApi.image('delivery', file);
      onChange(r.url);
      setPreview(r.viewUrl || URL.createObjectURL(file));
    } catch (err) {
      toast.error('Photo not uploaded', getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="dp-proof">
      <label className="btn btn--secondary btn--sm"><Upload size={14} /> Upload<input type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} /></label>
      <label className="btn btn--secondary btn--sm"><Camera size={14} /> Camera<input type="file" accept="image/*" capture="environment" hidden onChange={(e) => pick(e.target.files?.[0])} /></label>
      {busy && <span className="cell-sub">Uploading…</span>}
      {value && !busy && <span className="cell-sub">Photo attached</span>}
      {preview && <img src={preview} alt="Proof" className="dp-proof__img" />}
    </div>
  );
}

function DeliveryModal({ id, canEdit, onClose, onDone }) {
  const toast = useToast();
  const [e, setE] = useState(null);
  const [items, setItems] = useState(null);
  const [mode, setMode] = useState('CUSTOMER');
  const [f, setF] = useState({ customer_name: '', customer_phone: '', cash_received: '', transport: '', lr_number: '', cash_paid: '', proof_url: '' });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    dp.get(id).then((x) => {
      setE(x);
      setF((s) => ({ ...s, transport: x.linked_transport_name || '' })); // courier pre-filled from the order's own transport
    }).catch((err) => {
      toast.error('Could not open entry', getErrorMessage(err));
      onClose();
    });
  }, [id, toast, onClose]);

  const confirm = async () => {
    setBusy(true);
    try {
      const num = (v) => (v === '' ? null : Number(v));
      const r = mode === 'CUSTOMER'
        ? await dp.customer(id, { customer_name: f.customer_name.trim(), customer_phone: f.customer_phone, cash_received: num(f.cash_received), proof_url: f.proof_url || null })
        : await dp.courier(id, { transport: f.transport.trim(), lr_number: f.lr_number.trim() || null, cash_paid: num(f.cash_paid), proof_url: f.proof_url || null });
      toast.success(r.message, e.bill_no);
      setE(r.data);
      onDone();
    } catch (err) {
      toast.error('Could not mark delivered', getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const delivered = e?.status === 'Delivered';
  const ready = mode === 'CUSTOMER' ? f.customer_name.trim() && /^\d{10}$/.test(f.customer_phone) : f.transport.trim();
  const navUrl = e?.map_lat != null ? `https://www.google.com/maps/dir/?api=1&destination=${e.map_lat},${e.map_lng}` : null;

  return (
    <Modal
      open
      size="lg"
      busy={busy}
      onClose={onClose}
      title={e ? `Bill ${e.bill_no}` : 'Delivery'}
      subtitle={e ? `${e.client_id ? `${e.client_id} — ` : ''}${e.company_name || 'Not linked to an order'}` : ''}
      footer={e && canEdit && !delivered && <><Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button><Button icon={CheckCircle2} loading={busy} disabled={!ready} onClick={confirm}>Confirm Delivered</Button></>}
    >
      {!e ? (
        <Loader label="Loading…" />
      ) : (
        <div className="cutting">
          <div className="crm-facts">
            <div><span>Parcels</span><strong>{e.parcel_count}</strong></div>
            <div><span>Person taking</span><strong>{e.person_taking}</strong><small>{e.phone}</small></div>
            <div><span>Driver</span><strong>{e.pickup_party_name}</strong></div>
            <div><span>Drop at</span><strong>{e.linked_transport_name || '—'}</strong></div>
          </div>
          <p className="dp-address"><MapPin size={14} /> {e.address || 'No address'}</p>
          <div className="dp-links">
            {navUrl ? (
              <a className="btn btn--secondary btn--sm" href={navUrl} target="_blank" rel="noreferrer noopener"><Navigation size={14} /> Navigate via Maps</a>
            ) : (
              <Button size="sm" variant="secondary" icon={Navigation} disabled>Navigate via Maps</Button>
            )}
            <Button size="sm" variant="ghost" icon={ListChecks} disabled={!e.linked_order_id} onClick={() => (items ? setItems(null) : dp.items(id).then(setItems))}>
              {items ? 'Hide items' : 'View Items List'}
            </Button>
          </div>
          {items && (
            <ul className="dp-items">
              {items.map((i, k) => <li key={k}><span>{i.item_name}</span><strong>{i.qty} {i.unit}{i.box_count ? ` · ${i.box_count} box` : ''}</strong></li>)}
              {!items.length && <li className="cell-sub">No items</li>}
            </ul>
          )}

          {delivered ? (
            <div className="dp-done">
              <Badge variant="success">Delivered</Badge> {stamp(e.delivered_at)} · {e.delivery_method === 'CUSTOMER' ? 'to the customer' : 'to the courier'}
              {e.delivery_method === 'CUSTOMER' ? (
                <p>{e.customer_name} · {e.customer_phone} · Cash received {inr(e.cash_received_from_customer)}</p>
              ) : (
                <p>{e.transport}{e.lr_number ? ` · LR ${e.lr_number}` : ''} · Cash paid {inr(e.cash_paid_to_transporter)}</p>
              )}
              {e.proof_url_view && <img src={e.proof_url_view} alt="Proof" className="dp-proof__img" />}
            </div>
          ) : canEdit ? (
            <>
              <div className="segmented">
                <button type="button" className={mode === 'CUSTOMER' ? 'is-active' : ''} onClick={() => setMode('CUSTOMER')}><UserCheck size={13} /> Deliver Customer</button>
                <button type="button" className={mode === 'COURIER' ? 'is-active' : ''} onClick={() => setMode('COURIER')}><Truck size={13} /> Deliver Courier</button>
              </div>
              {mode === 'CUSTOMER' ? (
                <div className="handover__grid">
                  <label className="lbl-prop">Customer Name *<input maxLength={160} value={f.customer_name} onChange={(ev) => set('customer_name', ev.target.value)} /></label>
                  <label className="lbl-prop">Customer Number *<input inputMode="numeric" maxLength={10} value={f.customer_phone} onChange={(ev) => set('customer_phone', ev.target.value.replace(/\D/g, '').slice(0, 10))} /></label>
                  <label className="lbl-prop">Cash Received<input type="number" min="0" step="0.01" value={f.cash_received} onChange={(ev) => set('cash_received', ev.target.value)} /></label>
                </div>
              ) : (
                <div className="handover__grid">
                  <label className="lbl-prop">Invoice Number<input value={e.bill_no} readOnly /></label>
                  <label className="lbl-prop">Courier / Transporter *<input maxLength={160} value={f.transport} onChange={(ev) => set('transport', ev.target.value)} /></label>
                  <label className="lbl-prop">LR Number / Tracking ID<input maxLength={60} value={f.lr_number} onChange={(ev) => set('lr_number', ev.target.value)} placeholder="Can be added later" /></label>
                  <label className="lbl-prop">Cash Paid<input type="number" min="0" step="0.01" value={f.cash_paid} onChange={(ev) => set('cash_paid', ev.target.value)} /></label>
                </div>
              )}
              <div className="lbl-prop">{mode === 'CUSTOMER' ? 'Photo Proof (optional)' : 'Receipt Proof (optional)'}<ProofInput value={f.proof_url} onChange={(v) => set('proof_url', v)} /></div>
            </>
          ) : (
            <p className="cell-sub">Not delivered yet.</p>
          )}
          {e.linked_order_id && <RemarksSection orderId={e.linked_order_id} readOnly={!canEdit} />}
        </div>
      )}
    </Modal>
  );
}
