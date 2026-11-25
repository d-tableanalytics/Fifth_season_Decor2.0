import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Send, Save, Undo2, PackageOpen, FileText, ScanLine } from 'lucide-react';

import { getErrorMessage } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Button } from '../../components/ui/Button';
import { Loader } from '../../components/ui/Loader';
import { Modal } from '../../components/ui/Modal';
import { Textarea } from '../../components/ui/FormControls';
import { DnNumberCell } from './DeliveryNoteQueue';
import { useO2D } from '../../context/O2DContext';
import { RemarksSection } from '../../components/o2d/RemarksSection';

// The camera scanner (and its barcode library) loads only when Scan is pressed
const ScanCodeModal = lazy(() => import('../../components/ui/ScanCodeModal').then((m) => ({ default: m.ScanCodeModal })));

const qty = (n) => Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const stamp = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

/** One order at Delivery Note: read-only cutting results; DN number (once), LR + Send, Move to Packing, Send Back. */
export function DeliveryNoteModal({ id, onClose, onChanged }) {
  const o2d = useO2D();
  const { can } = useAuth();
  const toast = useToast();
  const canEdit = can(o2d.perm, 'edit');
  const [d, setD] = useState(null);
  const [lr, setLr] = useState('');
  const [busy, setBusy] = useState('');
  const [back, setBack] = useState(null);
  const [scanning, setScanning] = useState(false);

  const apply = (x) => {
    setD(x);
    setLr(x.lr_number || '');
  };
  const load = useCallback(
    () => o2d.apis.deliveryNote.get(id).then(apply).catch((err) => {
      toast.error('Could not open order', getErrorMessage(err));
      onClose();
    }),
    [id, toast, onClose]
  );
  useEffect(() => {
    load();
  }, [load]);

  const run = async (key, fn) => {
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      toast.error('Something went wrong', getErrorMessage(err));
    } finally {
      setBusy('');
    }
  };
  const saveLr = () => run('lr', async () => { const r = await o2d.apis.deliveryNote.saveLr(id, lr.trim() || null); apply(r.data); toast.success(r.message); onChanged(); });
  const sendLr = () => run('send', async () => { const r = await o2d.apis.deliveryNote.sendLr(id); apply(r.data); toast.success(r.message); });
  const toPacking = () => run('pack', async () => { const r = await o2d.apis.deliveryNote.moveToPacking(id); toast.success(r.message); onChanged(); onClose(); });
  const sendBack = () => run('back', async () => { const r = await o2d.apis.deliveryNote.sendBack(id, back.trim()); toast.success(r.message); onChanged(); onClose(); });

  // Scanning replaces this modal while the camera is open (one modal at a time); the LR field keeps its text
  if (scanning) {
    return (
      <Suspense fallback={<Loader fullscreen label="Opening camera…" />}>
      <ScanCodeModal
        title="Scan LR Number"
        hint="QR code or barcode on the lorry receipt"
        onClose={() => setScanning(false)}
        onScan={(text) => {
          setScanning(false);
          if (!text) return toast.error('Nothing was read', 'Try again');
          if (text.length > 60) return toast.error('Scanned code is too long for an LR number', text.slice(0, 80));
          setLr(text);
          toast.success('LR number scanned', `${text} — press Save to keep it`);
        }}
      />
      </Suspense>
    );
  }

  if (back != null) {
    return (
      <Modal open busy={busy === 'back'} onClose={() => setBack(null)} title="Send back to Cutting" subtitle={d?.system_order_no}
        footer={<><Button variant="secondary" onClick={() => setBack(null)}>Cancel</Button><Button variant="danger" loading={busy === 'back'} disabled={!back.trim()} onClick={sendBack}>Send Back</Button></>}>
        <Textarea label="Reason" required rows={3} maxLength={1000} value={back} onChange={(e) => setBack(e.target.value)} />
      </Modal>
    );
  }

  const lrDirty = d && (lr.trim() || null) !== (d.lr_number || null);

  return (
    <Modal
      open
      size="xl"
      busy={!!busy}
      onClose={onClose}
      title={d ? `${d.system_order_no || d.enquiry_number} · Delivery Note` : 'Delivery Note'}
      subtitle={d ? `${d.client_id} — ${d.company_name}${d.transport_name ? ` · ${d.transport_name}` : ''}` : ''}
      footer={
        d && (
          <div className="picking-foot">
            <div className="picking-foot__left">
              {canEdit && <Button variant="ghost" icon={Undo2} disabled={!!busy} onClick={() => setBack('')}>Send Back</Button>}
              <a className="btn btn--secondary btn--md" href={`/o2d/delivery-note/print?type=${o2d.slug}&orders=${id}`} target="_blank" rel="noreferrer noopener"><FileText size={15} /> Delivery Note PDF</a>
            </div>
            {canEdit && (
              <div className="picking-foot__right">
                <Button icon={PackageOpen} loading={busy === 'pack'} disabled={!!busy} onClick={toPacking}>Move to Packing</Button>
              </div>
            )}
          </div>
        )
      }
    >
      {!d ? (
        <Loader label="Loading…" />
      ) : (
        <div className="cutting">
          <div className="crm-facts">
            <div>
              <span>Delivery Note No</span>
              <DnNumberCell orderId={id} value={d.delivery_note_no} locked={!!d.dn_edit} onSaved={(x) => { apply(x); onChanged(); }} />
              {d.dn_edit && <small>Changed {d.dn_edit.from} → {d.dn_edit.to} by {d.dn_edit.by || '—'} · {stamp(d.dn_edit.at)}</small>}
            </div>
            {o2d.ioc && <div><span>IOC Numbers</span><strong>{d.ioc_numbers || '—'}</strong></div>}
            <div><span>Transport</span><strong>{d.transport_name || '—'}</strong></div>
          </div>

          <div className="dn-lr">
            <label className="lbl-prop">
              LR Number (Lorry Receipt)
              <input value={lr} maxLength={60} disabled={!canEdit} onChange={(e) => setLr(e.target.value)} placeholder="Not captured yet" />
            </label>
            {canEdit && (
              <>
                <Button size="sm" variant="secondary" icon={ScanLine} disabled={!!busy} onClick={() => setScanning(true)} title="Scan the QR code / barcode with the camera">Scan</Button>
                <Button size="sm" variant="secondary" icon={Save} loading={busy === 'lr'} disabled={!!busy || !lrDirty} onClick={saveLr}>Save</Button>
                <Button size="sm" icon={Send} loading={busy === 'send'} disabled={!!busy || !d.lr_number || lrDirty} onClick={sendLr} title={!d.lr_number ? 'Capture the LR number first' : ''}>Send</Button>
              </>
            )}
            {d.lr_sent_at && <span className="cell-sub">Sent {stamp(d.lr_sent_at)}</span>}
          </div>

          <div className="table-wrap cutting__table">
            <table className="table">
              <thead>
                <tr><th>Line</th><th>Item</th><th>Lot No</th><th className="num">Original Size</th><th className="num">Cut Size</th><th className="num">Wastage</th><th className="num">Balance</th></tr>
              </thead>
              <tbody>
                {d.items.map((it) => (
                  <tr key={it.item_id}>
                    <td className="mono mono--plain">{it.line}</td>
                    <td className="cell-wrap">{it.item_name}</td>
                    <td className="cell-sub">{it.lot_no || '—'}</td>
                    <td className="num">{qty(it.original)} {it.unit}</td>
                    <td className="num">{qty(it.cut_qty)}</td>
                    <td className="num">{qty(it.wastage_qty)}</td>
                    <td className={`num ${it.balance > 0 ? 'text-danger' : ''}`}>{qty(it.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <RemarksSection orderId={id} />
        </div>
      )}
    </Modal>
  );
}
