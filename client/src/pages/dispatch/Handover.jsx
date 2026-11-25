import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, ScanLine, Keyboard, Plus, Trash2, Save, Settings2, Pencil, Search, Truck, CheckCircle2, XCircle } from 'lucide-react';
import api, { getErrorMessage } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useDebounce } from '../../hooks/useDebounce';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Skeleton, Loader } from '../../components/ui/Loader';
import { Modal } from '../../components/ui/Modal';
import { Pagination } from '../../components/ui/FormControls';
import { AsyncPicker } from '../../components/forms/AsyncPicker';

const ScanCodeModal = lazy(() => import('../../components/ui/ScanCodeModal').then((m) => ({ default: m.ScanCodeModal })));

const ho = {
  meta: () => api.get('/dispatch-handover/meta').then((r) => r.data.data),
  saveMeta: (body) => api.put('/dispatch-handover/meta', body).then((r) => r.data),
  transporters: (search) => api.get('/dispatch-handover/transporters', { params: { search } }).then((r) => r.data.data),
  linkable: (params) => api.get('/dispatch-handover/linkable-orders', { params }).then((r) => r.data.data),
  pending: () => api.get('/dispatch-handover/pending').then((r) => r.data.data),
  entries: (params) => api.get('/dispatch-handover/entries', { params }).then((r) => r.data),
  saveBatch: (rows) => api.post('/dispatch-handover/entries/batch', { rows }).then((r) => r.data),
  update: (id, body) => api.put(`/dispatch-handover/entries/${id}`, body).then((r) => r.data),
};
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const dateFmt = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const stamp = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const digits10 = (v) => String(v || '').replace(/\D/g, '').slice(-10);
const TABS = [
  { key: 'new', label: 'New Handover' },
  { key: 'pending', label: 'Pending' },
  { key: 'log', label: 'Dispatch Log' },
];

/** Dispatch › Handover: log the bills physically handed over (never changes an order's status). */
export default function Handover() {
  const { can } = useAuth();
  const toast = useToast();
  const canEdit = can('dispatch_pending', 'edit');
  const [tab, setTab] = useState(canEdit ? 'new' : 'pending');
  const [meta, setMeta] = useState(null);
  const [listsOpen, setListsOpen] = useState(false);

  const loadMeta = useCallback(() => ho.meta().then(setMeta).catch((err) => toast.error('Could not load', getErrorMessage(err))), [toast]);
  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2 className="page-header__title">Dispatch Handover</h2>
          <p className="page-header__sub">Dispatch › Bills physically handed over to a driver or transporter</p>
        </div>
        {canEdit && <Button variant="secondary" icon={Settings2} onClick={() => setListsOpen(true)}>Handover By &amp; Drivers</Button>}
      </div>

      <div className="stage-tabs" role="tablist" aria-label="Handover">
        {TABS.filter((t) => t.key !== 'new' || canEdit).map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} className={`stage-tab ${tab === t.key ? 'is-active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {!meta ? <Loader label="Loading…" /> : tab === 'new' ? <NewHandover meta={meta} /> : tab === 'pending' ? <PendingTab /> : <LogTab meta={meta} canEdit={canEdit} />}

      {listsOpen && meta && <ListsModal meta={meta} onClose={() => setListsOpen(false)} onSaved={(m) => { setMeta(m); setListsOpen(false); }} />}
    </div>
  );
}

/* ---------------- New Handover ---------------- */

function NewHandover({ meta }) {
  const toast = useToast();
  const [h, setH] = useState({ entry_date: today(), handover_by: '', warehouse_pickup: false, zone: '', party: null, person_taking: '', phone: '' });
  const [mode, setMode] = useState('SCAN');
  const [entry, setEntry] = useState({ bill_no: '', source: 'MANUAL', parcel_count: '1', linked_order_id: '' });
  const [queue, setQueue] = useState([]);
  const [linkable, setLinkable] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState(null);

  const set = (k, v) => setH((x) => ({ ...x, [k]: v }));
  const detailsOk = h.entry_date && h.handover_by && h.party?.name && h.person_taking.trim() && /^\d{10}$/.test(h.phone);

  // Order picker: warehouse pickup -> only that zone (hidden until a zone is picked); otherwise all zones
  useEffect(() => {
    if (h.warehouse_pickup && !h.zone) return setLinkable([]);
    ho.linkable({ warehousePickup: h.warehouse_pickup, zone: h.warehouse_pickup ? h.zone : undefined }).then(setLinkable).catch(() => setLinkable([]));
  }, [h.warehouse_pickup, h.zone, results]);
  const offered = useMemo(() => linkable.filter((o) => !queue.some((q) => q.linked_order_id === o.id)), [linkable, queue]);

  const pickDriver = (id) => {
    const d = meta.drivers.find((x) => String(x.id) === id);
    setH((x) => ({ ...x, party: d ? { type: 'DRIVER', name: d.name, ref: String(d.id) } : null, person_taking: d ? d.name : x.person_taking, phone: d?.phone || x.phone }));
  };
  const pickTransporter = (t) =>
    setH((x) => ({
      ...x,
      party: { type: 'TRANSPORTER', name: t.transport_name, ref: t.transport_id },
      person_taking: t.transport_contact_person || x.person_taking,
      phone: digits10(t.transport_contact_number) || x.phone,
    }));

  const add = () => {
    const bill = entry.bill_no.trim();
    if (!detailsOk) return toast.info('Fill the Handover Details first');
    if (!bill) return toast.info('Scan or type the Bill No');
    if (!(Number(entry.parcel_count) >= 1)) return toast.info('Parcels must be at least 1');
    if (queue.some((q) => q.bill_no.toUpperCase() === bill.toUpperCase())) return toast.info(`Bill ${bill} is already in the queue`);
    const order = linkable.find((o) => o.id === entry.linked_order_id);
    setQueue((q) => [...q, { key: `${Date.now()}`, bill_no: bill, parcel_count: Math.round(Number(entry.parcel_count)), source: entry.source, linked_order_id: order?.id || null, order_label: order ? `${order.order_no} · ${order.company_name}` : '' }]);
    setEntry({ bill_no: '', source: 'MANUAL', parcel_count: '1', linked_order_id: '' });
  };

  const save = async () => {
    setBusy(true);
    try {
      const rows = queue.map((q) => ({
        entry_date: h.entry_date,
        handover_by: h.handover_by,
        warehouse_pickup: h.warehouse_pickup,
        zone: h.warehouse_pickup ? h.zone || null : null,
        pickup_party_type: h.party?.type,
        pickup_party_name: h.party?.name,
        pickup_party_ref_id: h.party?.ref || null,
        person_taking: h.person_taking.trim(),
        phone: h.phone,
        bill_no: q.bill_no,
        parcel_count: q.parcel_count,
        source: q.source,
        linked_order_id: q.linked_order_id,
      }));
      const r = await ho.saveBatch(rows);
      setResults(r.data);
      const ok = new Set(r.data.filter((x) => x.status === 'CREATED' || x.status === 'UPDATED').map((x) => x.bill_no));
      setQueue((qq) => qq.filter((q) => !ok.has(q.bill_no))); // keep failed rows to fix and retry
      (ok.size === r.data.length ? toast.success : toast.error)(r.message);
    } catch (err) {
      toast.error('Could not save', getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="handover">
      <section className="card handover__card">
        <h4 className="crm-pay__title">Handover Details</h4>
        <div className="handover__grid">
          <label className="lbl-prop">Date *<input type="date" value={h.entry_date} onChange={(e) => set('entry_date', e.target.value)} /></label>
          <label className="lbl-prop">Handover By *
            <select value={h.handover_by} onChange={(e) => set('handover_by', e.target.value)}>
              <option value="">{meta.handover_by.length ? 'Select…' : 'Add names in Handover By & Drivers'}</option>
              {meta.handover_by.map((n) => <option key={n}>{n}</option>)}
            </select>
          </label>
          <div className="lbl-prop">Warehouse Pickup *
            <div className="segmented">
              {[true, false].map((v) => (
                <button key={String(v)} type="button" className={h.warehouse_pickup === v ? 'is-active' : ''} onClick={() => setH((x) => ({ ...x, warehouse_pickup: v, zone: '', party: null, person_taking: '', phone: '' }))}>
                  {v ? 'Yes (driver)' : 'No (transporter)'}
                </button>
              ))}
            </div>
          </div>
          {h.warehouse_pickup && (
            <label className="lbl-prop">Zone *
              <select value={h.zone} onChange={(e) => set('zone', e.target.value)}>
                <option value="">Select zone…</option>
                {meta.zones.map((z) => <option key={z}>{z}</option>)}
              </select>
            </label>
          )}
          {h.warehouse_pickup ? (
            <label className="lbl-prop">Driver *
              <select value={h.party?.ref || ''} onChange={(e) => pickDriver(e.target.value)}>
                <option value="">{meta.drivers.length ? 'Select driver…' : 'Add drivers in Handover By & Drivers'}</option>
                {meta.drivers.map((d) => <option key={d.id} value={d.id}>{d.name}{d.phone ? ` · ${d.phone}` : ''}</option>)}
              </select>
            </label>
          ) : (
            <div className="lbl-prop">Transporter *
              <AsyncPicker
                text={h.party?.name || ''}
                load={ho.transporters}
                placeholder="Search transporter…"
                onSelect={pickTransporter}
                renderOption={(t) => <span className="apicker__opt"><strong>{t.transport_name}</strong><small>{t.transport_id}{t.transport_contact_person ? ` · ${t.transport_contact_person}` : ''}</small></span>}
              />
            </div>
          )}
          <label className="lbl-prop">Person Taking *<input maxLength={120} value={h.person_taking} onChange={(e) => set('person_taking', e.target.value)} /></label>
          <label className="lbl-prop">Phone (10 digits) *<input inputMode="numeric" maxLength={10} value={h.phone} onChange={(e) => set('phone', e.target.value.replace(/\D/g, '').slice(0, 10))} /></label>
        </div>
      </section>

      <section className={`card handover__card ${detailsOk ? '' : 'is-locked'}`}>
        <div className="handover__entry-head">
          <h4 className="crm-pay__title">Add Bills</h4>
          <div className="segmented">
            <button type="button" className={mode === 'SCAN' ? 'is-active' : ''} onClick={() => setMode('SCAN')}><ScanLine size={13} /> Scan</button>
            <button type="button" className={mode === 'MANUAL' ? 'is-active' : ''} onClick={() => setMode('MANUAL')}><Keyboard size={13} /> Manual</button>
          </div>
          {!detailsOk && <span className="cell-sub">Fill the Handover Details to start adding bills.</span>}
        </div>
        <div className="handover__entry">
          <label className="lbl-prop">Bill No *
            <span className="handover__bill">
              <input value={entry.bill_no} maxLength={100} disabled={!detailsOk} readOnly={mode === 'SCAN'} placeholder={mode === 'SCAN' ? 'Press Scan' : 'Type the bill no.'}
                onChange={(e) => setEntry((x) => ({ ...x, bill_no: e.target.value, source: 'MANUAL' }))} />
              {mode === 'SCAN' && <Button size="sm" variant="secondary" icon={ScanLine} disabled={!detailsOk} onClick={() => setScanning(true)}>Scan</Button>}
            </span>
          </label>
          <label className="lbl-prop handover__parcels">Parcels *
            <input type="number" min="1" step="1" disabled={!detailsOk} value={entry.parcel_count} onChange={(e) => setEntry((x) => ({ ...x, parcel_count: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
          </label>
          <label className="lbl-prop">Link order (optional)
            <select disabled={!detailsOk || (h.warehouse_pickup && !h.zone)} value={entry.linked_order_id} onChange={(e) => setEntry((x) => ({ ...x, linked_order_id: e.target.value }))}>
              <option value="">{h.warehouse_pickup && !h.zone ? 'Pick a zone first' : offered.length ? 'Not linked' : 'No dispatched order to link'}</option>
              {offered.map((o) => <option key={o.id} value={o.id}>{o.order_no} · {o.company_name}{o.zone ? ` · ${o.zone}` : ''}{o.challan_no ? ` · ${o.challan_no}` : ''}</option>)}
            </select>
          </label>
          <Button icon={Plus} disabled={!detailsOk} onClick={add}>Add</Button>
        </div>
      </section>

      <section className="card card--flush">
        <div className="toolbar">
          <h4 className="crm-pay__title">Pending Save Queue ({queue.length})</h4>
          <div className="toolbar__actions">
            <Button icon={Save} loading={busy} disabled={busy || !queue.length} onClick={save}>Save {queue.length} to Dispatch Log</Button>
          </div>
        </div>
        <div className="table-wrap table-wrap--flush">
          <table className="table">
            <thead><tr><th>Bill No</th><th className="num">Parcels</th><th>Source</th><th>Linked order</th><th /></tr></thead>
            <tbody>
              {queue.map((q) => (
                <tr key={q.key}>
                  <td className="mono mono--plain">{q.bill_no}</td>
                  <td className="num">{q.parcel_count}</td>
                  <td><Badge size="sm" variant={q.source === 'SCANNED' ? 'info' : 'neutral'}>{q.source === 'SCANNED' ? 'Scanned' : 'Manual'}</Badge></td>
                  <td className="cell-sub">{q.order_label || '—'}</td>
                  <td className="num"><button className="icon-btn icon-btn--sm icon-btn--danger" title="Remove" onClick={() => setQueue((x) => x.filter((y) => y.key !== q.key))}><Trash2 size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!queue.length && <p className="cell-sub handover__empty">Scan or type bills — they wait here until you save.</p>}
        </div>
        {results && (
          <ul className="sync-history">
            {results.map((r, i) => (
              <li key={i}>
                {r.status === 'CREATED' || r.status === 'UPDATED' ? <CheckCircle2 size={15} className="ok" /> : <XCircle size={15} className="bad" />}
                <span className="sync-history__what">{r.bill_no || '—'}{r.error && <small> — {r.error}</small>}</span>
                <span className="sync-history__meta">{r.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {scanning && (
        <Suspense fallback={<Loader fullscreen label="Opening camera…" />}>
          <ScanCodeModal title="Scan Bill No" onClose={() => setScanning(false)} onScan={(t) => { setScanning(false); setEntry((x) => ({ ...x, bill_no: t.slice(0, 100), source: 'SCANNED' })); }} />
        </Suspense>
      )}
    </div>
  );
}

/* ---------------- Pending ---------------- */

function PendingTab() {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  useEffect(() => {
    ho.pending().then(setRows).catch((err) => {
      toast.error('Could not load', getErrorMessage(err));
      setRows([]);
    });
  }, [toast]);
  return (
    <div className="card card--flush">
      <div className="table-wrap table-wrap--flush">
        <table className="table">
          <thead><tr><th>Dispatched</th><th>Order No</th><th>Type</th><th>Client</th><th>Zone</th><th>Challan</th><th>Transport</th></tr></thead>
          <tbody>
            {rows == null
              ? Array.from({ length: 4 }).map((_, i) => <tr key={i}>{Array.from({ length: 7 }).map((__, j) => <td key={j}><Skeleton width={70} /></td>)}</tr>)
              : rows.map((o) => (
                  <tr key={o.id}>
                    <td className="cell-sub">{stamp(o.dispatched_at)}</td>
                    <td className="mono">{o.order_no}</td>
                    <td><Badge size="sm" variant={o.order_type === 'CUT' ? 'info' : 'neutral'}>{o.order_type}</Badge></td>
                    <td className="cell-wrap cell-main"><span className="mono mono--plain">{o.client_id}</span> {o.company_name}</td>
                    <td>{o.zone ? <Badge size="sm" variant="brand">{o.zone}</Badge> : '—'}</td>
                    <td className="mono mono--plain">{o.challan_no || '—'}</td>
                    <td className="cell-sub">{o.transport_name || '—'}</td>
                  </tr>
                ))}
          </tbody>
        </table>
        {rows && !rows.length && (
          <div className="empty empty--inline">
            <span className="empty__icon"><Truck size={22} /></span>
            <h2>Every dispatched order has a handover entry</h2>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Dispatch Log ---------------- */

function LogTab({ meta, canEdit }) {
  const toast = useToast();
  const [searchText, setSearchText] = useState('');
  const search = useDebounce(searchText);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ data: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setResult(await ho.entries({ page, limit: 25, search: search || undefined, from: from || undefined, to: to || undefined }));
    } catch (err) {
      toast.error('Could not load the log', getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [page, search, from, to, toast]);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="card card--flush">
      <div className="toolbar">
        <label className="toolbar__search">
          <Search size={15} />
          <input type="search" placeholder="Bill no., order, driver / transporter…" value={searchText} onChange={(e) => { setSearchText(e.target.value); setPage(1); }} />
        </label>
        <input className="toolbar__select" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} aria-label="From date" />
        <input className="toolbar__select" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} aria-label="To date" />
      </div>
      <div className="table-wrap table-wrap--flush">
        <table className="table">
          <thead>
            <tr><th>Date</th><th>Bill No</th><th className="num">Parcels</th><th>Handover By</th><th>Picked up by</th><th>Person · Phone</th><th>Linked order</th><th>Zone</th><th>Status</th>{canEdit && <th />}</tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 5 }).map((_, i) => <tr key={i}>{Array.from({ length: canEdit ? 10 : 9 }).map((__, j) => <td key={j}><Skeleton width={60} /></td>)}</tr>)
              : result.data.map((e) => (
                  <tr key={e.id}>
                    <td className="cell-sub">{dateFmt(e.entry_date)}</td>
                    <td className="mono mono--plain">{e.bill_no}{e.source === 'SCANNED' && <div><Badge size="sm" variant="info">Scanned</Badge></div>}</td>
                    <td className="num">{e.parcel_count}</td>
                    <td>{e.handover_by}</td>
                    <td className="cell-wrap">{e.pickup_party_name}<div className="cell-sub">{e.pickup_party_type === 'DRIVER' ? 'Driver · warehouse pickup' : 'Transporter'}</div></td>
                    <td className="cell-sub">{e.person_taking}<div>{e.phone}</div></td>
                    <td className="cell-sub">{e.linked_order_no ? <>{e.linked_order_no}<div>{e.linked_challan_no || ''}</div></> : '—'}</td>
                    <td>{e.zone ? <Badge size="sm" variant="brand">{e.zone}</Badge> : '—'}</td>
                    <td><Badge size="sm" variant={e.status === 'Delivered' ? 'success' : 'warning'}>{e.status}</Badge></td>
                    {canEdit && <td className="num"><button className="icon-btn icon-btn--sm" title="Edit" onClick={() => setEditing(e)}><Pencil size={14} /></button></td>}
                  </tr>
                ))}
          </tbody>
        </table>
        {!loading && !result.data.length && (
          <div className="empty empty--inline">
            <span className="empty__icon"><ClipboardCheck size={22} /></span>
            <h2>{search || from || to ? 'No matching entries' : 'No handover saved yet'}</h2>
          </div>
        )}
      </div>
      {result.total > 0 && <Pagination page={page} limit={25} total={result.total} onPage={setPage} />}
      {editing && <EditEntryModal entry={editing} meta={meta} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

/** Edit handover details of a saved entry — order linking is not editable here on purpose. */
function EditEntryModal({ entry, meta, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({
    entry_date: String(entry.entry_date).slice(0, 10),
    handover_by: entry.handover_by,
    pickup_party_type: entry.pickup_party_type,
    pickup_party_name: entry.pickup_party_name,
    person_taking: entry.person_taking,
    phone: entry.phone,
    parcel_count: String(entry.parcel_count),
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    setBusy(true);
    try {
      const r = await ho.update(entry.id, { ...f, parcel_count: Number(f.parcel_count) });
      toast.success(r.message, entry.bill_no);
      onSaved();
    } catch (err) {
      toast.error('Could not update', getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const names = meta.handover_by.includes(f.handover_by) ? meta.handover_by : [f.handover_by, ...meta.handover_by];
  return (
    <Modal open busy={busy} onClose={onClose} title={`Edit bill ${entry.bill_no}`} subtitle={entry.linked_order_no ? `Linked to ${entry.linked_order_no} (not editable)` : 'Not linked to an order'}
      footer={<><Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button><Button icon={Save} loading={busy} onClick={save}>Save</Button></>}>
      <div className="handover__grid">
        <label className="lbl-prop">Date<input type="date" value={f.entry_date} onChange={(e) => set('entry_date', e.target.value)} /></label>
        <label className="lbl-prop">Handover By<select value={f.handover_by} onChange={(e) => set('handover_by', e.target.value)}>{names.map((n) => <option key={n}>{n}</option>)}</select></label>
        <label className="lbl-prop">{f.pickup_party_type === 'DRIVER' ? 'Driver' : 'Transporter'}<input maxLength={160} value={f.pickup_party_name} onChange={(e) => set('pickup_party_name', e.target.value)} /></label>
        <label className="lbl-prop">Person Taking<input maxLength={120} value={f.person_taking} onChange={(e) => set('person_taking', e.target.value)} /></label>
        <label className="lbl-prop">Phone<input inputMode="numeric" maxLength={10} value={f.phone} onChange={(e) => set('phone', e.target.value.replace(/\D/g, '').slice(0, 10))} /></label>
        <label className="lbl-prop">Parcels<input type="number" min="1" step="1" value={f.parcel_count} onChange={(e) => set('parcel_count', e.target.value)} /></label>
      </div>
    </Modal>
  );
}

/** The Handover By names and the warehouse-pickup drivers. */
function ListsModal({ meta, onClose, onSaved }) {
  const toast = useToast();
  const [names, setNames] = useState(meta.handover_by.length ? [...meta.handover_by] : ['']);
  const [drivers, setDrivers] = useState(meta.drivers.length ? meta.drivers.map((d) => ({ name: d.name, phone: d.phone || '' })) : [{ name: '', phone: '' }]);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await ho.saveMeta({ handover_by: names.map((n) => n.trim()).filter(Boolean), drivers: drivers.filter((d) => d.name.trim()).map((d) => ({ name: d.name.trim(), phone: d.phone.trim() || null })) });
      toast.success(r.message);
      onSaved(r.data);
    } catch (err) {
      toast.error('Could not save', getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open size="lg" busy={busy} onClose={onClose} title="Handover By & Drivers"
      footer={<><Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button><Button icon={Save} loading={busy} onClick={save}>Save</Button></>}>
      <div className="handover__lists">
        <div>
          <h4 className="crm-pay__title">Handover By</h4>
          {names.map((n, i) => (
            <div key={i} className="handover__list-row">
              <input value={n} maxLength={120} placeholder="Name" onChange={(e) => setNames((x) => x.map((y, j) => (j === i ? e.target.value : y)))} />
              <button className="icon-btn icon-btn--sm icon-btn--danger" onClick={() => setNames((x) => x.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 size={14} /></button>
            </div>
          ))}
          <Button size="sm" variant="ghost" icon={Plus} onClick={() => setNames((x) => [...x, ''])}>Add name</Button>
        </div>
        <div>
          <h4 className="crm-pay__title">Drivers (warehouse pickup)</h4>
          {drivers.map((d, i) => (
            <div key={i} className="handover__list-row">
              <input value={d.name} maxLength={120} placeholder="Driver name" onChange={(e) => setDrivers((x) => x.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} />
              <input value={d.phone} inputMode="numeric" maxLength={10} placeholder="Phone" onChange={(e) => setDrivers((x) => x.map((y, j) => (j === i ? { ...y, phone: e.target.value.replace(/\D/g, '').slice(0, 10) } : y)))} />
              <button className="icon-btn icon-btn--sm icon-btn--danger" onClick={() => setDrivers((x) => x.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 size={14} /></button>
            </div>
          ))}
          <Button size="sm" variant="ghost" icon={Plus} onClick={() => setDrivers((x) => [...x, { name: '', phone: '' }])}>Add driver</Button>
        </div>
      </div>
    </Modal>
  );
}
