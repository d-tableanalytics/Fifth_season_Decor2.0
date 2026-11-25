import { useCallback, useEffect, useState } from 'react';
import { Save, Undo2 } from 'lucide-react';

import { getErrorMessage } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Loader } from '../../components/ui/Loader';
import { Modal } from '../../components/ui/Modal';
import { Textarea } from '../../components/ui/FormControls';
import { useO2D } from '../../context/O2DContext';
import { RemarksSection } from '../../components/o2d/RemarksSection';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const qty = (n) => Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const DEPT = { CUT: 'Cut', ROLL: 'Roll', IN_CHECKING: 'In Checking' };

/** Editable copy of the server's lines. Numbers are kept as strings while typing. */
const toForm = (d) => ({
  ioc_number: d.ioc_number || '',
  lines: d.lines.map((l) => ({
    ...l,
    f_cut: String(l.cut_qty || ''),
    f_wastage: String(l.wastage_qty || ''),
    f_lot: l.lot_no || '',
    lots: l.lots.map((x) => ({
      ...x,
      f_picked: String(x.picked),
      f_cut: String(x.cut_qty || ''),
      f_wastage: String(x.wastage_qty || ''),
      f_lot: x.lot_no || '',
      ioc_on: x.ioc_meter > 0,
      f_ioc: x.ioc_meter > 0 ? String(x.ioc_meter) : '',
      ioc_auto: false,
    })),
  })),
});

/** Spread an item-level total over its lots in listed order, each capped at what it can hold. */
function spread(lots, total, key, capOf) {
  let rest = r2(total);
  return lots.map((x) => {
    const take = Math.max(0, Math.min(capOf(x), rest));
    rest = r2(rest - take);
    return { ...x, [key]: String(r2(take) || '') };
  });
}

const lotNums = (x) => ({ picked: r2(x.f_picked), cut: r2(x.f_cut), wastage: r2(x.f_wastage) });
const lineCut = (l) => (l.lots.length ? r2(l.lots.reduce((s, x) => s + r2(x.f_cut), 0)) : r2(l.f_cut));
const lineWastage = (l) => (l.lots.length ? r2(l.lots.reduce((s, x) => s + r2(x.f_wastage), 0)) : r2(l.f_wastage));

/** O2D › Cutting › Cut Details: per-lot Picked / Cut / Wastage / Lot No / IOC Meter. */
export function CutDetailsModal({ id, onClose, onChanged }) {
  const o2d = useO2D();
  const { can } = useAuth();
  const toast = useToast();
  const canEdit = can(o2d.perm, 'edit');
  const [d, setD] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState('');
  const [errors, setErrors] = useState([]);
  const [back, setBack] = useState(null); // reason text while the Send Back dialog is open

  const load = useCallback(
    () =>
      o2d.apis.cutting.get(id).then((x) => {
        setD(x);
        setForm(toForm(x));
      }).catch((err) => {
        toast.error('Could not open order', getErrorMessage(err));
        onClose();
      }),
    [id, toast, onClose]
  );
  useEffect(() => {
    load();
  }, [load]);

  const setLine = (lid, fn) => setForm((f) => ({ ...f, lines: f.lines.map((l) => (l.id === lid ? fn(l) : l)) }));
  const setLot = (lid, pid, patch) => setLine(lid, (l) => ({ ...l, lots: l.lots.map((x) => (x.id === pid ? { ...x, ...patch } : x)) }));

  /* Item-level edits: spread across lots when the item has picks */
  const itemCut = (l, v) =>
    setLine(l.id, (x) => (x.lots.length ? { ...x, lots: spread(x.lots, v, 'f_cut', (lot) => r2(lot.f_picked) - r2(lot.f_wastage)) } : { ...x, f_cut: v }));
  const itemWastage = (l, v) =>
    setLine(l.id, (x) => (x.lots.length ? { ...x, lots: spread(x.lots, v, 'f_wastage', (lot) => r2(lot.f_picked) - r2(lot.f_cut)) } : { ...x, f_wastage: v }));
  const itemRemaining = (l, v) => itemCut(l, String(Math.max(0, r2(l.target - r2(v)))));

  const toggleIoc = (l, x, on) =>
    setLot(l.id, x.id, on ? { ioc_on: true, f_ioc: x.f_ioc || String(r2(x.f_picked)), ioc_auto: !x.f_ioc } : { ioc_on: false });

  const save = async () => {
    setBusy('save');
    setErrors([]);
    try {
      const body = {
        ioc_number: o2d.ioc ? form.ioc_number.trim() || null : null,
        items: form.lines.map((l) =>
          l.lots.length
            ? {
                item_id: l.id,
                lots: l.lots.map((x) => ({
                  pick_id: x.id,
                  ...(({ picked, cut, wastage }) => ({ picked_qty: picked, cut_qty: cut, wastage_qty: wastage }))(lotNums(x)),
                  lot_no: x.f_lot.trim() || null,
                  ioc_meter: x.ioc_required && x.ioc_on ? r2(x.f_ioc) || null : null,
                })),
              }
            : { item_id: l.id, cut_qty: r2(l.f_cut), wastage_qty: r2(l.f_wastage), lot_no: l.f_lot.trim() || null }
        ),
      };
      const r = await o2d.apis.cutting.save(id, body);
      toast.success(r.message);
      onChanged();
      if (r.data.completed) return onClose();
      setD(r.data.order);
      setForm(toForm(r.data.order));
    } catch (err) {
      const list = err.response?.data?.errors;
      if (list?.length) setErrors(list);
      toast.error('Could not save', getErrorMessage(err));
    } finally {
      setBusy('');
    }
  };

  const sendBack = async () => {
    setBusy('back');
    try {
      const r = await o2d.apis.cutting.sendBack(id, back.trim());
      toast.success(r.message);
      onChanged();
      onClose();
    } catch (err) {
      toast.error('Could not send back', getErrorMessage(err));
    } finally {
      setBusy('');
    }
  };

  const ro = !canEdit;
  const af = d?.available_fabric || {};

  if (back != null) {
    return (
      <Modal
        open
        busy={busy === 'back'}
        onClose={() => setBack(null)}
        title="Send back to Picking"
        subtitle={d ? d.system_order_no || d.enquiry_number : ''}
        footer={
          <>
            <Button variant="secondary" onClick={() => setBack(null)}>Cancel</Button>
            <Button variant="danger" loading={busy === 'back'} disabled={!back.trim()} onClick={sendBack}>Send Back</Button>
          </>
        }
      >
        <Textarea label="Reason" required rows={3} maxLength={1000} value={back} onChange={(e) => setBack(e.target.value)} />
      </Modal>
    );
  }

  return (
    <Modal
      open
      size="xl"
      busy={!!busy}
      onClose={onClose}
      title={d ? `${d.system_order_no || d.enquiry_number} · Cut Details` : 'Cut Details'}
      subtitle={d ? `${d.client_id} — ${d.company_name}${d.transport_name ? ` · ${d.transport_name}` : ''}` : ''}
      footer={
        d && canEdit && (
          <div className="picking-foot">
            <div className="picking-foot__left">
              <Button variant="ghost" icon={Undo2} disabled={!!busy} onClick={() => setBack('')}>Send Back</Button>
            </div>
            <div className="picking-foot__right">
              <Button icon={Save} loading={busy === 'save'} disabled={!!busy} onClick={save}>Save Cut Details</Button>
            </div>
          </div>
        )
      }
    >
      {!d || !form ? (
        <Loader label="Loading…" />
      ) : (
        <div className="cutting">
          <div className="cutting__top">
            <div className="crm-facts">
              <div><span>Available fabric · Cut</span><strong>{qty(af.CUT)}</strong></div>
              <div><span>Roll</span><strong>{qty(af.ROLL)}</strong></div>
              <div><span>In Checking</span><strong>{qty(af.IN_CHECKING)}</strong></div>
            </div>
            {o2d.ioc && <label className="lbl-prop cutting__ioc">
              IOC Number (optional)
              <input value={form.ioc_number} maxLength={60} disabled={ro} onChange={(e) => setForm((f) => ({ ...f, ioc_number: e.target.value }))} />
            </label>}
          </div>

          {errors.length > 0 && (
            <ul className="cutting__errors">
              {errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}

          <div className="table-wrap cutting__table">
            <table className="table">
              <thead>
                <tr>
                  <th>Line / Lot</th>
                  <th className="num">Picked</th>
                  <th className="num">Cut Qty</th>
                  <th className="num">Wastage</th>
                  <th className="num">Remaining</th>
                  <th>Lot No</th>
                  <th>{o2d.ioc ? 'IOC Meter' : ''}</th>
                </tr>
              </thead>
              <tbody>
                {form.lines.map((l) => {
                  const cut = lineCut(l);
                  const rem = r2(l.target - cut);
                  return [
                    <tr key={l.id} className="cutting__item">
                      <td className="cell-wrap">
                        <strong>{l.line} · {l.item_name}</strong>
                        <div className="cell-sub">To cut {qty(l.target)} {l.unit}{l.lots.length ? ` · ${l.lots.length} lot(s)` : ' · no picks'}</div>
                      </td>
                      <td className="num cell-sub">{l.lots.length ? qty(l.lots.reduce((s, x) => s + r2(x.f_picked), 0)) : '—'}</td>
                      <td className="num"><input className="cut-in" type="number" min="0" step="0.01" disabled={ro} value={l.lots.length ? String(cut || '') : l.f_cut} onChange={(e) => itemCut(l, e.target.value)} /></td>
                      <td className="num"><input className="cut-in" type="number" min="0" step="0.01" disabled={ro} value={l.lots.length ? String(lineWastage(l) || '') : l.f_wastage} onChange={(e) => itemWastage(l, e.target.value)} /></td>
                      <td className="num">
                        <input className={`cut-in ${rem > 0 ? 'is-short' : 'is-done'}`} type="number" min="0" step="0.01" disabled={ro} value={String(Math.max(0, rem))} onChange={(e) => itemRemaining(l, e.target.value)} />
                        {rem < 0 && <div className="text-danger cell-sub">over by {qty(-rem)}</div>}
                      </td>
                      <td>{l.lots.length ? <span className="cell-sub">{[...new Set(l.lots.map((x) => x.f_lot).filter(Boolean))].join(', ') || '—'}</span> : <input className="cut-in cut-in--text" disabled={ro} value={l.f_lot} onChange={(e) => setLine(l.id, (x) => ({ ...x, f_lot: e.target.value }))} />}</td>
                      <td>{rem <= 0 ? <Badge size="sm" variant="success">Cut</Badge> : <Badge size="sm" variant="warning">{qty(rem)} to cut</Badge>}</td>
                    </tr>,
                    ...l.lots.map((x) => {
                      const n = lotNums(x);
                      const lotRem = r2(n.picked - n.cut - n.wastage);
                      return (
                        <tr key={x.id} className="cutting__lot">
                          <td className="cell-wrap">
                            <span className="cell-sub">{DEPT[x.source] || x.source} · {x.rack_no || '—'}</span>
                          </td>
                          <td className="num">
                            <input className="cut-in" type="number" min="0.01" step="0.01" disabled={ro} value={x.f_picked} onChange={(e) => setLot(l.id, x.id, { f_picked: e.target.value })} />
                            {r2(x.f_picked) !== r2(x.original_picked) && <div className="cell-sub">picked {qty(x.original_picked)}</div>}
                          </td>
                          <td className="num"><input className="cut-in" type="number" min="0" step="0.01" disabled={ro} value={x.f_cut} onChange={(e) => setLot(l.id, x.id, { f_cut: e.target.value })} /></td>
                          <td className="num"><input className="cut-in" type="number" min="0" step="0.01" disabled={ro} value={x.f_wastage} onChange={(e) => setLot(l.id, x.id, { f_wastage: e.target.value })} /></td>
                          <td className="num">
                            <input className={`cut-in ${lotRem < 0 ? 'is-short' : ''}`} type="number" step="0.01" disabled={ro} value={String(lotRem)}
                              onChange={(e) => setLot(l.id, x.id, { f_cut: String(Math.max(0, r2(n.picked - n.wastage - r2(e.target.value)))) })} />
                          </td>
                          <td><input className="cut-in cut-in--text" maxLength={60} disabled={ro} value={x.f_lot} onChange={(e) => setLot(l.id, x.id, { f_lot: e.target.value })} /></td>
                          <td>
                            {o2d.ioc && x.ioc_required ? (
                              <div className="cutting__iocm">
                                <input type="checkbox" checked={x.ioc_on} disabled={ro} onChange={(e) => toggleIoc(l, x, e.target.checked)} aria-label="Enable IOC Meter" />
                                <input className={`cut-in ${x.ioc_on && !(r2(x.f_ioc) > 0) ? 'is-short' : ''}`} type="number" min="0.01" step="0.01" disabled={ro || !x.ioc_on} value={x.f_ioc}
                                  onChange={(e) => setLot(l.id, x.id, { f_ioc: e.target.value, ioc_auto: false })} placeholder="Required" />
                                {x.ioc_auto && x.ioc_on && <span className="cell-sub">Auto-filled</span>}
                                {x.ioc_batch_no && <span className="cell-sub">Batch {x.ioc_batch_no}</span>}
                              </div>
                            ) : (
                              <span className="cell-sub">{o2d.ioc ? '—' : ''}</span>
                            )}
                          </td>
                        </tr>
                      );
                    }),
                  ];
                })}
              </tbody>
            </table>
          </div>
          <p className="cell-sub crm-pay__hint">
            Remaining on an item = qty to cut − Cut Qty; on a lot = Picked − Cut − Wastage (type a Remaining to work out the Cut Qty).
            When every item is fully cut, saving moves the order to Delivery Note automatically.
          </p>
          <RemarksSection orderId={id} />
        </div>
      )}
    </Modal>
  );
}
