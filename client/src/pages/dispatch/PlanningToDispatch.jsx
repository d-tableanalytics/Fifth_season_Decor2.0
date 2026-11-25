import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Truck, FileText, Send, Printer, ScanLine, CalendarRange } from 'lucide-react';
import api, { getErrorMessage } from '../../api/client';
import { STAGE_LABELS } from '../../api/o2d';
import { labelsApi } from '../../api/labels';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useDebounce } from '../../hooks/useDebounce';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Skeleton, Loader } from '../../components/ui/Loader';
import { Modal } from '../../components/ui/Modal';
import { Pagination } from '../../components/ui/FormControls';
import { RemarksSection } from '../../components/o2d/RemarksSection';

const ScanCodeModal = lazy(() => import('../../components/ui/ScanCodeModal').then((m) => ({ default: m.ScanCodeModal })));

const ptd = {
  list: (params) => api.get('/dispatch-planning', { params }).then((r) => r.data),
  draft: (id) => api.get(`/dispatch-planning/${id}`).then((r) => r.data.data),
  generate: (id, body) => api.post(`/dispatch-planning/${id}/challan`, body).then((r) => r.data),
  dispatch: (id, tally) => api.post(`/dispatch-planning/${id}/dispatch`, { tally_challan_no: tally }).then((r) => r.data),
};
const dateFmt = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const qty = (n) => Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const inr = (n) => `₹${Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const r2 = (n) => Math.round(n * 100) / 100;
const short = (s, n = 40) => (s && s.length > n ? `${s.slice(0, n)}…` : s || '—');

/** Planning to Dispatch: Cut + Roll orders after Packing — Generate Challan, then Dispatch. */
export default function PlanningToDispatch() {
  const { can } = useAuth();
  const toast = useToast();
  const canEdit = can('planning_dispatch', 'edit');
  const navigate = useNavigate();
  const [searchText, setSearchText] = useState('');
  const search = useDebounce(searchText, 350);
  const [zone, setZone] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ data: [], total: 0, zones: [] });
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // { kind: 'challan' | 'dispatch', row }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setResult(await ptd.list({ page, limit: 25, search: search || undefined, zone: zone || undefined }));
    } catch (err) {
      toast.error('Could not load orders', getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [page, search, zone, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const printLabels = async (row) => {
    try {
      const [d, templates] = await Promise.all([ptd.draft(row.id), labelsApi.list('PARCEL')]);
      const t = templates.find((x) => x.is_default) || templates[0];
      if (!t) return toast.info('No Parcel label template', 'Design one in Masters › Label Design › Parcel (Packet Label)');
      if (!d.parcel_ids.length) return toast.info('This order has no parcels');
      window.open(`/labels/print?template=${t.id}&ids=${d.parcel_ids.join(',')}`, '_blank', 'noopener');
    } catch (err) {
      toast.error('Could not open labels', getErrorMessage(err));
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2 className="page-header__title">Planning to Dispatch</h2>
          <p className="page-header__sub">Cut and Roll orders after Packing · Generate Challan, then Dispatch</p>
        </div>
      </div>

      <div className="card card--flush">
        <div className="toolbar">
          <label className="toolbar__search">
            <Search size={15} />
            <input type="search" placeholder="Search order no. or client…" value={searchText} onChange={(e) => { setSearchText(e.target.value); setPage(1); }} />
          </label>
          <select className="toolbar__select" value={zone} onChange={(e) => { setZone(e.target.value); setPage(1); }} aria-label="Zone">
            <option value="">All Zones</option>
            {result.zones.map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
        </div>
        <div className="table-wrap table-wrap--flush">
          <table className="table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Order No</th>
                <th>Type</th>
                <th>Client ID</th>
                <th>Client</th>
                <th>Zone</th>
                <th>Address</th>
                <th>Stage</th>
                <th className="num">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 5 }).map((_, i) => <tr key={i}>{Array.from({ length: 9 }).map((__, j) => <td key={j}><Skeleton width={j === 4 ? 150 : 60} /></td>)}</tr>)
                : result.data.map((o) => (
                    <tr key={o.id}>
                      <td className="cell-sub">{dateFmt(o.entered_at)}</td>
                      <td>
                        <span className="mono">{o.system_order_no || o.enquiry_number}</span>
                        {o.challan_no && <div className="cell-sub mono mono--plain">{o.challan_no}</div>}
                      </td>
                      <td><Badge size="sm" variant={o.order_type === 'CUT' ? 'info' : 'neutral'}>{o.order_type}</Badge></td>
                      <td className="mono mono--plain">{o.client_id}</td>
                      <td className="cell-wrap cell-main">{o.company_name}</td>
                      <td>{o.zone ? <Badge size="sm" variant="brand">{o.zone}</Badge> : <span className="cell-sub">—</span>}</td>
                      <td className="cell-sub" title={o.address || ''}>{short(o.address)}</td>
                      <td><Badge size="sm" variant={o.workflow_status === 'DELIVERY_NOTE_GENERATED' ? 'success' : 'warning'}>{STAGE_LABELS[o.workflow_status]}</Badge></td>
                      <td className="num">
                        <div className="row-actions ptd-actions">
                          {canEdit && o.workflow_status === 'PLANNING_TO_DISPATCH' && (
                            <Button size="sm" icon={FileText} onClick={() => setModal({ kind: 'challan', row: o })}>Generate Challan</Button>
                          )}
                          {o.challan_no && (
                            <a className="btn btn--ghost btn--sm" href={`/dispatch/challan/${o.id}/print`} target="_blank" rel="noreferrer noopener"><FileText size={14} /> View PDF</a>
                          )}
                          {o.workflow_status === 'DELIVERY_NOTE_GENERATED' && (
                            <Button size="sm" variant="ghost" icon={Printer} onClick={() => printLabels(o)}>Packing Label</Button>
                          )}
                          {canEdit && o.workflow_status === 'DELIVERY_NOTE_GENERATED' && (
                            <Button size="sm" icon={Truck} onClick={() => setModal({ kind: 'dispatch', row: o })}>Dispatch</Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
          {!loading && result.data.length === 0 && (
            <div className="empty empty--inline">
              <span className="empty__icon"><CalendarRange size={22} /></span>
              <h2>{search || zone ? 'No matching orders' : 'Nothing to dispatch'}</h2>
              <p>Orders come here from Packing › Move to Planning to Dispatch.</p>
            </div>
          )}
        </div>
        {result.total > 0 && <Pagination page={page} limit={25} total={result.total} onPage={setPage} />}
      </div>

      {modal?.kind === 'challan' && <ChallanModal row={modal.row} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />}
      {modal?.kind === 'dispatch' && <DispatchModal row={modal.row} onClose={() => setModal(null)} onDone={() => { setModal(null); if (can('dispatch_pending', 'edit')) navigate('/dispatch/handover'); else load(); }} />}
    </div>
  );
}

/** Per item: HSN, Rate (required), Discount %, Box count; order: Packed By, Salesman, Tot Parcels. Totals are worked out on the server. */
function ChallanModal({ row, onClose, onDone }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    ptd.draft(row.id).then((x) => {
      setD(x);
      setForm({
        packed_by: '',
        salesman: '',
        tot_parcels: String(Math.max(1, x.parcels || 1)),
        items: Object.fromEntries(x.items.map((i) => [i.item_id, { hsn_code: '', rate: i.suggested_rate != null ? String(i.suggested_rate) : '', discount_pct: '0', box_count: '1' }])),
      });
    }).catch((err) => {
      toast.error('Could not open order', getErrorMessage(err));
      onClose();
    });
  }, [row.id, toast, onClose]);

  const setItem = (id, k, v) => setForm((f) => ({ ...f, items: { ...f.items, [id]: { ...f.items[id], [k]: v } } }));
  const line = (i) => {
    const f = form.items[i.item_id];
    const rate = Number(f.rate) || 0;
    const disc = Math.min(100, Math.max(0, Number(f.discount_pct) || 0));
    return { gross: r2(i.qty * rate), net: r2(i.qty * rate * (1 - disc / 100)) };
  };
  const missingRate = d && form ? d.items.filter((i) => form.items[i.item_id].rate === '') : [];

  const submit = async () => {
    setBusy(true);
    try {
      const r = await ptd.generate(row.id, {
        packed_by: form.packed_by.trim() || null,
        salesman: form.salesman.trim() || null,
        tot_parcels: Number(form.tot_parcels) || 1,
        items: d.items.map((i) => {
          const f = form.items[i.item_id];
          return { item_id: i.item_id, hsn_code: f.hsn_code.trim() || null, rate: Number(f.rate), discount_pct: Number(f.discount_pct) || 0, box_count: Number(f.box_count) || 1 };
        }),
      });
      toast.success(r.message, 'Order moved to Delivery Note Generated');
      onDone();
    } catch (err) {
      toast.error('Could not generate challan', getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const totals = d && form ? d.items.reduce((t, i) => { const l = line(i); return { qty: t.qty + i.qty, gross: t.gross + l.gross, net: t.net + l.net }; }, { qty: 0, gross: 0, net: 0 }) : null;

  return (
    <Modal
      open
      size="xl"
      busy={busy}
      onClose={onClose}
      title={`Generate Challan · ${row.system_order_no || row.enquiry_number}`}
      subtitle={`${row.client_id} — ${row.company_name}`}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button icon={FileText} loading={busy} disabled={!form || missingRate.length > 0} onClick={submit}>Generate Challan</Button>
        </>
      }
    >
      {!d || !form ? (
        <Loader label="Loading…" />
      ) : (
        <div className="cutting">
          {d.challan && <p className="cell-sub">A challan ({d.challan.challan_no}) already exists — it will be reused as it is.</p>}
          <div className="table-wrap cutting__table">
            <table className="table">
              <thead>
                <tr><th>Item</th><th className="num">Qty</th><th>HSN</th><th className="num">Rate *</th><th className="num">Disc %</th><th className="num">Boxes</th><th className="num">Amount</th></tr>
              </thead>
              <tbody>
                {d.items.map((i) => {
                  const f = form.items[i.item_id];
                  const l = line(i);
                  return (
                    <tr key={i.item_id}>
                      <td className="cell-wrap"><strong>{i.line} · {i.item_name}</strong></td>
                      <td className="num">{qty(i.qty)} {i.unit}</td>
                      <td><input className="cut-in cut-in--text ptd-hsn" maxLength={20} value={f.hsn_code} onChange={(e) => setItem(i.item_id, 'hsn_code', e.target.value)} /></td>
                      <td className="num"><input className={`cut-in ${f.rate === '' ? 'is-short' : ''}`} type="number" min="0" step="0.01" value={f.rate} onChange={(e) => setItem(i.item_id, 'rate', e.target.value)} /></td>
                      <td className="num"><input className="cut-in cut-in--pcs" type="number" min="0" max="100" step="0.01" value={f.discount_pct} onChange={(e) => setItem(i.item_id, 'discount_pct', e.target.value)} /></td>
                      <td className="num"><input className="cut-in cut-in--pcs" type="number" min="1" step="1" value={f.box_count} onChange={(e) => setItem(i.item_id, 'box_count', e.target.value)} /></td>
                      <td className="num">{inr(l.net)}{l.gross !== l.net && <div className="cell-sub">of {inr(l.gross)}</div>}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td><strong>Total</strong></td>
                  <td className="num">{qty(totals.qty)}</td>
                  <td colSpan={4} className="num cell-sub">Gross {inr(totals.gross)} · Discount {inr(totals.gross - totals.net)}</td>
                  <td className="num"><strong>{inr(totals.net)}</strong></td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="form-grid">
            <label className="lbl-prop">Packed By<input maxLength={120} value={form.packed_by} onChange={(e) => setForm((f) => ({ ...f, packed_by: e.target.value }))} /></label>
            <label className="lbl-prop">Salesman<input maxLength={120} value={form.salesman} onChange={(e) => setForm((f) => ({ ...f, salesman: e.target.value }))} /></label>
            <label className="lbl-prop">Tot Parcels<input type="number" min="1" step="1" value={form.tot_parcels} onChange={(e) => setForm((f) => ({ ...f, tot_parcels: e.target.value }))} /></label>
          </div>
          <p className="cell-sub">Qty = packed qty. Amounts shown are a preview — the server works out the final totals.</p>
          <RemarksSection orderId={row.id} />
        </div>
      )}
    </Modal>
  );
}

/** Dispatch: optional Tally Delivery Challan No (typed or scanned), saved in the order's history. */
function DispatchModal({ row, onClose, onDone }) {
  const toast = useToast();
  const [tally, setTally] = useState('');
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const r = await ptd.dispatch(row.id, tally.trim() || null);
      toast.success(r.message, row.system_order_no || row.enquiry_number);
      onDone();
    } catch (err) {
      toast.error('Could not dispatch', getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (scanning) {
    return (
      <Suspense fallback={<Loader fullscreen label="Opening camera…" />}>
        <ScanCodeModal title="Scan Tally Delivery Challan No" onClose={() => setScanning(false)} onScan={(t) => { setScanning(false); setTally(t.slice(0, 60)); }} />
      </Suspense>
    );
  }

  return (
    <Modal
      open
      busy={busy}
      onClose={onClose}
      title={`Dispatch · ${row.system_order_no || row.enquiry_number}`}
      subtitle={`${row.challan_no || ''} · ${row.company_name}`}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button icon={Send} loading={busy} onClick={submit}>Dispatch</Button>
        </>
      }
    >
      <div className="dn-lr">
        <label className="lbl-prop">
          Tally Delivery Challan No (optional)
          <input value={tally} maxLength={60} onChange={(e) => setTally(e.target.value)} />
        </label>
        <Button size="sm" variant="secondary" icon={ScanLine} onClick={() => setScanning(true)}>Scan</Button>
      </div>
      <RemarksSection orderId={row.id} />
    </Modal>
  );
}
