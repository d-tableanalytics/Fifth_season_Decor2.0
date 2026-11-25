import { useCallback, useEffect, useState } from 'react';
import { PackagePlus, CheckCircle2, Undo2, Truck, Printer, Eye } from 'lucide-react';

import { labelsApi } from '../../api/labels';
import { getErrorMessage } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Loader } from '../../components/ui/Loader';
import { Modal } from '../../components/ui/Modal';
import { Textarea } from '../../components/ui/FormControls';
import { PACK_STATUS } from './PackingQueue';
import { useO2D } from '../../context/O2DContext';
import { RemarksSection } from '../../components/o2d/RemarksSection';

const qty = (n) => Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const stamp = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const ITEM_STATUS = {
  NOT_PICKED: { label: 'Not picked', variant: 'neutral' },
  PICKED: { label: 'Picked', variant: 'info' },
  PARTIALLY_PACKED: { label: 'Partially packed', variant: 'warning' },
  FULLY_PACKED: { label: 'Fully packed', variant: 'success' },
};
const TEMPLATE_KEY = 'fsd.parcelLabelTemplate';
const readTemplate = () => {
  try {
    return localStorage.getItem(TEMPLATE_KEY) || '';
  } catch {
    return '';
  }
};
const uuid = () =>
  crypto.randomUUID?.() ||
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => ((Math.random() * 16) | (c === 'x' ? 0 : 8)).toString(16));

/** O2D › Packing › Pack Order: build parcels one at a time, print parcel stickers, complete packing. */
export function PackOrderModal({ id, highlight, onClose, onChanged }) {
  const o2d = useO2D();
  const { can } = useAuth();
  const toast = useToast();
  const canEdit = can(o2d.perm, 'edit');
  const [d, setD] = useState(null);
  const [sel, setSel] = useState({}); // item_id -> { qty, pcs }
  const [remarks, setRemarks] = useState('');
  const [requestId, setRequestId] = useState(uuid);
  const [errors, setErrors] = useState([]);
  const [busy, setBusy] = useState('');
  const [back, setBack] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState(readTemplate);

  const load = useCallback(
    () => o2d.apis.packing.get(id).then(setD).catch((err) => {
      toast.error('Could not open order', getErrorMessage(err));
      onClose();
    }),
    [id, toast, onClose]
  );
  useEffect(() => {
    load();
    labelsApi.list('PARCEL').then((list) => {
      setTemplates(list);
      // last used in this browser, else the stage default
      setTemplateId((cur) => (list.some((t) => String(t.id) === String(cur)) ? cur : String(list.find((t) => t.is_default)?.id || list[0]?.id || '')));
    }).catch(() => {});
  }, [load]);

  const pickTemplate = (v) => {
    setTemplateId(v);
    try {
      localStorage.setItem(TEMPLATE_KEY, v);
    } catch {
      /* per-browser convenience only */
    }
  };
  const printStickers = (parcelIds) => {
    if (!templateId) return toast.info('No Parcel label template', 'Design one in Masters › Label Design › Parcel (Packet Label)');
    window.open(`/labels/print?template=${templateId}&ids=${parcelIds.join(',')}`, '_blank', 'noopener');
  };

  const toggle = (it) =>
    setSel((s) => {
      const n = { ...s };
      if (n[it.id]) delete n[it.id];
      else n[it.id] = { qty: String(it.remaining), pcs: '1' };
      return n;
    });
  const setField = (itemId, k, v) => setSel((s) => ({ ...s, [itemId]: { ...s[itemId], [k]: v } }));

  const run = async (key, fn) => {
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      const data = err.response?.data;
      if (data?.errors) setErrors(data.errors);
      toast.error('Something went wrong', getErrorMessage(err));
    } finally {
      setBusy('');
    }
  };

  const createParcel = () =>
    run('parcel', async () => {
      setErrors([]);
      const items = Object.entries(sel).map(([item_id, v]) => ({ item_id, qty: Number(v.qty), pcs: Math.max(1, Math.round(Number(v.pcs) || 1)) }));
      const r = await o2d.apis.packing.createParcel(id, { request_id: requestId, remarks: remarks.trim() || null, items });
      toast.success(r.message);
      setD(r.data.order);
      setSel({});
      setRemarks('');
      setRequestId(uuid()); // next parcel = new request
      onChanged();
    });
  const complete = () => run('done', async () => { const r = await o2d.apis.packing.complete(id); setD(r.data); toast.success(r.message); onChanged(); });
  const toPlanning = () => run('plan', async () => { const r = await o2d.apis.packing.moveToPlanning(id); toast.success(r.message); onChanged(); onClose(); });
  const sendBack = () => run('back', async () => { const r = await o2d.apis.packing.sendBack(id, back.trim()); toast.success(r.message); onChanged(); onClose(); });

  if (back != null) {
    return (
      <Modal open busy={busy === 'back'} onClose={() => setBack(null)} title="Send back to Delivery Note" subtitle={d?.system_order_no}
        footer={<><Button variant="secondary" onClick={() => setBack(null)}>Cancel</Button><Button variant="danger" loading={busy === 'back'} disabled={!back.trim()} onClick={sendBack}>Send Back</Button></>}>
        <Textarea label="Reason" required rows={3} maxLength={1000} value={back} onChange={(e) => setBack(e.target.value)} />
      </Modal>
    );
  }

  const atPacking = d?.workflow_status === 'PACKING';
  const editable = canEdit && atPacking;
  const selCount = Object.keys(sel).length;
  const short = d ? d.items.filter((i) => i.remaining > 0) : [];

  return (
    <Modal
      open
      size="xl"
      busy={!!busy}
      onClose={onClose}
      title={d ? `${d.system_order_no || d.enquiry_number} · Pack Order` : 'Pack Order'}
      subtitle={d ? `${d.client_id} — ${d.company_name}${d.delivery_note_no ? ` · ${d.delivery_note_no}` : ''}${d.transport_name ? ` · ${d.transport_name}` : ''}` : ''}
      footer={
        d && canEdit && (
          <div className="picking-foot">
            <div className="picking-foot__left">
              {atPacking && <Button variant="ghost" icon={Undo2} disabled={!!busy} onClick={() => setBack('')}>Send Back</Button>}
            </div>
            <div className="picking-foot__right">
              {atPacking ? (
                <span title={short.length ? `Still to pack: ${short.map((i) => `${i.line} (${qty(i.remaining)})`).join(', ')}` : ''}>
                  <Button icon={CheckCircle2} loading={busy === 'done'} disabled={!!busy || short.length > 0} onClick={complete}>Packing Complete</Button>
                </span>
              ) : (
                <Button icon={Truck} loading={busy === 'plan'} disabled={!!busy} onClick={toPlanning}>Move to Planning to Dispatch</Button>
              )}
            </div>
          </div>
        )
      }
    >
      {!d ? (
        <Loader label="Loading…" />
      ) : (
        <div className="cutting">
          <div className="pack-head">
            <Badge variant={PACK_STATUS[d.packing_status].variant}>{PACK_STATUS[d.packing_status].label}</Badge>
            {!atPacking && <Badge variant="success">Packing Completed</Badge>}
            <span className="cell-sub">{d.parcels.length} parcel(s)</span>
          </div>

          {errors.length > 0 && <ul className="cutting__errors">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}

          <div className="table-wrap cutting__table">
            <table className="table">
              <thead>
                <tr>
                  {editable && <th />}
                  <th>Item</th>
                  <th className="num">Ordered</th>
                  <th className="num">Picked</th>
                  <th className="num">Packed</th>
                  <th className="num">Remaining</th>
                  <th>Status</th>
                  {editable && <th className="num">Qty in parcel</th>}
                  {editable && <th className="num">Pcs</th>}
                </tr>
              </thead>
              <tbody>
                {d.items.map((it) => {
                  const on = !!sel[it.id];
                  const full = it.remaining <= 0;
                  return (
                    <tr key={it.id} className={`${on ? 'is-picked' : ''} ${full ? 'is-done' : ''}`}>
                      {editable && (
                        <td><input type="checkbox" checked={on} disabled={full} onChange={() => toggle(it)} aria-label={`Add ${it.item_name} to parcel`} /></td>
                      )}
                      <td className="cell-wrap"><strong>{it.line} · {it.item_name}</strong>{it.lot_no && <div className="cell-sub">Lot {it.lot_no}</div>}</td>
                      <td className="num">{qty(it.ordered)} {it.unit}</td>
                      <td className="num">{qty(it.picked)}</td>
                      <td className="num">{qty(it.packed)} <span className="cell-sub">/ {qty(it.eligible)}</span></td>
                      <td className={`num ${it.remaining > 0 ? 'text-danger' : ''}`}>{qty(it.remaining)}</td>
                      <td><Badge size="sm" variant={ITEM_STATUS[it.status].variant}>{ITEM_STATUS[it.status].label}</Badge></td>
                      {editable && (
                        <td className="num">
                          <input className="cut-in" type="number" min="0.01" step="0.01" max={it.remaining} disabled={!on} value={on ? sel[it.id].qty : ''} onChange={(e) => setField(it.id, 'qty', e.target.value)} />
                        </td>
                      )}
                      {editable && (
                        <td className="num">
                          <input className="cut-in cut-in--pcs" type="number" min="1" step="1" disabled={!on} value={on ? sel[it.id].pcs : ''} onChange={(e) => setField(it.id, 'pcs', e.target.value)} />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {editable && (
            <div className="pack-new">
              <label className="lbl-prop">
                Parcel remarks (optional)
                <input value={remarks} maxLength={500} onChange={(e) => setRemarks(e.target.value)} />
              </label>
              <Button icon={PackagePlus} loading={busy === 'parcel'} disabled={!!busy || !selCount} onClick={createParcel}>
                Create Parcel{selCount ? ` (${selCount} item${selCount > 1 ? 's' : ''})` : ''}
              </Button>
            </div>
          )}

          <div className="pack-history">
            <div className="pack-history__head">
              <h4 className="crm-pay__title">Parcel history</h4>
              <div className="pack-history__actions">
                <label className="lbl-prop pack-template">
                  Sticker template
                  <select value={templateId} onChange={(e) => pickTemplate(e.target.value)}>
                    {!templates.length && <option value="">No Parcel template yet</option>}
                    {templates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.is_default ? ' (default)' : ''}</option>)}
                  </select>
                </label>
                <Button size="sm" variant="secondary" icon={Printer} disabled={!d.parcels.length} onClick={() => printStickers(d.parcels.map((p) => p.id))}>
                  All parcel stickers ({d.parcels.length})
                </Button>
              </div>
            </div>
            {d.parcels.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>#</th><th>Items</th><th className="num">Qty</th><th className="num">Pcs</th><th>Packed</th><th>Remarks</th><th /></tr></thead>
                  <tbody>
                    {d.parcels.map((p) => (
                      <tr key={p.id} className={p.id === highlight ? 'is-highlight' : ''}>
                        <td><strong>{p.parcel_no}</strong><div className="mono mono--plain cell-sub">{p.qr_ref}</div></td>
                        <td className="cell-wrap">{p.items.map((x) => <div key={x.item_id}>{x.line} · {x.item_name} — {qty(x.qty)} {x.unit} · {x.pcs} pcs</div>)}</td>
                        <td className="num">{qty(p.total_qty)}</td>
                        <td className="num">{p.total_pcs}</td>
                        <td className="cell-sub">{p.packed_by || '—'}<div>{stamp(p.packed_at)}</div></td>
                        <td className="cell-wrap cell-sub">{p.remarks || '—'}</td>
                        <td className="num">
                          <div className="row-actions">
                            <button type="button" className="icon-btn icon-btn--sm" title="Preview sticker" onClick={() => printStickers([p.id])}><Eye size={14} /></button>
                            <button type="button" className="icon-btn icon-btn--sm" title="Print sticker" onClick={() => printStickers([p.id])}><Printer size={14} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="cell-sub">No parcel yet — tick items, enter the qty and pcs, then Create Parcel.</p>
            )}
          </div>
          <RemarksSection orderId={id} />
        </div>
      )}
    </Modal>
  );
}
